/**
 * Regression tests for the guest-migration path of the cloud sync unlock flow
 * when the local GUEST record is unreadable (B19). cloudApi, cryptoVault and
 * secureStorage are mocked; the real markup, syncMerge and modal run.
 */
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const PLACEHOLDER = {
  id: 'placeholder-guest',
  url: 'https://placeholder.test',
};
const GUEST = { id: 'guest-1', url: 'https://guest.test', updatedAt: 100 };
const REMOTE = { id: 'remote-1', url: 'https://remote.test', updatedAt: 200 };

async function setup({
  unreadableGuest,
  localUrls,
  remoteUrls,
  realCrypto = false,
}) {
  jest.resetModules();
  document.body.innerHTML = '';
  const secure = {
    clearGuestState: jest.fn().mockResolvedValue(undefined),
    deleteCurrentAccountLocalState: jest.fn(),
    getAccountEncryptionKey: jest.fn().mockResolvedValue(null),
    getStorageMode: jest.fn(() => 'indexeddb'),
    loadAccountState: jest.fn().mockResolvedValue(null),
    useAccountEncryptionKey: jest.fn().mockResolvedValue(undefined),
    hasUnreadableGuestRecord: jest.fn(() => unreadableGuest),
    isStorageUnreadable: jest.fn(() => false),
  };
  const api = {
    CloudApiError: class CloudApiError extends Error {},
    deleteAccount: jest.fn(),
    getSession: jest.fn().mockResolvedValue({
      csrfToken: 'csrf',
      user: { id: 'acct-1', email: 'a@b.test' },
    }),
    getSyncRevision: jest.fn(),
    getSyncDocument: jest.fn().mockResolvedValue(
      remoteUrls
        ? {
            document: {
              revision: 1,
              keyVersion: 1,
              kdfSalt: 'salt',
              iv: 'iv',
              ciphertext: 'ct',
            },
            etag: '"rev-1"',
            revision: 1,
          }
        : { document: null, etag: '"rev-0"', revision: 0 }
    ),
    listSyncRevisions: jest.fn().mockResolvedValue([]),
    logout: jest.fn(),
    putSyncDocument: jest.fn(async (envelope) => ({
      document: envelope,
      etag: '"rev-2"',
      revision: 2,
    })),
  };
  const vault = realCrypto
    ? {
        ...jest.requireActual('../../core/cryptoVault.js'),
        deriveEncryptionKey: jest.fn(
          jest.requireActual('../../core/cryptoVault.js').deriveEncryptionKey
        ),
        decryptJson: jest.fn(
          jest.requireActual('../../core/cryptoVault.js').decryptJson
        ),
        encryptJson: jest.fn(
          jest.requireActual('../../core/cryptoVault.js').encryptJson
        ),
      }
    : {
        createRecoveryKey: jest.fn(),
        decodeBytes: jest.fn(() => new Uint8Array(16)),
        decryptJson: jest.fn(async () => ({
          urls: remoteUrls || [],
          presets: [],
        })),
        deriveEncryptionKey: jest.fn().mockResolvedValue('derived-key'),
        encryptJson: jest.fn(async () => ({ iv: 'iv', ciphertext: 'ct' })),
        encodeBytes: jest.fn(() => 'salt'),
        parseRecoveryKey: jest.fn().mockResolvedValue('secret'),
        randomBytes: jest.fn(() => new Uint8Array(16)),
      };
  jest.doMock('../../core/secureStorage.js', () => secure);
  jest.doMock('../../core/cloudApi.js', () => api);
  jest.doMock('../../core/cryptoVault.js', () => vault);
  jest.doMock('../../core/runtimeConfig.js', () => ({ CLOUD_ENABLED: true }));
  jest.doMock('../../core/i18n.js', () => ({
    __esModule: true,
    default: { t: (key, opts) => opts?.defaultValue ?? key },
  }));
  // Like main.js, getData reflects the in-memory app state, which onRestore
  // replaces (it is the placeholder until something real is restored).
  let currentUrls = localUrls;
  const onRestore = jest.fn((data) => {
    currentUrls = data.urls;
  });
  const getData = jest.fn(() => ({ urls: currentUrls, presets: [] }));
  // Model persisted account keys separately from the modal's memory context.
  const storedKeys = new Map();
  if (realCrypto) {
    secure.useAccountEncryptionKey.mockImplementation(async (id, key, meta) => {
      if (!id || !key)
        throw new Error('A valid account encryption context is required.');
      storedKeys.set(id, { key, ...meta });
    });
    secure.getAccountEncryptionKey.mockImplementation(async (id) =>
      storedKeys.get(id)
    );
  }
  let rotate;
  const addListener = EventTarget.prototype.addEventListener;
  const listenerSpy = jest
    .spyOn(EventTarget.prototype, 'addEventListener')
    .mockImplementation(function (type, listener, ...args) {
      if (this.id === 'cloud-sync-rotate-btn' && type === 'click')
        rotate = listener;
      return addListener.call(this, type, listener, ...args);
    });
  const mod = await import('./cloudSyncModal.js');
  mod.initCloudSyncModal({ getData, onRestore });
  listenerSpy.mockRestore();
  await flush();
  const recovery = realCrypto ? await vault.createRecoveryKey() : null;
  document.getElementById('cloud-sync-recovery-input').value =
    recovery?.display || 'KEY';
  document.getElementById('cloud-sync-unlock-btn').click();
  await flush();
  if (realCrypto) await waitUntilIdle();
  return {
    secure,
    api,
    vault,
    onRestore,
    getData,
    recovery,
    storedKeys,
    rotate,
    mod,
  };
}

