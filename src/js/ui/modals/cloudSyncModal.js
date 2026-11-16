import i18next from '../../core/i18n.js';
import {
  CloudApiError,
  deleteAccount,
  getSession,
  getSyncRevision,
  getSyncDocument,
  listSyncRevisions,
  logout,
  putSyncDocument,
} from '../../core/cloudApi.js';
import {
  MIN_PASSWORD_LENGTH,
  createKeySlots,
  createRecoveryKey,
  decodeBytes,
  decryptJson,
  deriveEncryptionKey,
  encryptJson,
  encodeBytes,
  evaluatePasswordStrength,
  importDekKey,
  parseRecoveryKey,
  randomBytes,
  unwrapDekFromPasswordSlot,
  unwrapDekFromRecoverySlot,
} from '../../core/cryptoVault.js';
import {
  clearGuestState,
  deleteCurrentAccountLocalState,
  getAccountEncryptionKey,
  getStorageMode,
  hasUnreadableGuestRecord,
  loadAccountState,
  useAccountEncryptionKey,
} from '../../core/secureStorage.js';
import { mergeSyncData } from '../../core/syncMerge.js';
import { CLOUD_ENABLED } from '../../core/runtimeConfig.js';
import CLOUD_SYNC_MARKUP from './cloudSyncMarkup.js';

let initialized = false;
let busy = false;
let syncTimer = null;
let syncRetryAttempt = 0;
// Consecutive automatic syncs that ended in a 409 conflict. Each one costs two
// PUTs against the server's 120/h limit, so automatic retries stop at the cap.
const MAX_CONFLICT_RETRIES = 5;
let conflictFailures = 0;
let session = null;
let csrfToken = '';
let remoteDocument = { envelope: null, etag: '"rev-0"', revision: 0 };
// The remote state this device last merged or uploaded (B12). Uploads send
// syncedEtag as If-Match so the server answers 409 when another device has
// written since; null means this page session has not synced yet.
let syncedEtag = null;
let syncedRevision = 0;
let encryptionContext = null;
let pendingRecovery = null;
let pendingSetup = null;
let recoveryUnlockMode = false;
let manageMode = null; // null | 'changePassword' | 'upgrade' | 'rotateRecovery'
let rotatedRecoveryDisplay = '';
let firstUploadRequired = false;
let guestMigrationPending = false;
// True while the in-memory data is only the empty placeholder shown for an
// unreadable guest record; it must never be uploaded as the user's data.
let placeholderOnly = false;
let suppressAutomaticSync = false;
let callbacks = {
  getData: () => ({
    urls: [],
    presets: [],
    sortMode: 'created',
    viewMode: 'cards',
  }),
  onRestore: () => {},
};

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else {
    dialog.removeAttribute('open');
    dialog.classList.add('hidden');
  }
}

function ensureCloudSyncUi() {
  if (!document.getElementById('cloud-sync-modal')) {
    const template = document.createElement('template');
    template.innerHTML = CLOUD_SYNC_MARKUP;
    document.body.appendChild(template.content.cloneNode(true));
  }
  if (!document.getElementById('open-cloud-sync-btn')) {
    const anchor = document.getElementById('open-redirect-btn');
    const button = document.createElement('button');
    button.id = 'open-cloud-sync-btn';
    button.className = 'sidebar-tool-btn';
    button.dataset.i18n = 'cloudSync.btn';
    button.innerHTML = '<span>☁️</span> 雲端同步';
    if (anchor?.parentElement) anchor.after(button);
  }
}

function openDialog(dialog) {
  if (!dialog) return;
  dialog.classList.remove('hidden');
  if (typeof dialog.showModal === 'function' && !dialog.open)
    dialog.showModal();
  else dialog.setAttribute('open', 'true');
}

function setStatus(message, isError = false) {
  const element = document.getElementById('cloud-sync-status');
  if (!element) return;
  element.textContent = message || '';
  element.classList.toggle('text-error', isError);
}

function handleNetworkChange() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setStatus(
      i18next.t('cloudSync.offline', {
        defaultValue: '目前離線；修改會保留在本機，恢復連線後自動同步。',
      }),
      true
    );
    return;
  }
  if (session && encryptionContext) {
    setStatus(i18next.t('cloudSync.online', { defaultValue: '已恢復連線。' }));
    scheduleAutomaticSync();
  }
}

function restoreData(data) {
  suppressAutomaticSync = true;
  placeholderOnly = false;
  try {
    return callbacks.onRestore(data);
  } finally {
    suppressAutomaticSync = false;
  }
}

function setVisible(id, visible) {
  const element = document.getElementById(id);
  if (!element) return;
  element.classList.toggle('hidden', !visible);
  element.hidden = !visible;
}

function setBusy(value) {
  busy = value;
  [
    'cloud-sync-login-btn',
    'cloud-sync-create-vault-btn',
    'cloud-sync-activate-btn',
    'cloud-sync-password-unlock-btn',
    'cloud-sync-use-recovery-btn',
    'cloud-sync-back-to-password-btn',
    'cloud-sync-generate-btn',
    'cloud-sync-unlock-btn',
    'cloud-sync-upload-btn',
    'cloud-sync-download-btn',
    'cloud-sync-open-password-btn',
    'cloud-sync-open-upgrade-btn',
    'cloud-sync-save-password-btn',
    'cloud-sync-confirm-rotate-btn',
    'cloud-sync-rotate-btn',
    'cloud-sync-history-refresh-btn',
    'cloud-sync-history-restore-btn',
    'cloud-sync-logout-btn',
    'cloud-sync-delete-account-btn',
  ].forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;
    if (id === 'cloud-sync-activate-btn') {
      const confirmed = Boolean(
        document.getElementById('cloud-sync-backup-confirmed')?.checked
      );
      button.disabled = value || !confirmed;
      return;
    }
    button.disabled = value;
  });
}

function currentRecoveryDisplay() {
  return (
    pendingRecovery?.display ||
    document.getElementById('cloud-sync-recovery-display')?.textContent ||
    ''
  ).trim();
}

async function copyTextValue(value) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setStatus(
      i18next.t('cloudSync.keyCopied', {
        defaultValue: 'Recovery Key 已複製。',
      })
    );
  } catch (error) {
    setStatus(error.message || '無法複製 Recovery Key。', true);
  }
}

