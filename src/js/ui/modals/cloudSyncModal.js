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
  hasUnreadableGuestRecord,
  loadAccountState,
  useAccountEncryptionKey,
} from '../../core/secureStorage.js';
import { mergeSyncData } from '../../core/syncMerge.js';
import { CLOUD_ENABLED } from '../../core/runtimeConfig.js';
import CLOUD_SYNC_MARKUP from './cloudSyncMarkup.js';

let initialized = false;
let busy = false;
let sessionRefreshPending = false;
let accountEpoch = 0;
let sessionRefreshGeneration = 0;
let syncTimer = null;
let syncRetryAttempt = 0;
// Consecutive automatic syncs that ended in a 409 conflict. Each one costs two
// PUTs against the server's 120/h limit, so automatic retries stop at the cap.
const MAX_CONFLICT_RETRIES = 5;
let conflictFailures = 0;
let session = null;
// Plaintext ownership survives transient session lookup failures. A null
// session must never make previous-account data look like anonymous guest data.
let memoryAccountId = '';
let csrfToken = '';
let remoteDocument = { envelope: null, etag: '"rev-0"', revision: 0 };
// The remote state this device last merged or uploaded (B12). Uploads send
// syncedEtag as If-Match so the server answers 409 when another device has
// written since; null means this page session has not synced yet.
let syncedEtag = null;
let syncedRevision = 0;
let encryptionContext = null;
let pendingRecovery = null;
// Keep the committed rotation key copyable even while unlocked or signed out.
let rotationBackupRequired = false;
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

