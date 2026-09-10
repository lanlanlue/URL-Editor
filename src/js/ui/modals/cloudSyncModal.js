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
  createRecoveryKey,
  decodeBytes,
  decryptJson,
  deriveEncryptionKey,
  encryptJson,
  encodeBytes,
  parseRecoveryKey,
  randomBytes,
} from '../../core/cryptoVault.js';
import {
  clearGuestState,
  deleteCurrentAccountLocalState,
  getAccountEncryptionKey,
  getStorageMode,
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
let session = null;
let csrfToken = '';
let remoteDocument = { envelope: null, etag: '"rev-0"', revision: 0 };
let encryptionContext = null;
let pendingRecovery = null;
let firstUploadRequired = false;
let guestMigrationPending = false;
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
    'cloud-sync-unlock-btn',
    'cloud-sync-generate-btn',
    'cloud-sync-upload-btn',
    'cloud-sync-download-btn',
    'cloud-sync-rotate-btn',
    'cloud-sync-history-refresh-btn',
    'cloud-sync-history-restore-btn',
    'cloud-sync-logout-btn',
    'cloud-sync-delete-account-btn',
  ].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = value;
  });
}

function currentRecoveryDisplay() {
  return (
    document
      .getElementById('cloud-sync-recovery-display')
      ?.textContent.trim() || ''
  );
}