async function waitUntilIdle() {
  for (let i = 0; i < 300; i += 1) {
    await flush();
    if (!document.getElementById('cloud-sync-unlock-btn').disabled) return;
  }
  throw new Error('Cloud sync did not finish');
}

const urlIds = (call) => call[0].urls.map((u) => u.id).sort();
const upload = async () => {
  document.getElementById('cloud-sync-upload-btn').click();
  await flush();
};

describe('cloudSyncModal unlock with unreadable guest record', () => {
  test('merges remote only and never migrates the placeholder as guest data', async () => {
    const { secure, api, onRestore } = await setup({
      unreadableGuest: true,
      localUrls: [PLACEHOLDER],
      remoteUrls: [REMOTE],
    });
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(urlIds(onRestore.mock.calls[0])).toEqual(['remote-1']);
    expect(onRestore.mock.calls[0]).toHaveLength(1); // no confirmedRecovery

    await upload();
    expect(api.putSyncDocument).toHaveBeenCalledTimes(1);
    expect(secure.clearGuestState).not.toHaveBeenCalled();
  });

  test('does not restore or upload the placeholder when there is no remote data', async () => {
    const { api, onRestore } = await setup({
      unreadableGuest: true,
      localUrls: [PLACEHOLDER],
      remoteUrls: null,
    });
    expect(onRestore).not.toHaveBeenCalled();
    await upload();
    expect(api.putSyncDocument).not.toHaveBeenCalled();
  });

  const dataChange = (detail) =>
    window.dispatchEvent(new CustomEvent('url-editor-data-change', { detail }));
  const placeholderSetup = () =>
    setup({
      unreadableGuest: true,
      localUrls: [PLACEHOLDER],
      remoteUrls: null,
    });

  test('a non-data save (empty urls/presets) keeps the upload blocked with a status', async () => {
    const { api } = await placeholderSetup();
    dataChange({
      schemaVersion: 1,
      urls: [],
      presets: [],
      tombstones: [{ id: 'url:x', deletedAt: 1 }],
      sortMode: 'name',
      viewMode: 'list',
    });
    await upload();
    expect(api.putSyncDocument).not.toHaveBeenCalled();
    expect(document.getElementById('cloud-sync-status').textContent).not.toBe(
      ''
    );
  });

  test('a bare event without detail keeps the upload blocked', async () => {
    const { api } = await placeholderSetup();
    window.dispatchEvent(new Event('url-editor-data-change'));
    await upload();
    expect(api.putSyncDocument).not.toHaveBeenCalled();
  });

  test('a save containing a real URL unblocks the upload', async () => {
    const { api } = await placeholderSetup();
    dataChange({ schemaVersion: 1, urls: [GUEST], presets: [] });
    await upload();
    expect(api.putSyncDocument).toHaveBeenCalledTimes(1);
  });

  test('a save containing a real preset unblocks the upload', async () => {
    const { api } = await placeholderSetup();
    dataChange({ schemaVersion: 1, urls: [], presets: [{ id: 'p1' }] });
    await upload();
    expect(api.putSyncDocument).toHaveBeenCalledTimes(1);
  });

  test('a failed unlock restores the placeholder guard', async () => {
    const { api, vault, onRestore } = await placeholderSetup();
    // Second unlock finds remote data; restoreData clears the guard, then
    // onRestore throws, so the catch path must put the guard back.
    api.getSyncDocument.mockResolvedValue({
      document: {
        revision: 1,
        keyVersion: 1,
        kdfSalt: 'salt',
        iv: 'iv',
        ciphertext: 'ct',
      },
      etag: '"rev-1"',
      revision: 1,
    });
    vault.decryptJson.mockResolvedValue({ urls: [REMOTE], presets: [] });
    onRestore.mockImplementationOnce(() => {
      throw new Error('restore failed');
    });
    document.getElementById('cloud-sync-recovery-input').value = 'KEY';
    document.getElementById('cloud-sync-unlock-btn').click();
    await flush();
    api.getSyncDocument.mockResolvedValue({
      document: null,
      etag: '"rev-0"',
      revision: 0,
    });
    await upload();
    expect(api.putSyncDocument).not.toHaveBeenCalled();
  });
});