function restoreData(data, options) {
  suppressAutomaticSync = true;
  placeholderOnly = false;
  try {
    return options
      ? callbacks.onRestore(data, options)
      : callbacks.onRestore(data);
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
  if (!value && sessionRefreshPending) void requestSessionRefresh();
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
    const input = document.getElementById('cloud-sync-recovery-input');
    if (input && pendingRecovery) {
      input.value = value;
    }
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
  const input = document.getElementById('cloud-sync-recovery-input');
  if (input && pendingRecovery) {
    input.value = value;
  }
}

function currentAccountId() {
  return session?.user?.id || session?.accountId || '';
}

function accountSnapshot() {
  return Object.freeze({ accountId: currentAccountId(), epoch: accountEpoch });
}

function isCurrentAccount(snapshot) {
  return (
    snapshot.accountId === currentAccountId() && snapshot.epoch === accountEpoch
  );
}

function assertCurrentAccount(snapshot, context) {
  if (
    !isCurrentAccount(snapshot) ||
    (snapshot.accountId && memoryAccountId !== snapshot.accountId) ||
    (context && context.key !== encryptionContext?.key)
  )
    throw new Error('帳戶或加密金鑰已變更；已停止舊操作。');
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
  // Capture all AAD/envelope inputs before yielding, including salt bytes.
  const snapshot = Object.freeze({
    accountId: currentAccountId(),
    key: encryptionContext.key,
    keyVersion: currentKeyVersion(),
    kdfSalt: encodeBytes(encryptionContext.salt),
    revision,
  });
  const { accountId, key, keyVersion, kdfSalt } = snapshot;
  const aad = aadFor(accountId, keyVersion, snapshot.revision);
  const encrypted = await encryptJson(payload, key, aad);
  return {
    revision,
    payloadSchemaVersion: 1,
    keyVersion,
    kdfSalt,
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
    CLOUD_ENABLED && ((loggedIn && !unlocked) || rotationBackupRequired)
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
  const identity = accountSnapshot();
  const result = await getSyncDocument(csrfToken);
  assertCurrentAccount(identity);
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
  const identity = accountSnapshot();
  const context = encryptionContext;
  const remote = remoteDocument;
  if (remote.envelope) {
    const remoteData = await decryptCloudEnvelope(remote.envelope);
    assertCurrentAccount(identity, context);
    if (remote !== remoteDocument) throw new Error('雲端版本已變更；請重試。');
    restoreData(mergeSyncData(callbacks.getData(), remoteData));
  }
  assertCurrentAccount(identity, context);
  markRemoteSynced();
}

async function refreshHistory() {
  if (!session) return;
  const identity = accountSnapshot();
  const select = document.getElementById('cloud-sync-history-select');
  if (!select) return;
  try {
    const revisions = await listSyncRevisions(csrfToken);
    assertCurrentAccount(identity);
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
    if (isCurrentAccount(identity))
      setStatus(error.message || '無法讀取歷史版本。', true);
  }
}

// Reopen refreshes share the operation lock and coalesce without being lost.
async function requestSessionRefresh() {
  if (busy) {
    sessionRefreshPending = true;
    return;
  }
  sessionRefreshPending = false;
  setBusy(true);
  try {
    await refreshSession();
  } finally {
    setBusy(false);
    updateControls();
  }
}

function clearAccountContext() {
  clearTimeout(syncTimer);
  syncTimer = null;
  encryptionContext = null;
  pendingRecovery = null;
  remoteDocument = { envelope: null, etag: '"rev-0"', revision: 0 };
  clearSyncedRemote();
  firstUploadRequired = false;
  guestMigrationPending = false;
  placeholderOnly = false;
}

function clearAccountPlaintext() {
  if (!memoryAccountId) return;
  // Clear ownership only after the application confirms the memory reset.
  // If rendering fails, the next refresh must retry before loading a new key.
  restoreData(buildCloudPayload(null), { accountTransition: true });
  memoryAccountId = '';
}

async function refreshSession() {
  if (!CLOUD_ENABLED) {
    updateControls();
    return;
  }
  const generation = ++sessionRefreshGeneration;
  let identity = accountSnapshot();
  let sessionLoaded = false;
  try {
    const previousAccountId = currentAccountId();
    const nextSession = await getSession();
    if (generation !== sessionRefreshGeneration || !isCurrentAccount(identity))
      return;
    session = nextSession;
    sessionLoaded = true;
    csrfToken = session?.csrfToken || '';
    if (
      currentAccountId() !== previousAccountId ||
      (memoryAccountId && memoryAccountId !== currentAccountId())
    ) {
      accountEpoch += 1;
      identity = accountSnapshot();
      clearAccountContext();
      if (memoryAccountId !== currentAccountId()) clearAccountPlaintext();
    }
    memoryAccountId = currentAccountId();
    if (!session) {
      clearAccountContext();
      updateControls();
      return;
    }
    // Confirmed rotation may be newer than persistence after local failure.
    // Never downgrade an active same-account memory context on reopen.
    const stored =
      encryptionContext || (await getAccountEncryptionKey(currentAccountId()));
    if (generation !== sessionRefreshGeneration) return;
    assertCurrentAccount(identity);
    if (stored?.key && stored.salt) {
      await useAccountEncryptionKey(identity.accountId, stored.key, {
        salt: stored.salt,
        keyVersion: stored.keyVersion || 1,
      });
      if (generation !== sessionRefreshGeneration) return;
      assertCurrentAccount(identity);
      encryptionContext = {
        key: stored.key,
        salt: stored.salt,
        keyVersion: stored.keyVersion || 1,
      };
      const localAccountState = await loadAccountState(
        identity.accountId,
        stored.key
      );
      if (generation !== sessionRefreshGeneration) return;
      assertCurrentAccount(identity);
      if (localAccountState) {
        restoreData(mergeSyncData(callbacks.getData(), localAccountState));
      }
      await refreshRemoteDocument();
      await mergeRemoteIntoLocal();
      await refreshHistory();
    }
    updateControls();
  } catch (error) {
    if (generation !== sessionRefreshGeneration || !isCurrentAccount(identity))
      return;
    // A valid authenticated session with an unreadable persisted key must
    // remain usable for manual Recovery Key unlock, not become a login loop.
    if (!sessionLoaded) {
      accountEpoch += 1;
      session = null;
      csrfToken = '';
      clearAccountContext();
      try {
        clearAccountPlaintext();
      } catch {
        // Keep memoryAccountId until clearing succeeds. A future account
        // cannot load its key or upload this plaintext before that retry.
      }
    }
    encryptionContext = null;
    clearSyncedRemote();
    updateControls();
    setStatus(error.message || 'Unable to load cloud session.', true);
  }
}

async function unlockWithSecret(secret, generated = false) {
  requireEncryptedLocalStorage();
  const identity = accountSnapshot();
  assertCurrentAccount(identity);
  await refreshRemoteDocument();
  assertCurrentAccount(identity);
  const existingSalt = remoteDocument.envelope?.kdfSalt
    ? decodeBytes(remoteDocument.envelope.kdfSalt)
    : null;
  const salt = existingSalt || encryptionContext?.salt || randomBytes(16);
  const keyVersion = remoteDocument.envelope?.keyVersion || 1;
  const key = await deriveEncryptionKey(
    secret,
    salt,
    `URL Editor E2EE v1:${identity.accountId}`
  );
  assertCurrentAccount(identity);
  const previousContext = encryptionContext;
  const previousFirstUploadRequired = firstUploadRequired;
  const previousGuestMigrationPending = guestMigrationPending;
  const previousPlaceholderOnly = placeholderOnly;
  const previousRecovery = pendingRecovery;
  const previousSyncedEtag = syncedEtag;
  const previousSyncedRevision = syncedRevision;
  encryptionContext = { key, salt, keyVersion };
  try {
    // An unreadable guest record is represented by an empty placeholder: it is
    // not the user's data, so it is neither merged, migrated nor uploaded.
    const guestUnreadable = hasUnreadableGuestRecord();
    let restoredData = guestUnreadable ? null : callbacks.getData();
    if (remoteDocument.envelope) {
      const remoteData = await decryptCloudEnvelope(remoteDocument.envelope);
      assertCurrentAccount(identity, { key });
      restoredData = restoredData
        ? mergeSyncData(restoredData, remoteData)
        : remoteData;
      firstUploadRequired = false;
    } else {
      firstUploadRequired = generated;
    }
    assertCurrentAccount(identity, { key });
    await useAccountEncryptionKey(identity.accountId, key, {
      salt,
      keyVersion,
    });
    assertCurrentAccount(identity, { key });
    guestMigrationPending = !guestUnreadable;
    pendingRecovery = null;
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
    if (!isCurrentAccount(identity)) throw error;
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

async function handleGenerateRecoveryKey() {
  if (busy) return;
  setBusy(true);
  const identity = accountSnapshot();
  try {
    const generated = await createRecoveryKey();
    assertCurrentAccount(identity);
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
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function handleUnlock() {
  if (busy || !session) return;
  setBusy(true);
  const identity = accountSnapshot();
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
    assertCurrentAccount(identity);
    await unlockWithSecret(secret, Boolean(pendingRecovery));
    assertCurrentAccount(identity);
    setStatus(
      i18next.t('cloudSync.unlocked', {
        defaultValue: '已解鎖端到端加密同步。',
      })
    );
  } catch (error) {
    console.warn('[CloudSync Unlock Failed]:', error);
    setStatus(error.message || 'Recovery Key 無效。', true);
  } finally {
    setBusy(false);
    updateControls();
  }
}

async function uploadCurrentData({
  force = false,
  retry = true,
  expectedAccountId,
  onUploadStarted,
  onCommitted,
} = {}) {
  requireEncryptedLocalStorage();
  if (!session || !encryptionContext)
    throw new Error('請先登入並解鎖 Recovery Key。');
  const identity = accountSnapshot();
  const context = encryptionContext;
  assertCurrentAccount(identity, context);
  if (expectedAccountId && identity.accountId !== expectedAccountId)
    throw new Error('帳戶已變更；未上傳資料。');
  if (firstUploadRequired && !force) return false;
  if (placeholderOnly) {
    if (force)
      setStatus(
        i18next.t('cloudSync.placeholderUploadBlocked', {
          defaultValue:
            '本機資料無法讀取，尚無可上傳的資料；已略過上傳以避免覆蓋雲端資料。',
        }),
        true
      );
    return false;
  }
  if (syncedEtag === null) {
    // Never synced in this page session: merge the remote first, never
    // overwrite it with local-only data.
    await refreshRemoteDocument();
    assertCurrentAccount(identity, context);
    await mergeRemoteIntoLocal();
    assertCurrentAccount(identity, context);
  }
  // No fresh etag here: the server compares If-Match with its current
  // revision and answers 409 when another device has written since.
  const nextRevision = syncedRevision + 1;
  const requestCsrf = csrfToken;
  const requestEtag = syncedEtag;
  const envelope = await encryptCloudPayload(
    buildCloudPayload(callbacks.getData()),
    nextRevision
  );
  assertCurrentAccount(identity, context);
  let committed = false;
  try {
    if (onUploadStarted) onUploadStarted();
    const result = await putSyncDocument(envelope, requestCsrf, requestEtag);
    // A confirmed PUT is irreversible here. Never retry it because local
    // persistence, guest cleanup or UI rendering subsequently fails.
    committed = true;
    if (onCommitted) await onCommitted();
    assertCurrentAccount(identity, context);
    remoteDocument = {
      envelope: result.document || result.envelope || envelope,
      etag: result.etag || `"rev-${nextRevision}"`,
      revision: result.revision || nextRevision,
    };
    markRemoteSynced();
    firstUploadRequired = false;
    syncRetryAttempt = 0;
    conflictFailures = 0;
    if (guestMigrationPending) {
      await clearGuestState();
      assertCurrentAccount(identity, context);
      guestMigrationPending = false;
    }
    setStatus(
      i18next.t('cloudSync.syncSuccess', { defaultValue: '加密資料已同步。' })
    );
    return true;
  } catch (error) {
    if (committed) throw error;
    // Preserve a definitive HTTP rejection for the rotation rollback policy.
    // A stale operation must not retry, but must not turn a 4xx into an
    // apparently ambiguous transport failure either.
    if (!isCurrentAccount(identity) || context.key !== encryptionContext?.key)
      throw error;
    if (error instanceof CloudApiError && error.status === 409 && retry) {
      // Another device wrote first: merge its data, then retry exactly once.
      // A second conflict throws (retry: false) instead of overwriting.
      await refreshRemoteDocument();
      assertCurrentAccount(identity, context);
      await mergeRemoteIntoLocal();
      assertCurrentAccount(identity, context);
      const uploaded = await uploadCurrentData({
        force: true,
        retry: false,
        expectedAccountId: identity.accountId,
      });
      await refreshHistory();
      return uploaded;
    }
    if (
      error instanceof CloudApiError &&
      (error.status === 401 || error.status === 403) &&
      retry
    ) {
      await refreshSession();
      assertCurrentAccount(identity);
      if (session && csrfToken) {
        return uploadCurrentData({
          force,
          retry: false,
          expectedAccountId: identity.accountId,
        });
      }
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
    console.error('[CloudSync Manual Upload Failed]:', error);
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

async function handleRotate() {
  if (busy || !session || !encryptionContext) return;
  setBusy(true);
  const identity = accountSnapshot();
  const accountId = identity.accountId;
  const previousContext = encryptionContext;
  const previousRecovery = pendingRecovery;
  const previousDisplay = currentRecoveryDisplay();
  let committed = false;
  let uploadStarted = false;
  try {
    await refreshRemoteDocument();
    assertCurrentAccount(identity, previousContext);
    if (!remoteDocument.envelope)
      throw new Error(
        i18next.t('cloudSync.noRemoteData', {
          defaultValue: '目前沒有雲端備份。',
        })
      );
    await mergeRemoteIntoLocal();
    assertCurrentAccount(identity, previousContext);
    const generated = await createRecoveryKey();
    assertCurrentAccount(identity, previousContext);
    const salt = randomBytes(16);
    const keyVersion = currentKeyVersion() + 1;
    const key = await deriveEncryptionKey(
      generated.secret,
      salt,
      `URL Editor E2EE v1:${accountId}`
    );
    assertCurrentAccount(identity, previousContext);
    // Stage only in memory. A rejected PUT must not replace the stored key.
    encryptionContext = { key, salt, keyVersion };
    pendingRecovery = generated;
    const display = document.getElementById('cloud-sync-recovery-display');
    if (display) display.textContent = generated.display;
    const uploaded = await uploadCurrentData({
      force: true,
      // Rotation cannot merge a competing old-key document using the staged
      // new key, nor refresh/retry with a different account or stored context.
      retry: false,
      expectedAccountId: accountId,
      onUploadStarted: () => {
        uploadStarted = true;
      },
      onCommitted: async () => {
        committed = true;
        rotationBackupRequired = true;
        pendingRecovery = null;
        if (!isCurrentAccount(identity))
          throw new Error(
            '帳戶已變更；請重新登入原帳戶並使用新 Recovery Key 解鎖。'
          );
        await useAccountEncryptionKey(accountId, key, { salt, keyVersion });
        assertCurrentAccount(identity, { key });
      },
    });
    if (!uploaded) throw new Error('未上傳資料；Recovery Key 未旋轉。');
    assertCurrentAccount(identity, { key });
    // Re-encrypt the same-device IndexedDB record with the new key as well.
    restoreData(callbacks.getData());
    await refreshHistory();
    assertCurrentAccount(identity, { key });
    setStatus(
      i18next.t('cloudSync.rotationSuccess', {
        defaultValue:
          'Recovery Key 已旋轉，請備份新 Key；輪替前的歷史版本仍須保留對應的舊 Key 才能還原。',
      })
    );
  } catch (error) {
    console.error('[CloudSync Recovery Key Rotate Failed]:', error);
    if (committed) {
      // Keep the new display even if local finalization failed. There is no
      // server rollback API: this key is now the recovery path for ciphertext.
      setStatus(
        `雲端 Recovery Key 已旋轉，但本機收尾失敗：${error.message || '未知錯誤'}。請立即複製或下載上方新 Key，重新登入原帳戶後以新 Key 解鎖；請勿使用舊 Key 覆蓋雲端。`,
        true
      );
    } else if (
      uploadStarted &&
      !(
        error instanceof CloudApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408
      )
    ) {
      // A transport/5xx error is not evidence that the server rejected the PUT.
      // Preserve both recovery paths and stop old-key writes until re-unlocked.
      if (currentAccountId() === accountId) encryptionContext = null;
      pendingRecovery = null;
      rotationBackupRequired = true;
      setStatus(
        `無法確認雲端是否已旋轉 Recovery Key：${error.message || '未知錯誤'}。請備份上方新 Key 並保留舊 Key，重新登入原帳戶並讀取雲端確認後再解鎖；已暫停本帳戶上傳。`,
        true
      );
    } else {
      if (currentAccountId() === accountId) {
        encryptionContext = previousContext;
        pendingRecovery = previousRecovery;
      }
      const display = document.getElementById('cloud-sync-recovery-display');
      if (display) display.textContent = previousDisplay;
      // Refresh only after undoing the staged memory context. Stored context
      // was never changed, so expiration requires no fallible rollback write.
      if (
        currentAccountId() === accountId &&
        error instanceof CloudApiError &&
        (error.status === 401 || error.status === 403)
      )
        await refreshSession();
      setStatus(error.message || 'Recovery Key 旋轉失敗。', true);
    }
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
  const identity = accountSnapshot();
  const context = encryptionContext;
  try {
    const envelope = await getSyncRevision(revision, csrfToken);
    assertCurrentAccount(identity, context);
    let historicalData;
    if (envelope.keyVersion === currentKeyVersion()) {
      historicalData = await decryptCloudEnvelope(envelope);
    } else {
      // Historical secrets are transient: never replace the active sync/storage
      // key or persist the supplied Recovery Key.
      let recoveryInput = window.prompt(
        `此版本使用輪替前的 Recovery Key（版本 ${envelope.keyVersion}）。請輸入當時備份的舊 Key；取消不會更動資料。`
      );
      if (recoveryInput === null) return;
      try {
        const secret = await parseRecoveryKey(recoveryInput);
        const historicalKey = await deriveEncryptionKey(
          secret,
          decodeBytes(envelope.kdfSalt),
          `URL Editor E2EE v1:${identity.accountId}`
        );
        assertCurrentAccount(identity, context);
        const aad = aadFor(
          identity.accountId,
          envelope.keyVersion,
          envelope.revision
        );
        historicalData = await decryptJson(
          { ...envelope, aad },
          historicalKey,
          aad
        );
      } catch {
        throw new Error('舊 Recovery Key 無效或歷史版本已損壞；未更動資料。');
      } finally {
        recoveryInput = '';
      }
    }
    assertCurrentAccount(identity, context);
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
    setBusy(true);
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
    } finally {
      setBusy(false);
      updateControls();
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
  void requestSessionRefresh();
}

export function openCloudSyncModal(options = {}) {
  if (options.onRestore) callbacks.onRestore = options.onRestore;
  ensureCloudSyncUi();
  const dialog = document.getElementById('cloud-sync-modal');
  if (!dialog) return;
  openDialog(dialog);
  updateControls();
  void requestSessionRefresh();
}

export const cloudSyncInternals = {
  buildCloudPayload,
  aadFor,
  mergeSyncData,
  encryptCloudPayload,
  refreshSession,
};