function downloadKeyFile(value) {
  if (!value) return;
  const blob = new Blob([`${value}\n`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'url-editor-recovery-key.txt';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function copyRecoveryKey() {
  return copyTextValue(currentRecoveryDisplay());
}

function downloadRecoveryKey() {
  downloadKeyFile(currentRecoveryDisplay());
}

function currentAccountId() {
  return session?.user?.id || '';
}

function currentKeyVersion() {
  return (
    encryptionContext?.keyVersion || remoteDocument.envelope?.keyVersion || 1
  );
}

function currentSchemaVersion() {
  if (encryptionContext?.payloadSchemaVersion) {
    return encryptionContext.payloadSchemaVersion;
  }
  return encryptionContext?.keySlots ? 2 : 1;
}

function requireEncryptedLocalStorage() {
  if (getStorageMode() !== 'indexeddb') {
    throw new Error(
      '此瀏覽器不支援加密 IndexedDB；雲端同步已停用以避免保留明文資料。'
    );
  }
}

function buildCloudPayload(data) {
  return {
    schemaVersion: 1,
    urls: Array.isArray(data?.urls) ? data.urls : [],
    presets: Array.isArray(data?.presets) ? data.presets : [],
    sortMode: data?.sortMode || 'created',
    viewMode: data?.viewMode || 'cards',
    tombstones: Array.isArray(data?.tombstones) ? data.tombstones : [],
    syncMetadata: data?.syncMetadata || {},
  };
}

function aadFor(accountId, keyVersion, revision, payloadSchemaVersion = 1) {
  return JSON.stringify({
    accountId,
    payloadSchemaVersion,
    keyVersion,
    revision,
  });
}

async function encryptCloudPayload(payload, revision) {
  const keyVersion = currentKeyVersion();
  const payloadSchemaVersion = currentSchemaVersion();
  const aad = aadFor(
    currentAccountId(),
    keyVersion,
    revision,
    payloadSchemaVersion
  );
  const encrypted = await encryptJson(payload, encryptionContext.key, aad);
  return {
    revision,
    payloadSchemaVersion,
    keyVersion,
    kdfSalt: encodeBytes(encryptionContext.salt),
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
    ...(payloadSchemaVersion === 2 && encryptionContext.keySlots
      ? { keySlots: encryptionContext.keySlots }
      : {}),
  };
}

async function decryptCloudEnvelope(envelope) {
  if (!envelope || !encryptionContext)
    throw new Error('Recovery Key is required.');
  const payloadSchemaVersion = Number(envelope.payloadSchemaVersion || 1);
  const aad = aadFor(
    currentAccountId(),
    envelope.keyVersion,
    envelope.revision,
    payloadSchemaVersion
  );
  return decryptJson({ ...envelope, aad }, encryptionContext.key, aad);
}

function togglePasswordInput(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input) return;
  const nextType = input.type === 'password' ? 'text' : 'password';
  input.type = nextType;
  if (btn) {
    btn.textContent =
      nextType === 'text'
        ? i18next.t('cloudSync.hidePassword', { defaultValue: '隱藏' })
        : i18next.t('cloudSync.showPassword', { defaultValue: '顯示' });
  }
}

function updatePasswordStrengthDisplay() {
  const input = document.getElementById('cloud-sync-new-password');
  const label = document.getElementById('cloud-sync-password-strength');
  if (!input || !label) return;
  const value = input.value || '';
  if (!value) {
    label.textContent = '';
    label.dataset.strength = '';
    return;
  }
  const result = evaluatePasswordStrength(value);
  label.dataset.strength = result.label;
  const textMap = {
    tooShort: i18next.t('cloudSync.strengthTooShort', {
      defaultValue: `密碼至少需 ${MIN_PASSWORD_LENGTH} 個字元`,
      min: MIN_PASSWORD_LENGTH,
    }),
    weak: i18next.t('cloudSync.strengthWeak', {
      defaultValue: '強度：弱（建議加長或混用英數符號）',
    }),
    fair: i18next.t('cloudSync.strengthFair', { defaultValue: '強度：普通' }),
    strong: i18next.t('cloudSync.strengthStrong', { defaultValue: '強度：高' }),
  };
  label.textContent = textMap[result.label] || '';
}

function updateControls() {
  const loggedIn = Boolean(session);
  const unlocked = Boolean(encryptionContext);
  const hasRemote = Boolean(remoteDocument.envelope);
  const hasV2Slots = Boolean(remoteDocument.envelope?.keySlots);
  const isV2Unlocked = Boolean(encryptionContext?.keySlots);

  setVisible('cloud-sync-login-section', CLOUD_ENABLED && !loggedIn);
  setVisible('cloud-sync-account-section', CLOUD_ENABLED && loggedIn);
  setVisible(
    'cloud-sync-recovery-section',
    CLOUD_ENABLED && loggedIn && !unlocked
  );
  setVisible(
    'cloud-sync-unlocked-section',
    CLOUD_ENABLED && loggedIn && unlocked
  );
  setVisible('cloud-sync-first-upload-warning', firstUploadRequired);

  if (loggedIn && !unlocked) {
    const showSetup = !hasRemote;
    const showPasswordUnlock = hasRemote && hasV2Slots && !recoveryUnlockMode;
    const showLegacyUnlock =
      (hasRemote && !hasV2Slots) || (hasV2Slots && recoveryUnlockMode);

    setVisible('cloud-sync-setup-panel', showSetup);
    setVisible('cloud-sync-backup-panel', showSetup && Boolean(pendingSetup));
    setVisible('cloud-sync-password-unlock-panel', showPasswordUnlock);
    setVisible('cloud-sync-legacy-panel', showLegacyUnlock);
    setVisible(
      'cloud-sync-back-to-password-btn',
      hasV2Slots && recoveryUnlockMode
    );
    setVisible('cloud-sync-legacy-gen-wrap', Boolean(pendingRecovery));
  }

  if (loggedIn && unlocked) {
    setVisible('cloud-sync-upgrade-banner', !isV2Unlocked);
    setVisible('cloud-sync-open-password-btn', isV2Unlocked);
    const showManagePwd =
      manageMode === 'changePassword' || manageMode === 'upgrade';
    setVisible('cloud-sync-password-manage-panel', showManagePwd);
    setVisible(
      'cloud-sync-current-secret-wrap',
      manageMode === 'changePassword'
    );
    const manageTitle = document.getElementById('cloud-sync-manage-title');
    if (manageTitle) {
      manageTitle.textContent =
        manageMode === 'upgrade'
          ? i18next.t('cloudSync.upgradeTitle', {
              defaultValue: '升級為「自訂密碼 + 備用 Key」模式',
            })
          : i18next.t('cloudSync.changePasswordTitle', {
              defaultValue: '變更同步密碼',
            });
    }
    setVisible(
      'cloud-sync-rotate-panel',
      manageMode === 'rotateRecovery' && isV2Unlocked
    );
    setVisible('cloud-sync-rotated-key-box', Boolean(rotatedRecoveryDisplay));
    const rotatedEl = document.getElementById('cloud-sync-rotated-display');
    if (rotatedEl) rotatedEl.textContent = rotatedRecoveryDisplay;
  }

  const email = session?.user?.email || '';
  [
    'cloud-sync-setup-username',
    'cloud-sync-unlock-username',
    'cloud-sync-manage-username',
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = email;
  });

  const accountName = document.getElementById('cloud-sync-account-name');
  if (accountName)
    accountName.textContent = session?.user?.email || session?.user?.name || '';
  const loginButton = document.getElementById('cloud-sync-login-btn');
  if (loginButton) loginButton.disabled = !CLOUD_ENABLED || busy;
  const activateBtn = document.getElementById('cloud-sync-activate-btn');
  if (activateBtn) {
    const confirmed = Boolean(
      document.getElementById('cloud-sync-backup-confirmed')?.checked
    );
    activateBtn.disabled = busy || !confirmed;
  }
}

async function refreshRemoteDocument() {
  if (!session) return;
  const result = await getSyncDocument(csrfToken);
  remoteDocument = {
    envelope: result.document || result.envelope || null,
    etag: result.etag || '"rev-0"',
    revision:
      result.revision ||
      result.document?.revision ||
      result.envelope?.revision ||
      0,
  };
}

// Call only after the current remote document has been merged into local data
// (or this device just uploaded it).
function markRemoteSynced() {
  syncedEtag = remoteDocument.etag;
  syncedRevision = Number(remoteDocument.revision || 0);
}

function clearSyncedRemote() {
  syncedEtag = null;
  syncedRevision = 0;
}

async function mergeRemoteIntoLocal() {
  if (remoteDocument.envelope) {
    const remoteData = await decryptCloudEnvelope(remoteDocument.envelope);
    restoreData(mergeSyncData(callbacks.getData(), remoteData));
  }
  markRemoteSynced();
}

async function refreshHistory() {
  if (!session) return;
  const select = document.getElementById('cloud-sync-history-select');
  if (!select) return;
  try {
    const revisions = await listSyncRevisions(csrfToken);
    select.innerHTML = '';
    if (!revisions.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = i18next.t('cloudSync.historyEmpty', {
        defaultValue: '目前沒有可復原的歷史版本。',
      });
      select.appendChild(option);
      return;
    }
    revisions.forEach((revision) => {
      const option = document.createElement('option');
      option.value = String(revision.revision);
      option.textContent = `${i18next.t('cloudSync.historyRevision', {
        defaultValue: 'Revision {{revision}}',
        revision: revision.revision,
      })} · ${new Date(Number(revision.created_at) * 1000).toLocaleString()}`;
      select.appendChild(option);
    });
  } catch (error) {
    setStatus(error.message || '無法讀取歷史版本。', true);
  }
}

async function refreshSession() {
  if (!CLOUD_ENABLED) {
    updateControls();
    return;
  }
  try {
    session = await getSession();
    csrfToken = session?.csrfToken || '';
    if (!session) {
      encryptionContext = null;
      pendingSetup = null;
      recoveryUnlockMode = false;
      manageMode = null;
      rotatedRecoveryDisplay = '';
      remoteDocument = { envelope: null, etag: '"rev-0"', revision: 0 };
      clearSyncedRemote();
      firstUploadRequired = false;
      guestMigrationPending = false;
      placeholderOnly = false;
      updateControls();
      return;
    }
    const stored = await getAccountEncryptionKey(currentAccountId());
    if (stored?.key && stored.salt) {
      await useAccountEncryptionKey(currentAccountId(), stored.key, {
        salt: stored.salt,
        keyVersion: stored.keyVersion || 1,
        payloadSchemaVersion: stored.payloadSchemaVersion,
        keySlots: stored.keySlots,
      });
      encryptionContext = {
        key: stored.key,
        salt: stored.salt,
        keyVersion: stored.keyVersion || 1,
        payloadSchemaVersion:
          stored.payloadSchemaVersion || (stored.keySlots ? 2 : 1),
        keySlots: stored.keySlots || null,
      };
      const localAccountState = await loadAccountState(
        currentAccountId(),
        stored.key
      );
      if (localAccountState) {
        restoreData(mergeSyncData(callbacks.getData(), localAccountState));
      }
      await refreshRemoteDocument();
      if (remoteDocument.envelope?.keySlots) {
        encryptionContext.keySlots = remoteDocument.envelope.keySlots;
        encryptionContext.payloadSchemaVersion =
          remoteDocument.envelope.payloadSchemaVersion || 2;
      }
      await mergeRemoteIntoLocal();
      await refreshHistory();
    } else {
      await refreshRemoteDocument();
    }
    updateControls();
  } catch (error) {
    session = null;
    encryptionContext = null;
    clearSyncedRemote();
    updateControls();
    setStatus(error.message || 'Unable to load cloud session.', true);
  }
}

async function unlockWithDerivedContext(nextContext, generated = false) {
  const previousContext = encryptionContext;
  const previousFirstUploadRequired = firstUploadRequired;
  const previousGuestMigrationPending = guestMigrationPending;
  const previousPlaceholderOnly = placeholderOnly;
  const previousRecovery = pendingRecovery;
  const previousSyncedEtag = syncedEtag;
  const previousSyncedRevision = syncedRevision;
  encryptionContext = {
    ...nextContext,
    payloadSchemaVersion:
      nextContext.payloadSchemaVersion || (nextContext.keySlots ? 2 : 1),
    keySlots: nextContext.keySlots || null,
  };
  try {
    // An unreadable guest record is represented by an empty placeholder: it is
    // not the user's data, so it is neither merged, migrated nor uploaded.
    const guestUnreadable = hasUnreadableGuestRecord();
    let restoredData = guestUnreadable ? null : callbacks.getData();
    if (remoteDocument.envelope) {
      const remoteData = await decryptCloudEnvelope(remoteDocument.envelope);
      restoredData = restoredData
        ? mergeSyncData(restoredData, remoteData)
        : remoteData;
      firstUploadRequired = false;
    } else {
      firstUploadRequired = generated;
    }
    await useAccountEncryptionKey(currentAccountId(), encryptionContext.key, {
      salt: encryptionContext.salt,
      keyVersion: encryptionContext.keyVersion,
      payloadSchemaVersion: encryptionContext.payloadSchemaVersion,
      keySlots: encryptionContext.keySlots,
    });
    guestMigrationPending = !guestUnreadable;
    pendingRecovery = null;
    recoveryUnlockMode = false;
    const input = document.getElementById('cloud-sync-recovery-input');
    if (input) input.value = '';
    if (restoredData) restoreData(restoredData);
    else placeholderOnly = true;
    // The remote read above is now merged (or known to be empty).
    markRemoteSynced();
    await refreshHistory();
    updateControls();
  } catch (error) {
    console.error('[CloudSync Unlock Secret Failed]:', error);
    encryptionContext = previousContext;
    firstUploadRequired = previousFirstUploadRequired;
    guestMigrationPending = previousGuestMigrationPending;
    placeholderOnly = previousPlaceholderOnly;
    pendingRecovery = previousRecovery;
    syncedEtag = previousSyncedEtag;
    syncedRevision = previousSyncedRevision;
    throw error;
  }
}

async function unlockWithSecret(secret, generated = false) {
  requireEncryptedLocalStorage();
  await refreshRemoteDocument();
  const existingSalt = remoteDocument.envelope?.kdfSalt
    ? decodeBytes(remoteDocument.envelope.kdfSalt)
    : null;
  const salt = existingSalt || encryptionContext?.salt || randomBytes(16);
  const keyVersion = remoteDocument.envelope?.keyVersion || 1;
  const key = await deriveEncryptionKey(
    secret,
    salt,
    `URL Editor E2EE v1:${currentAccountId()}`
  );
  await unlockWithDerivedContext(
    { key, salt, keyVersion, payloadSchemaVersion: 1, keySlots: null },
    generated
  );
}

async function handleCreateVault(event) {
  event?.preventDefault?.();
  if (busy || !session) return;
  setBusy(true);
  try {
    requireEncryptedLocalStorage();
    const newPassword =
      document.getElementById('cloud-sync-new-password')?.value || '';
    const confirmPassword =
      document.getElementById('cloud-sync-confirm-password')?.value || '';
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        i18next.t('cloudSync.passwordTooShort', {
          defaultValue: `同步密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元。`,
          min: MIN_PASSWORD_LENGTH,
        })
      );
    }
    if (newPassword !== confirmPassword) {
      throw new Error(
        i18next.t('cloudSync.passwordMismatch', {
          defaultValue: '兩次輸入的密碼不一致。',
        })
      );
    }
    const dekBytes = new Uint8Array(randomBytes(32));
    const recovery = await createRecoveryKey();
    const keySlots = await createKeySlots({
      dekBytes,
      password: newPassword,
      recoverySecret: recovery.secret,
      accountId: currentAccountId(),
      keyVersion: 1,
    });
    const dekKey = await importDekKey(dekBytes);
    dekBytes.fill(0);
    pendingSetup = {
      dekKey,
      salt: randomBytes(16),
      keyVersion: 1,
      payloadSchemaVersion: 2,
      keySlots,
      recovery,
    };
    const displayEl = document.getElementById('cloud-sync-backup-display');
    if (displayEl) displayEl.textContent = recovery.display;
    const checkbox = document.getElementById('cloud-sync-backup-confirmed');
    if (checkbox) checkbox.checked = false;
    ['cloud-sync-new-password', 'cloud-sync-confirm-password'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    updatePasswordStrengthDisplay();
    setStatus(
      i18next.t('cloudSync.backupPendingStatus', {
        defaultValue:
          '請先複製或下載下方的備用 Recovery Key，勾選確認後點擊「啟用加密同步」。',
      })
    );
  } catch (error) {
    setStatus(error.message || '建立同步金鑰失敗。', true);
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function handleActivateVault() {
  if (busy || !session || !pendingSetup) return;
  const confirmed = Boolean(
    document.getElementById('cloud-sync-backup-confirmed')?.checked
  );
  if (!confirmed) {
    setStatus(
      i18next.t('cloudSync.backupConfirmRequired', {
        defaultValue: '請先勾選確認已妥善備份備用 Recovery Key。',
      }),
      true
    );
    return;
  }
  setBusy(true);
  try {
    requireEncryptedLocalStorage();
    await refreshRemoteDocument();
    const setup = pendingSetup;
    await unlockWithDerivedContext(
      {
        key: setup.dekKey,
        salt: setup.salt,
        keyVersion: setup.keyVersion,
        payloadSchemaVersion: 2,
        keySlots: setup.keySlots,
      },
      true
    );
    pendingSetup = null;
    // Upload initial v2 envelope right away (when local data is real) so any
    // second device finds keySlots immediately on sign-in.
    if (!remoteDocument.envelope && !placeholderOnly) {
      await uploadCurrentData({ force: true });
    }
    setStatus(
      i18next.t('cloudSync.unlocked', {
        defaultValue: '已啟用並解鎖端到端加密同步。',
      })
    );
  } catch (error) {
    console.warn('[CloudSync Activate Failed]:', error);
    setStatus(error.message || '啟用加密同步失敗。', true);
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function handlePasswordUnlock(event) {
  event?.preventDefault?.();
  if (busy || !session) return;
  setBusy(true);
  try {
    requireEncryptedLocalStorage();
    const passwordInput = document.getElementById('cloud-sync-unlock-password');
    const password = passwordInput?.value || '';
    if (!password) {
      throw new Error(
        i18next.t('cloudSync.passwordRequired', {
          defaultValue: '請輸入同步密碼。',
        })
      );
    }
    await refreshRemoteDocument();
    const envelope = remoteDocument.envelope;
    if (!envelope?.keySlots?.password) {
      throw new Error('此帳戶目前沒有密碼插槽，請改用 Recovery Key 解鎖。');
    }
    const { dekKey } = await unwrapDekFromPasswordSlot(
      envelope.keySlots.password,
      password,
      currentAccountId(),
      envelope.keyVersion || 1
    );
    await unlockWithDerivedContext(
      {
        key: dekKey,
        salt: decodeBytes(envelope.kdfSalt),
        keyVersion: envelope.keyVersion || 1,
        payloadSchemaVersion: 2,
        keySlots: envelope.keySlots,
      },
      false
    );
    if (passwordInput) passwordInput.value = '';
    setStatus(
      i18next.t('cloudSync.unlocked', {
        defaultValue: '已解鎖端到端加密同步。',
      })
    );
  } catch (error) {
    console.warn('[CloudSync Password Unlock Failed]:', error);
    setStatus(
      i18next.t('cloudSync.wrongPasswordError', {
        defaultValue:
          '同步密碼錯誤或無法解密；若忘記密碼可改用備用 Recovery Key。',
      }),
      true
    );
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function handleGenerateRecoveryKey() {
  if (busy) return;
  try {
    const generated = await createRecoveryKey();
    pendingRecovery = generated;
    const display = document.getElementById('cloud-sync-recovery-display');
    if (display) display.textContent = generated.display;
    const input = document.getElementById('cloud-sync-recovery-input');
    if (input) input.value = '';
    updateControls();
    setStatus(
      i18next.t('cloudSync.recoveryGenerated', {
        defaultValue: '請備份 Recovery Key，再貼上確認。',
      })
    );
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function handleUnlock() {
  if (busy || !session) return;
  setBusy(true);
  try {
    const inputValue =
      document.getElementById('cloud-sync-recovery-input')?.value || '';
    if (!inputValue.trim()) {
      throw new Error(
        i18next.t('cloudSync.recoveryInputRequired', {
          defaultValue: '請先在下方輸入框貼上 Recovery Key。',
        })
      );
    }
    if (
      pendingRecovery &&
      inputValue.trim().replace(/\s+/g, '') !== pendingRecovery.display
    ) {
      throw new Error(
        i18next.t('cloudSync.recoveryConfirmError', {
          defaultValue: 'Recovery Key 確認不一致。',
        })
      );
    }
    const secret =
      pendingRecovery?.secret || (await parseRecoveryKey(inputValue));
    requireEncryptedLocalStorage();
    await refreshRemoteDocument();
    const recoverySlot = remoteDocument.envelope?.keySlots?.recovery;
    if (recoverySlot && !pendingRecovery) {
      const envelope = remoteDocument.envelope;
      const { dekKey } = await unwrapDekFromRecoverySlot(
        recoverySlot,
        secret,
        currentAccountId(),
        envelope.keyVersion || 1
      );
      await unlockWithDerivedContext(
        {
          key: dekKey,
          salt: decodeBytes(envelope.kdfSalt),
          keyVersion: envelope.keyVersion || 1,
          payloadSchemaVersion: 2,
          keySlots: envelope.keySlots,
        },
        false
      );
      setStatus(
        i18next.t('cloudSync.unlockedViaRecovery', {
          defaultValue:
            '已使用備用 Recovery Key 解鎖；若忘記密碼，可點「變更同步密碼」立即重設。',
        })
      );
    } else {
      await unlockWithSecret(secret, Boolean(pendingRecovery));
      setStatus(
        i18next.t('cloudSync.unlocked', {
          defaultValue: '已解鎖端到端加密同步。',
        })
      );
    }
  } catch (error) {
    console.warn('[CloudSync Unlock Failed]:', error);
    setStatus(error.message || 'Recovery Key 無效。', true);
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function uploadCurrentData({ force = false, retry = true } = {}) {
  requireEncryptedLocalStorage();
  if (!session || !encryptionContext)
    throw new Error('請先登入並解鎖端到端加密同步。');
  if (firstUploadRequired && !force) return;
  if (placeholderOnly) {
    if (force)
      setStatus(
        i18next.t('cloudSync.placeholderUploadBlocked', {
          defaultValue:
            '本機資料無法讀取，尚無可上傳的資料；已略過上傳以避免覆蓋雲端資料。',
        }),
        true
      );
    return;
  }
  if (syncedEtag === null) {
    // Never synced in this page session: merge the remote first, never
    // overwrite it with local-only data.
    await refreshRemoteDocument();
    await mergeRemoteIntoLocal();
  }
  // No fresh etag here: the server compares If-Match with its current
  // revision and answers 409 when another device has written since.
  const nextRevision = syncedRevision + 1;
  const envelope = await encryptCloudPayload(
    buildCloudPayload(callbacks.getData()),
    nextRevision
  );
  try {
    const result = await putSyncDocument(envelope, csrfToken, syncedEtag);
    remoteDocument = {
      envelope: result.document || result.envelope || envelope,
      etag: result.etag || `"rev-${nextRevision}"`,
      revision: Number(result.revision || nextRevision),
    };
    markRemoteSynced();
    firstUploadRequired = false;
    syncRetryAttempt = 0;
    conflictFailures = 0;
    if (guestMigrationPending) {
      await clearGuestState();
      guestMigrationPending = false;
    }
    await refreshHistory();
    return result;
  } catch (error) {
    if (retry && error instanceof CloudApiError && error.status === 409) {
      await refreshRemoteDocument();
      await mergeRemoteIntoLocal();
      return uploadCurrentData({ force: true, retry: false });
    }
    throw error;
  }
}

async function handleManualUpload() {
  if (busy || !session || !encryptionContext) return;
  setBusy(true);
  try {
    const result = await uploadCurrentData({ force: true });
    if (result)
      setStatus(
        i18next.t('cloudSync.uploadSuccess', {
          defaultValue: '已上傳最新加密資料。',
        })
      );
  } catch (error) {
    console.error('[CloudSync Manual Upload Failed]:', error);
    setStatus(error.message || '同步失敗。', true);
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function handleDownload() {
  if (busy || !session || !encryptionContext) return;
  setBusy(true);
  try {
    await refreshRemoteDocument();
    if (!remoteDocument.envelope)
      throw new Error(
        i18next.t('cloudSync.noRemoteData', {
          defaultValue: '目前沒有雲端備份。',
        })
      );
    await mergeRemoteIntoLocal();
    setStatus(
      i18next.t('cloudSync.restoreSuccess', {
        defaultValue: '已下載並合併加密資料。',
      })
    );
  } catch (error) {
    console.error('[CloudSync Download Failed]:', error);
    setStatus(error.message || '下載失敗。', true);
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function unwrapCurrentDekForManage(secretInput) {
  const slots = encryptionContext?.keySlots;
  if (!slots) throw new Error('此帳戶尚未使用雙軌包裝金鑰。');
  const trimmed = String(secretInput || '').trim();
  if (!trimmed) {
    throw new Error(
      i18next.t('cloudSync.currentSecretRequired', {
        defaultValue: '請輸入目前同步密碼（或備用 Recovery Key）進行驗證。',
      })
    );
  }
  const keyVersion = currentKeyVersion();
  if (/^URE1-/i.test(trimmed) && slots.recovery) {
    const secret = await parseRecoveryKey(trimmed);
    const { dekBytes } = await unwrapDekFromRecoverySlot(
      slots.recovery,
      secret,
      currentAccountId(),
      keyVersion
    );
    return dekBytes;
  }
  if (slots.password) {
    const { dekBytes } = await unwrapDekFromPasswordSlot(
      slots.password,
      secretInput,
      currentAccountId(),
      keyVersion
    );
    return dekBytes;
  }
  throw new Error('找不到可用的驗證插槽。');
}

async function handleSavePasswordManage(event) {
  event?.preventDefault?.();
  if (busy || !session || !encryptionContext) return;
  const newPwd =
    document.getElementById('cloud-sync-change-new-password')?.value || '';
  const confirmPwd =
    document.getElementById('cloud-sync-change-confirm-password')?.value || '';
  if (newPwd.length < MIN_PASSWORD_LENGTH) {
    setStatus(
      i18next.t('cloudSync.passwordTooShort', {
        defaultValue: `同步密碼至少需要 ${MIN_PASSWORD_LENGTH} 個字元。`,
        min: MIN_PASSWORD_LENGTH,
      }),
      true
    );
    return;
  }
  if (newPwd !== confirmPwd) {
    setStatus(
      i18next.t('cloudSync.passwordMismatch', {
        defaultValue: '兩次輸入的密碼不一致。',
      }),
      true
    );
    return;
  }

  setBusy(true);
  const previousContext = { ...encryptionContext };
  try {
    requireEncryptedLocalStorage();
    await refreshRemoteDocument();
    if (manageMode === 'upgrade') {
      if (remoteDocument.envelope) await mergeRemoteIntoLocal();
      const dekBytes = new Uint8Array(randomBytes(32));
      const recovery = await createRecoveryKey();
      const keyVersion = currentKeyVersion() + 1;
      const salt = randomBytes(16);
      const keySlots = await createKeySlots({
        dekBytes,
        password: newPwd,
        recoverySecret: recovery.secret,
        accountId: currentAccountId(),
        keyVersion,
      });
      const dekKey = await importDekKey(dekBytes);
      dekBytes.fill(0);
      encryptionContext = {
        key: dekKey,
        salt,
        keyVersion,
        payloadSchemaVersion: 2,
        keySlots,
      };
      await useAccountEncryptionKey(currentAccountId(), dekKey, {
        salt,
        keyVersion,
        payloadSchemaVersion: 2,
        keySlots,
      });
      await uploadCurrentData({ force: true });
      restoreData(callbacks.getData());
      rotatedRecoveryDisplay = recovery.display;
      manageMode = null;
      setStatus(
        i18next.t('cloudSync.upgradeSuccess', {
          defaultValue:
            '已升級為「自訂密碼 + 備用 Key」模式，請妥善備份新產生的 Recovery Key。',
        })
      );
    } else {
      const currentSecret =
        document.getElementById('cloud-sync-current-secret-input')?.value || '';
      const dekBytes = await unwrapCurrentDekForManage(currentSecret);
      try {
        const keyVersion = currentKeyVersion();
        const passwordOnly = await createKeySlots({
          dekBytes,
          password: newPwd,
          accountId: currentAccountId(),
          keyVersion,
        });
        const updatedSlots = {
          ...encryptionContext.keySlots,
          password: passwordOnly.password,
        };
        encryptionContext = {
          ...encryptionContext,
          payloadSchemaVersion: 2,
          keySlots: updatedSlots,
        };
        await useAccountEncryptionKey(
          currentAccountId(),
          encryptionContext.key,
          {
            salt: encryptionContext.salt,
            keyVersion,
            payloadSchemaVersion: 2,
            keySlots: updatedSlots,
          }
        );
        await uploadCurrentData({ force: true });
        manageMode = null;
        setStatus(
          i18next.t('cloudSync.passwordChanged', {
            defaultValue: '同步密碼已更新；雲端歷史版本與備用 Key 皆維持可用。',
          })
        );
      } finally {
        dekBytes.fill(0);
      }
    }
    [
      'cloud-sync-current-secret-input',
      'cloud-sync-change-new-password',
      'cloud-sync-change-confirm-password',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  } catch (error) {
    console.error('[CloudSync Password Update Failed]:', error);
    encryptionContext = previousContext;
    await useAccountEncryptionKey(currentAccountId(), previousContext.key, {
      salt: previousContext.salt,
      keyVersion: previousContext.keyVersion,
      payloadSchemaVersion: previousContext.payloadSchemaVersion,
      keySlots: previousContext.keySlots,
    });
    setStatus(error.message || '更新同步密碼失敗。', true);
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function handleLegacyRotate() {
  if (busy || !session || !encryptionContext) return;
  setBusy(true);
  const previousContext = encryptionContext;
  const previousRecovery = pendingRecovery;
  const previousDisplay = currentRecoveryDisplay();
  try {
    await refreshRemoteDocument();
    if (!remoteDocument.envelope)
      throw new Error(
        i18next.t('cloudSync.noRemoteData', {
          defaultValue: '目前沒有雲端備份。',
        })
      );
    await mergeRemoteIntoLocal();
    const generated = await createRecoveryKey();
    const salt = randomBytes(16);
    const keyVersion = currentKeyVersion() + 1;
    const key = await deriveEncryptionKey(
      generated.secret,
      salt,
      `URL Editor E2EE v1:${currentAccountId()}`
    );
    await useAccountEncryptionKey(currentAccountId(), key, {
      salt,
      keyVersion,
      payloadSchemaVersion: 1,
      keySlots: null,
    });
    encryptionContext = {
      key,
      salt,
      keyVersion,
      payloadSchemaVersion: 1,
      keySlots: null,
    };
    pendingRecovery = generated;
    const display = document.getElementById('cloud-sync-recovery-display');
    if (display) display.textContent = generated.display;
    await uploadCurrentData({ force: true });
    // Re-encrypt the same-device IndexedDB record with the new key as well.
    restoreData(callbacks.getData());
    await refreshHistory();
    setStatus(
      i18next.t('cloudSync.rotationSuccess', {
        defaultValue: 'Recovery Key 已旋轉，請重新備份新 Key。',
      })
    );
  } catch (error) {
    console.error('[CloudSync Recovery Key Rotate Failed]:', error);
    encryptionContext = previousContext;
    pendingRecovery = previousRecovery;
    if (previousContext) {
      await useAccountEncryptionKey(currentAccountId(), previousContext.key, {
        salt: previousContext.salt,
        keyVersion: previousContext.keyVersion,
      });
    }
    const display = document.getElementById('cloud-sync-recovery-display');
    if (display) display.textContent = previousDisplay;
    setStatus(error.message || 'Recovery Key 旋轉失敗。', true);
  } finally {
    setBusy(false);
    updateControls();
  }
}

function handleRotateButtonClick() {
  if (busy || !session || !encryptionContext) return;
  if (!encryptionContext.keySlots) {
    void handleLegacyRotate();
    return;
  }
  manageMode = manageMode === 'rotateRecovery' ? null : 'rotateRecovery';
  updateControls();
}

async function handleConfirmRotateRecovery(event) {
  event?.preventDefault?.();
  if (busy || !session || !encryptionContext?.keySlots) return;
  setBusy(true);
  const previousContext = { ...encryptionContext };
  try {
    const pwd =
      document.getElementById('cloud-sync-rotate-password-input')?.value || '';
    if (!pwd) {
      throw new Error(
        i18next.t('cloudSync.passwordRequired', {
          defaultValue: '請輸入目前同步密碼。',
        })
      );
    }
    const keyVersion = currentKeyVersion();
    const { dekBytes } = await unwrapDekFromPasswordSlot(
      encryptionContext.keySlots.password,
      pwd,
      currentAccountId(),
      keyVersion
    );
    try {
      const recovery = await createRecoveryKey();
      const recoveryOnly = await createKeySlots({
        dekBytes,
        recoverySecret: recovery.secret,
        accountId: currentAccountId(),
        keyVersion,
      });
      const updatedSlots = {
        ...encryptionContext.keySlots,
        recovery: recoveryOnly.recovery,
      };
      encryptionContext = {
        ...encryptionContext,
        payloadSchemaVersion: 2,
        keySlots: updatedSlots,
      };
      await useAccountEncryptionKey(currentAccountId(), encryptionContext.key, {
        salt: encryptionContext.salt,
        keyVersion,
        payloadSchemaVersion: 2,
        keySlots: updatedSlots,
      });
      await uploadCurrentData({ force: true });
      rotatedRecoveryDisplay = recovery.display;
      manageMode = null;
      const input = document.getElementById('cloud-sync-rotate-password-input');
      if (input) input.value = '';
      setStatus(
        i18next.t('cloudSync.rotationSuccess', {
          defaultValue:
            '備用 Recovery Key 已更新，請立即複製或下載保存（同步密碼維持不變）。',
        })
      );
    } finally {
      dekBytes.fill(0);
    }
  } catch (error) {
    console.error('[CloudSync Rotate Recovery Failed]:', error);
    encryptionContext = previousContext;
    await useAccountEncryptionKey(currentAccountId(), previousContext.key, {
      salt: previousContext.salt,
      keyVersion: previousContext.keyVersion,
      payloadSchemaVersion: previousContext.payloadSchemaVersion,
      keySlots: previousContext.keySlots,
    });
    setStatus(error.message || '重設備用 Recovery Key 失敗。', true);
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function handleHistoryRestore() {
  if (busy || !session || !encryptionContext) return;
  const revision = Number(
    document.getElementById('cloud-sync-history-select')?.value || 0
  );
  if (!Number.isInteger(revision) || revision < 1) return;
  setBusy(true);
  try {
    const envelope = await getSyncRevision(revision, csrfToken);
    const historicalData = await decryptCloudEnvelope(envelope);
    restoreData(mergeSyncData(callbacks.getData(), historicalData));
    scheduleAutomaticSync();
    setStatus(
      i18next.t('cloudSync.historyRestoreSuccess', {
        defaultValue: '已合併歷史版本；稍後會建立新的同步版本。',
        revision,
      })
    );
  } catch (error) {
    console.error('[CloudSync History Restore Failed]:', error);
    setStatus(
      error.message ||
        i18next.t('cloudSync.historyRestoreError', {
          defaultValue: '無法解密或復原歷史版本。',
        }),
      true
    );
  } finally {
    setBusy(false);
    updateControls();
  }
}

function scheduleAutomaticSync({ retry = false } = {}) {
  if (
    suppressAutomaticSync ||
    !CLOUD_ENABLED ||
    !session ||
    !encryptionContext ||
    firstUploadRequired
  )
    return;
  if (!retry) {
    syncRetryAttempt = 0;
    conflictFailures = 0;
  }
  clearTimeout(syncTimer);
  const delay = retry
    ? Math.min(60_000, 5_000 * 2 ** Math.min(syncRetryAttempt, 4))
    : 2_000;
  syncTimer = setTimeout(async () => {
    syncTimer = null;
    if (busy) {
      scheduleAutomaticSync({ retry: true });
      return;
    }
    try {
      await uploadCurrentData({ force: false });
    } catch (error) {
      console.warn('[CloudSync Auto Sync Failed (will retry)]:', error);
      syncRetryAttempt += 1;
      if (error instanceof CloudApiError && error.status === 409) {
        conflictFailures += 1;
      } else {
        conflictFailures = 0;
      }
      if (conflictFailures >= MAX_CONFLICT_RETRIES) {
        // Give up until the next local edit or a manual sync.
        setStatus(
          i18next.t('cloudSync.autoSyncConflictStopped', {
            defaultValue:
              '自動同步因反覆衝突而暫停；請稍後再試，或手動按「立即同步」。',
          }),
          true
        );
        return;
      }
      setStatus(error.message || '自動同步失敗，稍後會重試。', true);
      scheduleAutomaticSync({ retry: true });
    }
  }, delay);
}

async function handleLogout() {
  if (busy || !session) return;
  setBusy(true);
  try {
    const accountId = currentAccountId();
    await logout(csrfToken);
    await deleteCurrentAccountLocalState(accountId);
    window.location.href = '/';
  } catch (error) {
    console.error('[CloudSync Logout Failed]:', error);
    setStatus(error.message || '登出失敗。', true);
    setBusy(false);
  }
}

async function handleDeleteAccount() {
  if (busy || !session) return;
  const confirmation = window.prompt(
    i18next.t('cloudSync.deletePrompt', {
      defaultValue: '輸入 DELETE 確認刪除帳戶與雲端密文：',
    })
  );
  if (confirmation !== 'DELETE') return;
  setBusy(true);
  try {
    const accountId = currentAccountId();
    await deleteAccount(csrfToken, confirmation);
    await deleteCurrentAccountLocalState(accountId);
    window.location.href = '/';
  } catch (error) {
    console.error('[CloudSync Delete Account Failed]:', error);
    setStatus(error.message || '刪除帳戶失敗。', true);
    setBusy(false);
  }
}

export function initCloudSyncModal(options = {}) {
  if (options.getData) callbacks.getData = options.getData;
  if (options.onRestore) callbacks.onRestore = options.onRestore;
  if (initialized) return;
  ensureCloudSyncUi();
  const dialog = document.getElementById('cloud-sync-modal');
  if (!dialog) return;
  document
    .getElementById('cloud-sync-close-btn')
    ?.addEventListener('click', () => closeDialog(dialog));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
  document
    .getElementById('cloud-sync-login-btn')
    ?.addEventListener('click', () => {
      window.location.href = '/login?returnTo=/app';
    });

  // Option B first-time setup
  document
    .getElementById('cloud-sync-new-password')
    ?.addEventListener('input', updatePasswordStrengthDisplay);
  document
    .getElementById('cloud-sync-toggle-new-pwd-btn')
    ?.addEventListener('click', () =>
      togglePasswordInput(
        'cloud-sync-new-password',
        'cloud-sync-toggle-new-pwd-btn'
      )
    );
  document
    .getElementById('cloud-sync-setup-form')
    ?.addEventListener('submit', handleCreateVault);
  document
    .getElementById('cloud-sync-copy-backup-btn')
    ?.addEventListener('click', () =>
      copyTextValue(pendingSetup?.recovery?.display)
    );
  document
    .getElementById('cloud-sync-download-backup-btn')
    ?.addEventListener('click', () =>
      downloadKeyFile(pendingSetup?.recovery?.display)
    );
  document
    .getElementById('cloud-sync-backup-confirmed')
    ?.addEventListener('change', updateControls);
  document
    .getElementById('cloud-sync-activate-btn')
    ?.addEventListener('click', handleActivateVault);

  // Option B password unlock & toggle to Recovery Key
  document
    .getElementById('cloud-sync-toggle-unlock-pwd-btn')
    ?.addEventListener('click', () =>
      togglePasswordInput(
        'cloud-sync-unlock-password',
        'cloud-sync-toggle-unlock-pwd-btn'
      )
    );
  document
    .getElementById('cloud-sync-unlock-form')
    ?.addEventListener('submit', handlePasswordUnlock);
  document
    .getElementById('cloud-sync-use-recovery-btn')
    ?.addEventListener('click', () => {
      recoveryUnlockMode = true;
      updateControls();
    });
  document
    .getElementById('cloud-sync-back-to-password-btn')
    ?.addEventListener('click', () => {
      recoveryUnlockMode = false;
      updateControls();
    });

  // Legacy / Recovery Key unlock
  document
    .getElementById('cloud-sync-generate-btn')
    ?.addEventListener('click', handleGenerateRecoveryKey);
  document
    .getElementById('cloud-sync-copy-key-btn')
    ?.addEventListener('click', copyRecoveryKey);
  document
    .getElementById('cloud-sync-download-key-btn')
    ?.addEventListener('click', downloadRecoveryKey);
  document
    .getElementById('cloud-sync-unlock-btn')
    ?.addEventListener('click', handleUnlock);

  // Unlocked operations & key management
  document
    .getElementById('cloud-sync-upload-btn')
    ?.addEventListener('click', handleManualUpload);
  document
    .getElementById('cloud-sync-download-btn')
    ?.addEventListener('click', handleDownload);
  document
    .getElementById('cloud-sync-open-password-btn')
    ?.addEventListener('click', () => {
      manageMode = manageMode === 'changePassword' ? null : 'changePassword';
      updateControls();
    });
  document
    .getElementById('cloud-sync-open-upgrade-btn')
    ?.addEventListener('click', () => {
      manageMode = manageMode === 'upgrade' ? null : 'upgrade';
      updateControls();
    });
  document
    .getElementById('cloud-sync-password-manage-panel')
    ?.addEventListener('submit', handleSavePasswordManage);
  document
    .getElementById('cloud-sync-cancel-manage-btn')
    ?.addEventListener('click', () => {
      manageMode = null;
      updateControls();
    });
  document
    .getElementById('cloud-sync-rotate-btn')
    ?.addEventListener('click', handleRotateButtonClick);
  document
    .getElementById('cloud-sync-rotate-panel')
    ?.addEventListener('submit', handleConfirmRotateRecovery);
  document
    .getElementById('cloud-sync-cancel-rotate-btn')
    ?.addEventListener('click', () => {
      manageMode = null;
      updateControls();
    });
  document
    .getElementById('cloud-sync-copy-rotated-btn')
    ?.addEventListener('click', () => copyTextValue(rotatedRecoveryDisplay));
  document
    .getElementById('cloud-sync-download-rotated-btn')
    ?.addEventListener('click', () => downloadKeyFile(rotatedRecoveryDisplay));

  document
    .getElementById('cloud-sync-history-refresh-btn')
    ?.addEventListener('click', refreshHistory);
  document
    .getElementById('cloud-sync-history-restore-btn')
    ?.addEventListener('click', handleHistoryRestore);
  document
    .getElementById('cloud-sync-logout-btn')
    ?.addEventListener('click', handleLogout);
  document
    .getElementById('cloud-sync-delete-account-btn')
    ?.addEventListener('click', handleDeleteAccount);
  window.addEventListener('url-editor-data-change', (event) => {
    // Only a save that carries user content (URLs or presets) means the data
    // is no longer just the placeholder. View/sort saves and tombstones do not.
    const detail = event?.detail;
    if (
      !suppressAutomaticSync &&
      (detail?.urls?.length > 0 || detail?.presets?.length > 0)
    )
      placeholderOnly = false;
    scheduleAutomaticSync();
  });
  window.addEventListener('offline', handleNetworkChange);
  window.addEventListener('online', handleNetworkChange);
  initialized = true;
  void refreshSession();
}

export function openCloudSyncModal(options = {}) {
  if (options.onRestore) callbacks.onRestore = options.onRestore;
  ensureCloudSyncUi();
  const dialog = document.getElementById('cloud-sync-modal');
  if (!dialog) return;
  openDialog(dialog);
  updateControls();
  void refreshSession();
}

export const cloudSyncInternals = { buildCloudPayload, aadFor, mergeSyncData };