describe('cloudSyncModal unlock with readable guest record (unchanged flow)', () => {
  test('merges guest and remote, migrates, uploads and clears guest state', async () => {
    const { secure, api, onRestore } = await setup({
      unreadableGuest: false,
      localUrls: [GUEST],
      remoteUrls: [REMOTE],
    });
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(urlIds(onRestore.mock.calls[0])).toEqual(['guest-1', 'remote-1']);
    expect(onRestore.mock.calls[0]).toHaveLength(1);

    await upload();
    expect(api.putSyncDocument).toHaveBeenCalledTimes(1);
    expect(secure.clearGuestState).toHaveBeenCalledTimes(1);
  });

  test('with no remote data restores guest data as the account record', async () => {
    const { secure, api, onRestore } = await setup({
      unreadableGuest: false,
      localUrls: [GUEST],
      remoteUrls: null,
    });
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(urlIds(onRestore.mock.calls[0])).toEqual(['guest-1']);
    await upload();
    expect(api.putSyncDocument).toHaveBeenCalledTimes(1);
    expect(secure.clearGuestState).toHaveBeenCalledTimes(1);
  });
});

async function rotateForHistory() {
  const state = await setup({
    unreadableGuest: false,
    localUrls: [GUEST],
    remoteUrls: [REMOTE],
  });
  state.vault.createRecoveryKey.mockResolvedValue({
    secret: 'new-secret',
    display: 'NEW-KEY',
  });
  state.vault.deriveEncryptionKey.mockResolvedValue('new-key');
  document.getElementById('cloud-sync-rotate-btn').click();
  await flush();
  state.api.getSyncRevision.mockResolvedValue({
    revision: 1,
    keyVersion: 1,
    kdfSalt: 'old-salt',
    iv: 'iv',
    ciphertext: 'old',
  });
  document.getElementById('cloud-sync-history-select').innerHTML =
    '<option value="1">1</option>';
  state.onRestore.mockClear();
  state.secure.useAccountEncryptionKey.mockClear();
  return state;
}

const restoreHistory = async () => {
  document.getElementById('cloud-sync-history-restore-btn').click();
  await flush();
};

async function realRotationState() {
  const state = await setup({
    unreadableGuest: false,
    localUrls: [GUEST],
    remoteUrls: null,
    realCrypto: true,
  });
  let remote;
  state.api.putSyncDocument.mockImplementation(async (document) => {
    remote = document;
    return {
      document,
      revision: document.revision,
      etag: `"rev-${document.revision}"`,
    };
  });
  state.api.getSyncDocument.mockImplementation(async () => ({
    document: remote,
    revision: remote?.revision || 0,
    etag: `"rev-${remote?.revision || 0}"`,
  }));
  await upload();
  await waitUntilIdle();
  document.getElementById('cloud-sync-recovery-display').textContent =
    state.recovery.display;
  return { ...state, remote: () => remote };
}

async function decryptedIds(state, envelope, key, accountId = 'acct-1') {
  const aad = JSON.stringify({
    accountId,
    payloadSchemaVersion: 1,
    keyVersion: envelope.keyVersion,
    revision: envelope.revision,
  });
  const data = await state.vault.decryptJson({ ...envelope, aad }, key, aad);
  return data.urls.map((url) => url.id);
}

