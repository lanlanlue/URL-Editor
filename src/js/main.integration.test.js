import fs from 'fs';
import path from 'path';

/**
 * Integration: real main.js + real secureStorage over an in-memory IndexedDB.
 * Only the crypto codec and the cloud module loader are replaced.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate, message) {
  for (let i = 0; i < 300; i += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`Timed out waiting for: ${message}`);
}

function createIndexedDbMock() {
  const stores = { records: new Map(), keys: new Map() };
  const clone = (value) =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const request = (operation) => {
    const req = {};
    setTimeout(() => {
      try {
        req.result = operation();
        if (req.onsuccess) req.onsuccess();
      } catch (error) {
        req.error = error;
        if (req.onerror) req.onerror();
      }
    }, 0);
    return req;
  };
  const database = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
    transaction: (name) => ({
      objectStore: () => ({
        get: (id) => request(() => clone(stores[name].get(id))),
        put: (record) =>
          request(() => {
            stores[name].set(record.id, clone(record));
            return record.id;
          }),
        delete: (id) => request(() => stores[name].delete(id)),
      }),
    }),
  };
  const indexedDB = {
    open: () => {
      const req = { result: database };
      setTimeout(() => {
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
  return { indexedDB, stores };
}

const NOTICE = '[data-storage-unreadable-notice]';

describe('unreadable guest record, real storage + real main', () => {
  let idb;
  let storage;
  let cloudOptions;

  beforeEach(async () => {
    idb = createIndexedDbMock();
    global.indexedDB = idb.indexedDB;
    global.IDBKeyRange = {};
    idb.stores.records.set('local:guest', {
      id: 'local:guest',
      scope: 'guest',
      corrupt: true,
      data: 'garbled',
    });

    jest.resetModules();
    cloudOptions = null;
    jest.doMock('./core/darkMode.js', () => ({ initDarkMode: jest.fn() }));
    jest.doMock('./core/cryptoVault.js', () => ({
      supportsWebCrypto: () => true,
      generateDeviceKey: async () => 'device-key',
      encodeBytes: (value) => value,
      decodeBytes: (value) => value,
      encryptJson: async (value, _key, aad) => ({
        data: JSON.stringify(value),
        aad,
      }),
      decryptJson: async (envelope) => {
        if (envelope.corrupt) throw new Error('bad tag');
        return JSON.parse(envelope.data);
      },
    }));
    jest.doMock('./core/runtimeConfig.js', () => ({
      ...jest.requireActual('./core/runtimeConfig.js'),
      CLOUD_ENABLED: true,
    }));
    jest.doMock('./core/cloudFeatureLoader.js', () => ({
      loadCloudSyncModule: () =>
        Promise.resolve({
          initCloudSyncModal: (options) => {
            cloudOptions = options;
          },
          openCloudSyncModal: jest.fn(),
        }),
    }));
    document.body.innerHTML = fs.readFileSync(
      path.resolve(__dirname, '../../src/index.html'),
      'utf8'
    );
    window.alert = jest.fn();
    await import('./main.js');
    await waitFor(() => cloudOptions, 'bootstrap');
    await flush();
    storage = require('./core/secureStorage.js');
  });

  afterEach(() => {
    delete global.indexedDB;
    delete global.IDBKeyRange;
    document.body.innerHTML = '';
    localStorage.clear();
    jest.dontMock('./core/cryptoVault.js');
  });

  test('boot shows the banner, keeps the record and writes a backup', () => {
    expect(document.querySelector(NOTICE)).toBeTruthy();
    expect(idb.stores.records.get('local:guest').corrupt).toBe(true);
    expect(
      idb.stores.records.get('unreadable-backup:local:guest')
    ).toBeTruthy();
  });

  test('a scope switch plus restore keeps the banner consistent and the guest record safe', async () => {
    await storage.useAccountEncryptionKey('acct-1', 'account-key');
    cloudOptions.onRestore({
      urls: [{ id: 'r1', url: 'https://remote.example/' }],
    });
    await flush();
    await flush();

    // Banner is a pure function of isStorageUnreadable(): account scope is fine.
    expect(storage.isStorageUnreadable()).toBe(false);
    expect(document.querySelector(NOTICE)).toBeNull();

    const account = idb.stores.records.get('local:account:acct-1');
    expect(JSON.parse(account.data).urls[0].id).toBe('r1');
    expect(idb.stores.records.get('local:guest').corrupt).toBe(true);
    expect(
      idb.stores.records.get('unreadable-backup:local:guest')
    ).toBeTruthy();
  });

  test('clearGuestState does not delete an unrecovered unreadable guest record', async () => {
    await storage.useAccountEncryptionKey('acct-1', 'account-key');
    await storage.clearGuestState();
    expect(idb.stores.records.get('local:guest')).toBeTruthy();
    expect(idb.stores.records.get('local:guest').corrupt).toBe(true);
    expect(
      idb.stores.records.get('unreadable-backup:local:guest')
    ).toBeTruthy();
  });

  test('switching back to the guest scope shows the banner again on the next save', async () => {
    await storage.useAccountEncryptionKey('acct-1', 'account-key');
    cloudOptions.onRestore({ urls: [] });
    expect(document.querySelector(NOTICE)).toBeNull();
    // Back in the guest scope the record is still unreadable.
    await storage.deleteCurrentAccountLocalState('acct-1');
    cloudOptions.onRestore({ urls: [] });
    expect(storage.isStorageUnreadable()).toBe(true);
    expect(document.querySelector(NOTICE)).toBeTruthy();
  });
});
