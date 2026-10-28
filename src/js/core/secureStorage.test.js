/**
 * Tests the unreadable-record handling of secureStorage against a minimal
 * in-memory IndexedDB. cryptoVault is replaced by a transparent codec whose
 * envelopes can be marked `corrupt` to make decryption fail.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

function loadStorage() {
  jest.resetModules();
  jest.doMock('./cryptoVault.js', () => ({
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
  return require('./secureStorage.js');
}

describe('secureStorage unreadable record', () => {
  let idb;

  beforeEach(() => {
    idb = createIndexedDbMock();
    global.indexedDB = idb.indexedDB;
    global.IDBKeyRange = {};
    idb.stores.records.set('local:guest', {
      id: 'local:guest',
      scope: 'guest',
      corrupt: true,
      data: 'garbled',
    });
  });

  afterEach(() => {
    delete global.indexedDB;
    delete global.IDBKeyRange;
    jest.dontMock('./cryptoVault.js');
  });

  test('flags the guest scope unreadable and refuses to overwrite the record', async () => {
    const storage = loadStorage();
    const state = await storage.initializeSecureStorage();
    expect(state.unreadable).toBe(true);
    expect(storage.isStorageUnreadable()).toBe(true);

    await storage.saveSecureState({ schemaVersion: 1, urls: [{ id: 'x' }] });
    expect(idb.stores.records.get('local:guest').corrupt).toBe(true);
  });

  test('keeps a separate copy of the unreadable record', async () => {
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    await flush();
    const backup = idb.stores.records.get('unreadable-backup:local:guest');
    expect(backup).toMatchObject({ corrupt: true, data: 'garbled' });
  });

  test('recovery clears the flag and allows persisting', async () => {
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    storage.markStorageRecovered();
    expect(storage.isStorageUnreadable()).toBe(false);

    await storage.saveSecureState({ schemaVersion: 1, urls: [{ id: 'x' }] });
    const saved = idb.stores.records.get('local:guest');
    expect(saved.corrupt).toBeUndefined();
    expect(JSON.parse(saved.data).urls[0].id).toBe('x');
    // The pre-recovery copy is still there.
    expect(
      idb.stores.records.get('unreadable-backup:local:guest').corrupt
    ).toBe(true);
  });

  test('an unreadable guest record does not block saves in an account scope', async () => {
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    await storage.useAccountEncryptionKey('acct-1', 'account-key');
    expect(storage.isStorageUnreadable()).toBe(false);

    await storage.saveSecureState({ schemaVersion: 1, urls: [{ id: 'acct' }] });
    const accountRecord = idb.stores.records.get('local:account:acct-1');
    expect(JSON.parse(accountRecord.data).urls[0].id).toBe('acct');
    // Guest record untouched.
    expect(idb.stores.records.get('local:guest').corrupt).toBe(true);
  });
});