describe('rotation transaction boundaries (real WebCrypto)', () => {
  test('failed session lookup clears account plaintext before a different account can upload', async () => {
    const state = await realRotationState();
    const originalKey = state.storedKeys.get('acct-1').key;
    state.onRestore.mockClear();
    state.api.getSession.mockRejectedValueOnce(
      new Error('temporary session failure')
    );
    await state.mod.cloudSyncInternals.refreshSession();
    expect(state.getData().urls).toEqual([]);
    expect(state.onRestore).toHaveBeenCalledWith(
      expect.objectContaining({ urls: [] }),
      { accountTransition: true }
    );
    expect(state.storedKeys.get('acct-1').key).toBe(originalKey);

    const salt = new Uint8Array(16).fill(7);
    const otherKey = await state.vault.deriveEncryptionKey(
      new Uint8Array(32).fill(3),
      salt,
      'URL Editor E2EE v1:acct-2'
    );
    state.storedKeys.set('acct-2', { key: otherKey, salt, keyVersion: 1 });
    state.api.getSession.mockResolvedValue({
      user: { id: 'acct-2' },
      csrfToken: 'other-csrf',
    });
    state.api.getSyncDocument.mockResolvedValue({
      document: null,
      revision: 0,
      etag: '"rev-0"',
    });
    await state.mod.cloudSyncInternals.refreshSession();
    state.api.putSyncDocument.mockClear();
    await upload();
    await waitUntilIdle();
    expect(state.api.putSyncDocument).toHaveBeenCalledTimes(1);
    const envelope = state.api.putSyncDocument.mock.calls[0][0];
    expect(await decryptedIds(state, envelope, otherKey, 'acct-2')).toEqual([]);
  });
  test('failed account-memory clearing is retried before loading another account key', async () => {
    const state = await realRotationState();
    state.onRestore.mockImplementationOnce(() => {
      throw new Error('clear UI failed');
    });
    state.api.getSession.mockRejectedValueOnce(
      new Error('temporary session failure')
    );
    await state.mod.cloudSyncInternals.refreshSession();
    state.api.getSession.mockResolvedValue({
      user: { id: 'acct-2' },
      csrfToken: 'other-csrf',
    });
    state.api.getSyncDocument.mockResolvedValue({
      document: null,
      revision: 0,
      etag: '"rev-0"',
    });
    await state.mod.cloudSyncInternals.refreshSession();
    expect(state.getData().urls).toEqual([]);
    expect(state.storedKeys.has('acct-2')).toBe(false);
    const calls = state.api.putSyncDocument.mock.calls.length;
    await upload();
    await waitUntilIdle();
    expect(state.api.putSyncDocument).toHaveBeenCalledTimes(calls);
  });
  test('persistent account-memory clearing failure blocks manual recovery-key unlock and upload', async () => {
    const state = await realRotationState();
    state.onRestore.mockImplementation(() => {
      throw new Error('clear UI failed');
    });
    state.api.getSession.mockRejectedValueOnce(
      new Error('temporary session failure')
    );
    await state.mod.cloudSyncInternals.refreshSession();
    state.api.getSession.mockResolvedValue({
      user: { id: 'acct-2' },
      csrfToken: 'other-csrf',
    });
    state.api.getSyncDocument.mockResolvedValue({
      document: null,
      revision: 0,
      etag: '"rev-0"',
    });
    await state.mod.cloudSyncInternals.refreshSession();
    state.secure.useAccountEncryptionKey.mockClear();
    state.api.putSyncDocument.mockClear();
    document.getElementById('cloud-sync-recovery-input').value =
      state.recovery.display;
    document.getElementById('cloud-sync-unlock-btn').click();
    await waitUntilIdle();
    await upload();
    await waitUntilIdle();
    expect(state.secure.useAccountEncryptionKey).not.toHaveBeenCalled();
    expect(state.storedKeys.has('acct-2')).toBe(false);
    expect(state.api.putSyncDocument).not.toHaveBeenCalled();
    expect(document.getElementById('cloud-sync-unlocked-section').hidden).toBe(
      true
    );
  });
  test('same-account close/reopen during encryption keeps recovery metadata coherent and eventually refreshes', async () => {
    const state = await realRotationState();
    const encrypt = state.vault.encryptJson.getMockImplementation();
    let release;
    let entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    state.vault.encryptJson.mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return encrypt(...args);
    });
    const rotating = state.rotate();
    await started;
    const reads = state.api.getSession.mock.calls.length;
    document.getElementById('cloud-sync-close-btn').click();
    state.mod.openCloudSyncModal();
    state.mod.openCloudSyncModal();
    await flush();
    release();
    await rotating;
    await waitUntilIdle();
    const envelope = state.remote();
    const stored = state.storedKeys.get('acct-1');
    const display = document.getElementById(
      'cloud-sync-recovery-display'
    ).textContent;
    expect(envelope.keyVersion).toBe(2);
    expect(envelope.kdfSalt).toBe(state.vault.encodeBytes(stored.salt));
    const key = await state.vault.deriveEncryptionKey(
      await state.vault.parseRecoveryKey(display),
      envelope.kdfSalt,
      'URL Editor E2EE v1:acct-1'
    );
    expect(await decryptedIds(state, envelope, key)).toContain(GUEST.id);
    expect(await decryptedIds(state, envelope, stored.key)).toContain(GUEST.id);
    expect(state.api.getSession.mock.calls.length).toBeGreaterThan(reads);
    await upload();
    await waitUntilIdle();
    expect(state.remote().keyVersion).toBe(2);
    expect(await decryptedIds(state, state.remote(), key)).toContain(GUEST.id);
  });
  test('encryption snapshots salt before await even if the original context buffer mutates', async () => {
    const state = await realRotationState();
    const stored = state.storedKeys.get('acct-1');
    const salt = state.vault.encodeBytes(stored.salt);
    const encrypt = state.vault.encryptJson.getMockImplementation();
    state.vault.encryptJson.mockImplementationOnce(async (...args) => {
      stored.salt.fill(19);
      return encrypt(...args);
    });
    await upload();
    await waitUntilIdle();
    expect(state.remote().kdfSalt).toBe(salt);
    expect(await decryptedIds(state, state.remote(), stored.key)).toContain(
      GUEST.id
    );
  });
  test('unlock derivation cannot persist or restore its key after a cross-account refresh', async () => {
    const state = await realRotationState();
    const derive = state.vault.deriveEncryptionKey.getMockImplementation();
    state.secure.useAccountEncryptionKey.mockClear();
    state.vault.deriveEncryptionKey.mockImplementationOnce(async (...args) => {
      state.api.getSession.mockResolvedValue({
        user: { id: 'acct-2' },
        csrfToken: 'other-csrf',
      });
      await state.mod.cloudSyncInternals.refreshSession();
      return derive(...args);
    });
    document.getElementById('cloud-sync-recovery-input').value =
      state.recovery.display;
    document.getElementById('cloud-sync-unlock-btn').click();
    await waitUntilIdle();
    expect(state.secure.useAccountEncryptionKey).not.toHaveBeenCalled();
    expect(state.storedKeys.has('acct-2')).toBe(false);
    expect(state.getData().urls).toEqual([]);
    expect(document.getElementById('cloud-sync-unlocked-section').hidden).toBe(
      true
    );
  });
  test('history decryption cannot restore previous-account plaintext after refresh', async () => {
    const state = await realRotationState();
    state.api.getSyncRevision.mockResolvedValue(state.remote());
    document.getElementById('cloud-sync-history-select').innerHTML =
      '<option value="1">1</option>';
    const decrypt = state.vault.decryptJson.getMockImplementation();
    state.vault.decryptJson.mockImplementationOnce(async (...args) => {
      state.api.getSession.mockResolvedValue({
        user: { id: 'acct-2' },
        csrfToken: 'other-csrf',
      });
      await state.mod.cloudSyncInternals.refreshSession();
      return decrypt(...args);
    });
    await restoreHistory();
    await waitUntilIdle();
    expect(state.getData().urls).toEqual([]);
    expect(state.storedKeys.has('acct-2')).toBe(false);
  });
  test('401 refresh to another account never retries the original account data', async () => {
    const state = await realRotationState();
    const otherKey = await state.vault.deriveEncryptionKey(
      new Uint8Array(32),
      new Uint8Array(16),
      'URL Editor E2EE v1:acct-2'
    );
    state.storedKeys.set('acct-2', {
      key: otherKey,
      salt: new Uint8Array(16),
      keyVersion: 7,
    });
    state.api.getSession.mockResolvedValue({
      user: { id: 'acct-2' },
      csrfToken: 'other-csrf',
    });
    state.api.getSyncDocument.mockResolvedValue({
      document: null,
      revision: 0,
      etag: '"rev-0"',
    });
    const error = new state.api.CloudApiError('expired');
    error.status = 401;
    state.api.putSyncDocument.mockRejectedValueOnce(error);
    const calls = state.api.putSyncDocument.mock.calls.length;
    await upload();
    await waitUntilIdle();
    expect(state.api.putSyncDocument).toHaveBeenCalledTimes(calls + 1);
    expect(state.getData().urls).toEqual([]);
    expect(state.storedKeys.get('acct-2').key).toBe(otherKey);
  });
  test('direct encryption keeps the initiating account/context metadata across a global context replacement', async () => {
    const state = await realRotationState();
    const original = state.storedKeys.get('acct-1');
    const salt = state.vault.encodeBytes(original.salt);
    const encrypt = state.vault.encryptJson.getMockImplementation();
    state.vault.encryptJson.mockImplementationOnce(async (...args) => {
      state.api.getSession.mockResolvedValue({
        user: { id: 'acct-2' },
        csrfToken: 'other-csrf',
      });
      await state.mod.cloudSyncInternals.refreshSession();
      return encrypt(...args);
    });
    const envelope = await state.mod.cloudSyncInternals.encryptCloudPayload(
      { urls: [GUEST] },
      19
    );
    expect(envelope).toMatchObject({
      revision: 19,
      keyVersion: 1,
      kdfSalt: salt,
    });
    expect(await decryptedIds(state, envelope, original.key)).toContain(
      GUEST.id
    );
    expect(state.storedKeys.has('acct-2')).toBe(false);
  });
  test('cross-account refresh while encrypting aborts before PUT rather than mixing request identity', async () => {
    const state = await realRotationState();
    const encrypt = state.vault.encryptJson.getMockImplementation();
    state.vault.encryptJson.mockImplementationOnce(async (...args) => {
      state.api.getSession.mockResolvedValue({
        user: { id: 'acct-2' },
        csrfToken: 'other-csrf',
      });
      await state.mod.cloudSyncInternals.refreshSession();
      return encrypt(...args);
    });
    const calls = state.api.putSyncDocument.mock.calls.length;
    await upload();
    await waitUntilIdle();
    expect(state.api.putSyncDocument).toHaveBeenCalledTimes(calls);
    expect(state.getData().urls).toEqual([]);
    expect(state.storedKeys.has('acct-2')).toBe(false);
  });
  test('switching to an account without a stored key cannot reuse the staged rotation context', async () => {
    const state = await realRotationState();
    const original = state.storedKeys.get('acct-1');
    state.api.putSyncDocument.mockImplementationOnce(async () => {
      state.api.getSession.mockResolvedValue({
        csrfToken: 'other-csrf',
        user: { id: 'acct-2' },
      });
      state.api.getSyncDocument.mockResolvedValue({
        document: null,
        revision: 0,
        etag: '"rev-0"',
      });
      await state.mod.cloudSyncInternals.refreshSession();
      await flush();
      const rejection = new state.api.CloudApiError(
        'rejected original account PUT'
      );
      rejection.status = 409;
      throw rejection;
    });
    await state.rotate();
    const calls = state.api.putSyncDocument.mock.calls.length;
    await upload();
    await waitUntilIdle();
    expect(state.api.putSyncDocument).toHaveBeenCalledTimes(calls);
    expect(state.storedKeys.get('acct-1')).toBe(original);
    expect(state.storedKeys.has('acct-2')).toBe(false);
    expect(state.remote().keyVersion).toBe(1);
    expect(document.getElementById('cloud-sync-unlocked-section').hidden).toBe(
      true
    );
  });
  test('reopening after an uncertain rotation leaves manual recovery usable without blind old-key writes', async () => {
    const state = await realRotationState();
    const commit = state.api.putSyncDocument.getMockImplementation();
    state.api.putSyncDocument.mockImplementationOnce(async (...args) => {
      await commit(...args);
      throw new TypeError('response lost');
    });
    await state.rotate();
    const display = document.getElementById(
      'cloud-sync-recovery-display'
    ).textContent;
    state.mod.openCloudSyncModal();
    await waitUntilIdle();
    expect(document.getElementById('cloud-sync-account-section').hidden).toBe(
      false
    );
    expect(document.getElementById('cloud-sync-unlocked-section').hidden).toBe(
      true
    );
    const calls = state.api.putSyncDocument.mock.calls.length;
    await upload();
    await waitUntilIdle();
    expect(state.api.putSyncDocument).toHaveBeenCalledTimes(calls);
    document.getElementById('cloud-sync-recovery-input').value = display;
    document.getElementById('cloud-sync-unlock-btn').click();
    await waitUntilIdle();
    await upload();
    await waitUntilIdle();
    expect(state.remote().keyVersion).toBe(2);
    expect(
      await decryptedIds(
        state,
        state.remote(),
        state.storedKeys.get('acct-1').key
      )
    ).toContain(GUEST.id);
  });
  test('a lost PUT response preserves new recovery material and blocks blind old-key uploads', async () => {
    const state = await realRotationState();
    const old = state.storedKeys.get('acct-1');
    const commit = state.api.putSyncDocument.getMockImplementation();
    state.api.putSyncDocument.mockImplementationOnce(async (...args) => {
      await commit(...args);
      throw new TypeError('response lost');
    });
    await state.rotate();
    expect(state.remote().keyVersion).toBe(2);
    expect(state.storedKeys.get('acct-1')).toBe(old);
    const display = document.getElementById(
      'cloud-sync-recovery-display'
    ).textContent;
    expect(display).not.toBe(state.recovery.display);
    expect(document.getElementById('cloud-sync-recovery-section').hidden).toBe(
      false
    );
    const key = await state.vault.deriveEncryptionKey(
      await state.vault.parseRecoveryKey(display),
      state.remote().kdfSalt,
      'URL Editor E2EE v1:acct-1'
    );
    expect(await decryptedIds(state, state.remote(), key)).toContain(GUEST.id);
    expect(document.getElementById('cloud-sync-status').textContent).toContain(
      '無法確認'
    );
    const calls = state.api.putSyncDocument.mock.calls.length;
    await upload();
    await waitUntilIdle();
    expect(state.api.putSyncDocument).toHaveBeenCalledTimes(calls);
  });
  test('storage failure after confirmed PUT retains new recovery key and reports non-atomic local state', async () => {
    const state = await realRotationState();
    const old = state.storedKeys.get('acct-1');
    state.secure.useAccountEncryptionKey.mockRejectedValueOnce(
      new Error('key persistence failed')
    );
    await state.rotate();
    expect(state.remote().keyVersion).toBe(2);
    expect(state.storedKeys.get('acct-1')).toBe(old);
    const display = document.getElementById(
      'cloud-sync-recovery-display'
    ).textContent;
    expect(display).not.toBe(state.recovery.display);
    expect(document.getElementById('cloud-sync-recovery-section').hidden).toBe(
      false
    );
    const key = await state.vault.deriveEncryptionKey(
      await state.vault.parseRecoveryKey(display),
      state.remote().kdfSalt,
      'URL Editor E2EE v1:acct-1'
    );
    expect(await decryptedIds(state, state.remote(), key)).toContain(GUEST.id);
    expect(document.getElementById('cloud-sync-status').textContent).toContain(
      'key persistence failed'
    );
    await upload();
    await waitUntilIdle();
    expect(await decryptedIds(state, state.remote(), key)).toContain(GUEST.id);
    expect(state.remote().keyVersion).toBe(2);
  });
  test('a post-PUT status rendering exception does not lose the committed key', async () => {
    const state = await realRotationState();
    const i18n = require('../../core/i18n.js').default;
    const translate = i18n.t;
    i18n.t = (name, options) => {
      if (name === 'cloudSync.syncSuccess') {
        i18n.t = translate;
        throw new Error('status rendering failed');
      }
      return translate(name, options);
    };
    await state.rotate();
    expect(state.remote().keyVersion).toBe(2);
    expect(state.storedKeys.get('acct-1').keyVersion).toBe(2);
    expect(
      document.getElementById('cloud-sync-recovery-display').textContent
    ).not.toBe(state.recovery.display);
    expect(document.getElementById('cloud-sync-status').textContent).toContain(
      'status rendering failed'
    );
    expect(
      await decryptedIds(
        state,
        state.remote(),
        state.storedKeys.get('acct-1').key
      )
    ).toContain(GUEST.id);
  });
  test.each([false, true])(
    'switching account during PUT (committed=%s) never rewrites the other account context',
    async (commitPut) => {
      const state = await realRotationState();
      const original = state.storedKeys.get('acct-1');
      const otherKey = await state.vault.deriveEncryptionKey(
        new Uint8Array(32),
        new Uint8Array(16),
        'URL Editor E2EE v1:acct-2'
      );
      const other = { key: otherKey, salt: new Uint8Array(16), keyVersion: 7 };
      state.storedKeys.set('acct-2', other);
      const commit = state.api.putSyncDocument.getMockImplementation();
      state.api.putSyncDocument.mockImplementationOnce(async (...args) => {
        const result = commitPut ? await commit(...args) : null;
        state.api.getSession.mockResolvedValue({
          csrfToken: 'other-csrf',
          user: { id: 'acct-2' },
        });
        state.api.getSyncDocument.mockResolvedValue({
          document: null,
          revision: 0,
          etag: '"rev-0"',
        });
        await state.mod.cloudSyncInternals.refreshSession();
        await flush();
        if (!commitPut) {
          const rejection = new state.api.CloudApiError(
            'rejected original account PUT'
          );
          rejection.status = 409;
          throw rejection;
        }
        return result;
      });
      await state.rotate();
      expect(state.storedKeys.get('acct-1')).toBe(original);
      expect(state.storedKeys.get('acct-2').key).toBe(otherKey);
      expect(state.remote().keyVersion).toBe(commitPut ? 2 : 1);
      const display = document.getElementById(
        'cloud-sync-recovery-display'
      ).textContent;
      const recoveryKey = await state.vault.deriveEncryptionKey(
        await state.vault.parseRecoveryKey(display),
        state.remote().kdfSalt,
        'URL Editor E2EE v1:acct-1'
      );
      expect(await decryptedIds(state, state.remote(), recoveryKey)).toContain(
        GUEST.id
      );
      expect(
        document.getElementById('cloud-sync-recovery-section').hidden
      ).toBe(!commitPut);
      await upload();
      await waitUntilIdle();
      expect(state.remote().keyVersion).toBe(7);
      expect(
        await decryptedIds(state, state.remote(), otherKey, 'acct-2')
      ).toEqual([]);
    }
  );
  test('a restore failure after confirmed PUT keeps remote/memory/stored/display new', async () => {
    const state = await realRotationState();
    const oldKey = state.storedKeys.get('acct-1').key;
    const commit = state.api.putSyncDocument.getMockImplementation();
    state.api.putSyncDocument.mockImplementationOnce(async (...args) => {
      const result = await commit(...args);
      state.onRestore.mockImplementationOnce(() => {
        throw new Error('local restore failed');
      });
      return result;
    });
    await state.rotate();
    const remote = state.remote();
    const display = document.getElementById(
      'cloud-sync-recovery-display'
    ).textContent;
    const recoveryKey = await state.vault.deriveEncryptionKey(
      await state.vault.parseRecoveryKey(display),
      state.vault.decodeBytes(remote.kdfSalt),
      'URL Editor E2EE v1:acct-1'
    );
    expect(remote.keyVersion).toBe(2);
    expect(state.storedKeys.get('acct-1').key).not.toBe(oldKey);
    expect(display).not.toBe(state.recovery.display);
    expect(document.getElementById('cloud-sync-recovery-section').hidden).toBe(
      false
    );
    expect(await decryptedIds(state, remote, recoveryKey)).toContain(GUEST.id);
    expect(
      await decryptedIds(state, remote, state.storedKeys.get('acct-1').key)
    ).toContain(GUEST.id);
    await expect(decryptedIds(state, remote, oldKey)).rejects.toThrow();
    expect(document.getElementById('cloud-sync-status').textContent).toMatch(
      /雲端.*本機.*local restore failed/
    );
    expect(document.getElementById('cloud-sync-rotate-btn').disabled).toBe(
      false
    );
    await upload();
    await waitUntilIdle();
    expect(state.remote().keyVersion).toBe(2);
    expect(await decryptedIds(state, state.remote(), recoveryKey)).toContain(
      GUEST.id
    );
  });
  test.each([401, 403])(
    'expired session after PUT %s leaves remote/stored/display old and can resume old memory context',
    async (status) => {
      const state = await realRotationState();
      const old = state.storedKeys.get('acct-1');
      const oldRemote = state.remote();
      const error = new state.api.CloudApiError('session expired');
      error.status = status;
      state.api.getSession.mockResolvedValue(null);
      state.api.putSyncDocument.mockRejectedValueOnce(error);
      await expect(state.rotate()).resolves.toBeUndefined();
      expect(state.remote()).toBe(oldRemote);
      expect(state.storedKeys.get('acct-1').key).toBe(old.key);
      expect(
        document.getElementById('cloud-sync-recovery-display').textContent
      ).toBe(state.recovery.display);
      expect(
        document.getElementById('cloud-sync-status').textContent
      ).toContain('session expired');
      expect(document.getElementById('cloud-sync-rotate-btn').disabled).toBe(
        false
      );
      expect(await decryptedIds(state, state.remote(), old.key)).toContain(
        GUEST.id
      );
      state.api.getSession.mockResolvedValue({
        csrfToken: 'csrf',
        user: { id: 'acct-1' },
      });
      state.mod.openCloudSyncModal();
      await waitUntilIdle();
      await upload();
      await waitUntilIdle();
      expect(state.remote().keyVersion).toBe(1);
      expect(await decryptedIds(state, state.remote(), old.key)).toContain(
        GUEST.id
      );
    }
  );
});