async function copyRecoveryKey() {
  const value = currentRecoveryDisplay();
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

function downloadRecoveryKey() {
  const value = currentRecoveryDisplay();
  if (!value) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(
    new Blob([`${value}\n`], { type: 'text/plain;charset=utf-8' })
  );
  link.download = 'url-editor-recovery-key.txt';
  link.click();
  URL.revokeObjectURL(link.href);
}

function currentAccountId() {
  return session?.user?.id || session?.accountId || '';
}

function currentKeyVersion() {
  return encryptionContext?.keyVersion || 1;
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

function aadFor(accountId, keyVersion, revision) {
  return JSON.stringify({
    accountId,
    payloadSchemaVersion: 1,
    keyVersion,
    revision,
  });
}

async function encryptCloudPayload(payload, revision) {
  const keyVersion = currentKeyVersion();
  const aad = aadFor(currentAccountId(), keyVersion, revision);
  const encrypted = await encryptJson(payload, encryptionContext.key, aad);
  return {
    revision,
    payloadSchemaVersion: 1,
    keyVersion,
    kdfSalt: encodeBytes(encryptionContext.salt),
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext,
  };
}

async function decryptCloudEnvelope(envelope) {
  if (!envelope || !encryptionContext)
    throw new Error('Recovery Key is required.');
  const aad = aadFor(
    currentAccountId(),
    envelope.keyVersion,
    envelope.revision
  );
  return decryptJson({ ...envelope, aad }, encryptionContext.key, aad);
}

function updateControls() {
  const loggedIn = Boolean(session);
  const unlocked = Boolean(encryptionContext);
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
  const accountName = document.getElementById('cloud-sync-account-name');
  if (accountName)
    accountName.textContent = session?.user?.email || session?.user?.name || '';
  const loginButton = document.getElementById('cloud-sync-login-btn');
  if (loginButton) loginButton.disabled = !CLOUD_ENABLED || busy;
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
      remoteDocument = { envelope: null, etag: '"rev-0"', revision: 0 };
      firstUploadRequired = false;
      guestMigrationPending = false;
      updateControls();
      return;
    }
    const stored = await getAccountEncryptionKey(currentAccountId());
    if (stored?.key && stored.salt) {
      await useAccountEncryptionKey(currentAccountId(), stored.key, {
        salt: stored.salt,
        keyVersion: stored.keyVersion || 1,
      });
      encryptionContext = {
        key: stored.key,
        salt: stored.salt,
        keyVersion: stored.keyVersion || 1,
      };
      const localAccountState = await loadAccountState(
        currentAccountId(),
        stored.key
      );
      if (localAccountState) {
        restoreData(mergeSyncData(callbacks.getData(), localAccountState));
      }
      await refreshRemoteDocument();
      if (remoteDocument.envelope) {
        const remoteData = await decryptCloudEnvelope(remoteDocument.envelope);
        restoreData(mergeSyncData(callbacks.getData(), remoteData));
      }
      await refreshHistory();
    }
    updateControls();
  } catch (error) {
    session = null;
    encryptionContext = null;
    updateControls();
    setStatus(error.message || 'Unable to load cloud session.', true);
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
  const previousContext = encryptionContext;
  const previousFirstUploadRequired = firstUploadRequired;
  const previousGuestMigrationPending = guestMigrationPending;
  const previousRecovery = pendingRecovery;
  encryptionContext = { key, salt, keyVersion };
  try {
    let restoredData = callbacks.getData();
    if (remoteDocument.envelope) {
      const remoteData = await decryptCloudEnvelope(remoteDocument.envelope);
      restoredData = mergeSyncData(restoredData, remoteData);
      firstUploadRequired = false;
    } else {
      firstUploadRequired = generated;
    }
    await useAccountEncryptionKey(currentAccountId(), key, {
      salt,
      keyVersion,
    });
    guestMigrationPending = true;
    pendingRecovery = null;
    const input = document.getElementById('cloud-sync-recovery-input');
    if (input) input.value = '';
    restoreData(restoredData);
    await refreshHistory();
    updateControls();
  } catch (error) {
    encryptionContext = previousContext;
    firstUploadRequired = previousFirstUploadRequired;
    guestMigrationPending = previousGuestMigrationPending;
    pendingRecovery = previousRecovery;
    throw error;
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
    await unlockWithSecret(secret, Boolean(pendingRecovery));
    setStatus(
      i18next.t('cloudSync.unlocked', {
        defaultValue: '已解鎖端到端加密同步。',
      })
    );
  } catch (error) {
    setStatus(error.message || 'Recovery Key 無效。', true);
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function uploadCurrentData({ force = false, retry = true } = {}) {
  requireEncryptedLocalStorage();
  if (!session || !encryptionContext)
    throw new Error('請先登入並解鎖 Recovery Key。');
  if (firstUploadRequired && !force) return;
  await refreshRemoteDocument();
  const nextRevision = Number(remoteDocument.revision || 0) + 1;
  const envelope = await encryptCloudPayload(
    buildCloudPayload(callbacks.getData()),
    nextRevision
  );
  try {
    const result = await putSyncDocument(
      envelope,
      csrfToken,
      remoteDocument.etag
    );
    remoteDocument = {
      envelope: result.document || result.envelope || envelope,
      etag: result.etag || `"rev-${nextRevision}"`,
      revision: result.revision || nextRevision,
    };
    firstUploadRequired = false;
    syncRetryAttempt = 0;
    if (guestMigrationPending) {
      await clearGuestState();
      guestMigrationPending = false;
    }
    setStatus(
      i18next.t('cloudSync.syncSuccess', { defaultValue: '加密資料已同步。' })
    );
  } catch (error) {
    if (error instanceof CloudApiError && error.status === 409 && retry) {
      await refreshRemoteDocument();
      if (remoteDocument.envelope) {
        const remoteData = await decryptCloudEnvelope(remoteDocument.envelope);
        restoreData(mergeSyncData(callbacks.getData(), remoteData));
      }
      await uploadCurrentData({ force: true, retry: false });
      await refreshHistory();
      return;
    }
    throw error;
  }
}

async function handleManualUpload() {
  if (busy) return;
  setBusy(true);
  try {
    await uploadCurrentData({ force: true });
  } catch (error) {
    setStatus(error.message || '同步失敗。', true);
  } finally {
    setBusy(false);
    updateControls();
    await refreshHistory();
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
    restoreData(
      mergeSyncData(
        callbacks.getData(),
        await decryptCloudEnvelope(remoteDocument.envelope)
      )
    );
    setStatus(
      i18next.t('cloudSync.restoreSuccess', {
        defaultValue: '已下載並合併加密資料。',
      })
    );
  } catch (error) {
    setStatus(error.message || '下載失敗。', true);
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function handleRotate() {
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
    restoreData(
      mergeSyncData(
        callbacks.getData(),
        await decryptCloudEnvelope(remoteDocument.envelope)
      )
    );
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
    });
    encryptionContext = { key, salt, keyVersion };
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
  if (!retry) syncRetryAttempt = 0;
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
      syncRetryAttempt += 1;
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
  document
    .getElementById('cloud-sync-upload-btn')
    ?.addEventListener('click', handleManualUpload);
  document
    .getElementById('cloud-sync-download-btn')
    ?.addEventListener('click', handleDownload);
  document
    .getElementById('cloud-sync-rotate-btn')
    ?.addEventListener('click', handleRotate);
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
  window.addEventListener('url-editor-data-change', scheduleAutomaticSync);
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
