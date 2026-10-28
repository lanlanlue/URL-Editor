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

async function setup({ unreadableGuest, localUrls, remoteUrls }) {
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
  const vault = {
    createRecoveryKey: jest.fn(),
    decodeBytes: jest.fn(() => new Uint8Array(16)),
    decryptJson: jest.fn(async () => ({ urls: remoteUrls || [], presets: [] })),
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
  const mod = await import('./cloudSyncModal.js');
  mod.initCloudSyncModal({ getData, onRestore });
  await flush();
  document.getElementById('cloud-sync-recovery-input').value = 'KEY';
  document.getElementById('cloud-sync-unlock-btn').click();
  await flush();
  return { secure, api, onRestore, getData };
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

  test('uploads again once the user makes a real change', async () => {
    const { api } = await setup({
      unreadableGuest: true,
      localUrls: [PLACEHOLDER],
      remoteUrls: null,
    });
    window.dispatchEvent(new Event('url-editor-data-change'));
    await upload();
    expect(api.putSyncDocument).toHaveBeenCalledTimes(1);
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