describe('history across recovery key rotation', () => {
  test('real HKDF/AES-GCM rotation restores old ciphertext and keeps new context', async () => {
    const state = await setup({
      unreadableGuest: false,
      localUrls: [GUEST],
      remoteUrls: null,
      realCrypto: true,
    });
    await upload();
    await waitUntilIdle();
    const oldEnvelope = state.api.putSyncDocument.mock.calls[0][0];
    expect(oldEnvelope.kdfSalt).toMatch(/^[A-Za-z0-9_-]+$/);
    state.api.getSyncDocument.mockResolvedValue({
      document: oldEnvelope,
      revision: 1,
      etag: '"rev-1"',
    });
    document.getElementById('cloud-sync-rotate-btn').click();
    await waitUntilIdle();
    const newEnvelope = state.api.putSyncDocument.mock.calls[1][0];
    expect(newEnvelope.keyVersion).toBe(2);
    expect(newEnvelope.kdfSalt).not.toBe(oldEnvelope.kdfSalt);
    const currentKey =
      state.secure.useAccountEncryptionKey.mock.calls.at(-1)[1];
    state.secure.useAccountEncryptionKey.mockClear();
    state.api.getSyncRevision.mockResolvedValue(oldEnvelope);
    document.getElementById('cloud-sync-history-select').innerHTML =
      '<option value="1">1</option>';
    state.onRestore({ urls: [], presets: [] });
    state.onRestore.mockClear();
    const wrongRecovery = await state.vault.createRecoveryKey();
    jest
      .spyOn(window, 'prompt')
      .mockReturnValueOnce(wrongRecovery.display)
      .mockReturnValueOnce(state.recovery.display);
    await restoreHistory();
    await waitUntilIdle();
    expect(state.onRestore).not.toHaveBeenCalled();
    expect(document.getElementById('cloud-sync-status').textContent).toContain(
      'Recovery Key'
    );
    await restoreHistory();
    await waitUntilIdle();
    expect(state.getData().urls.map((entry) => entry.id)).toContain(GUEST.id);
    expect(state.secure.useAccountEncryptionKey).not.toHaveBeenCalled();
    await upload();
    await waitUntilIdle();
    const uploaded = state.api.putSyncDocument.mock.calls.at(-1)[0];
    expect(uploaded.keyVersion).toBe(2);
    expect(uploaded.kdfSalt).toBe(newEnvelope.kdfSalt);
    const aad = JSON.stringify({
      accountId: 'acct-1',
      payloadSchemaVersion: 1,
      keyVersion: uploaded.keyVersion,
      revision: uploaded.revision,
    });
    expect(
      (
        await state.vault.decryptJson({ ...uploaded, aad }, currentKey, aad)
      ).urls.map((entry) => entry.id)
    ).toContain(GUEST.id);
  });
  afterEach(() => jest.restoreAllMocks());
  test('derives historical key using envelope salt, without replacing active key', async () => {
    const state = await rotateForHistory();
    const prompt = jest.spyOn(window, 'prompt').mockReturnValue('OLD-KEY');
    state.vault.deriveEncryptionKey.mockResolvedValue('old-key');
    await restoreHistory();
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('1'));
    expect(state.vault.decodeBytes).toHaveBeenLastCalledWith('old-salt');
    expect(state.vault.decryptJson).toHaveBeenLastCalledWith(
      expect.anything(),
      'old-key',
      expect.anything()
    );
    expect(state.onRestore).toHaveBeenCalledTimes(1);
    expect(state.secure.useAccountEncryptionKey).not.toHaveBeenCalled();
    await upload();
    expect(state.vault.encryptJson).toHaveBeenLastCalledWith(
      expect.anything(),
      'new-key',
      expect.anything()
    );
  });
  test('cancel leaves data and current encryption context unchanged', async () => {
    const state = await rotateForHistory();
    jest.spyOn(window, 'prompt').mockReturnValue(null);
    await restoreHistory();
    expect(state.onRestore).not.toHaveBeenCalled();
    expect(state.secure.useAccountEncryptionKey).not.toHaveBeenCalled();
  });
  test('wrong historical key gives a clear error and never restores', async () => {
    const state = await rotateForHistory();
    jest.spyOn(window, 'prompt').mockReturnValue('WRONG');
    state.vault.decryptJson.mockRejectedValue(new Error('OperationError'));
    await restoreHistory();
    expect(state.onRestore).not.toHaveBeenCalled();
    expect(document.getElementById('cloud-sync-status').textContent).toContain(
      'Recovery Key'
    );
    expect(state.secure.useAccountEncryptionKey).not.toHaveBeenCalled();
  });
  test('same key version restores without prompting', async () => {
    const state = await setup({
      unreadableGuest: false,
      localUrls: [GUEST],
      remoteUrls: [REMOTE],
    });
    const prompt = jest.spyOn(window, 'prompt');
    state.api.getSyncRevision.mockResolvedValue({
      revision: 1,
      keyVersion: 1,
      kdfSalt: 'salt',
    });
    document.getElementById('cloud-sync-history-select').innerHTML =
      '<option value="1">1</option>';
    await restoreHistory();
    expect(prompt).not.toHaveBeenCalled();
    expect(state.vault.decryptJson).toHaveBeenLastCalledWith(
      expect.anything(),
      'derived-key',
      expect.anything()
    );
  });
});
