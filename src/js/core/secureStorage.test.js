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

describe('secureStorage legacy (localStorage) backend', () => {
  beforeEach(() => {
    localStorage.clear();
    delete global.indexedDB;
    delete global.IDBKeyRange;
  });
  afterEach(() => jest.dontMock('./cryptoVault.js'));

  test('uses the legacy backend and empty state when nothing is stored', () => {
    const storage = loadStorage();
    const state = storage.initializeSecureStorage();
    expect(storage.getStorageMode()).toBe('legacy');
    expect(state).toEqual({
      schemaVersion: 1,
      urls: [],
      sortMode: undefined,
      viewMode: undefined,
      presets: undefined,
      rebuildHistory: [],
      tombstones: [],
    });
    expect(storage.getStorageContext()).toEqual({
      scope: 'guest',
      keyId: 'guest',
    });
  });

  test('reads object-shaped, array-shaped and malformed legacy data', () => {
    localStorage.setItem(
      'urlHistory',
      JSON.stringify({
        urls: [{ id: 'a' }],
        sortMode: 'name',
        viewMode: 'grid',
        tombstones: [{ id: 'gone' }],
      })
    );
    localStorage.setItem('paramPresets', JSON.stringify([{ name: 'p' }]));
    localStorage.setItem('rebuildHistory', JSON.stringify([{ t: 1 }]));
    let state = loadStorage().initializeSecureStorage();
    expect(state).toMatchObject({
      urls: [{ id: 'a' }],
      sortMode: 'name',
      viewMode: 'grid',
      presets: [{ name: 'p' }],
      rebuildHistory: [{ t: 1 }],
      tombstones: [{ id: 'gone' }],
    });

    localStorage.setItem('urlHistory', JSON.stringify([{ id: 'old' }]));
    state = loadStorage().initializeSecureStorage();
    expect(state.urls).toEqual([{ id: 'old' }]);

    localStorage.setItem('urlHistory', '{broken');
    localStorage.setItem('rebuildHistory', '{"not":"array"}');
    state = loadStorage().initializeSecureStorage();
    expect(state.urls).toEqual([]);
    expect(state.rebuildHistory).toEqual([]);

    localStorage.setItem(
      'urlHistory',
      JSON.stringify({ urls: 'nope', tombstones: 'nope' })
    );
    state = loadStorage().initializeSecureStorage();
    expect(state.urls).toEqual([]);
    expect(state.tombstones).toEqual([]);

    localStorage.setItem('urlHistory', 'null');
    expect(loadStorage().initializeSecureStorage().urls).toEqual([]);
  });

  test('falls back to legacy when IndexedDB exists but WebCrypto or IDBKeyRange is missing', () => {
    global.indexedDB = createIndexedDbMock().indexedDB;
    // IDBKeyRange intentionally undefined
    const storage = loadStorage();
    storage.initializeSecureStorage();
    expect(storage.getStorageMode()).toBe('legacy');
  });

  test('saveSecureState writes the legacy keys', async () => {
    const storage = loadStorage();
    storage.initializeSecureStorage();
    await storage.saveSecureState({
      urls: [{ id: 'a' }],
      sortMode: 'date',
      viewMode: 'list',
      tombstones: [{ id: 't' }],
      presets: [{ name: 'x' }],
      rebuildHistory: [1],
    });
    expect(JSON.parse(localStorage.getItem('urlHistory'))).toEqual({
      urls: [{ id: 'a' }],
      sortMode: 'date',
      viewMode: 'list',
      tombstones: [{ id: 't' }],
    });
    expect(JSON.parse(localStorage.getItem('paramPresets'))).toEqual([
      { name: 'x' },
    ]);
    expect(JSON.parse(localStorage.getItem('rebuildHistory'))).toEqual([1]);
  });

  test('saveSecureState omits presets/rebuildHistory when undefined and defaults arrays', async () => {
    const storage = loadStorage();
    storage.initializeSecureStorage();
    await storage.saveSecureState({});
    expect(JSON.parse(localStorage.getItem('urlHistory'))).toEqual({
      urls: [],
      tombstones: [],
    });
    expect(localStorage.getItem('paramPresets')).toBeNull();
    expect(localStorage.getItem('rebuildHistory')).toBeNull();
  });

  test('saveSecureState swallows localStorage quota errors', async () => {
    const storage = loadStorage();
    storage.initializeSecureStorage();
    const spy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota');
      });
    try {
      await expect(
        storage.saveSecureState({ urls: [] })
      ).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  test('tolerates localStorage.getItem throwing', () => {
    const spy = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });
    try {
      const state = loadStorage().initializeSecureStorage();
      expect(state.urls).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  test('account helpers: validate input, switch scope, and return null without IndexedDB', async () => {
    const storage = loadStorage();
    storage.initializeSecureStorage();
    await expect(storage.useAccountEncryptionKey('', 'k')).rejects.toThrow(
      /valid account encryption context/
    );
    await expect(storage.useAccountEncryptionKey('a', null)).rejects.toThrow(
      /valid account encryption context/
    );
    await expect(storage.useAccountEncryptionKey(5, 'k')).rejects.toThrow(
      /valid account encryption context/
    );
    await storage.useAccountEncryptionKey('acct', 'k');
    expect(storage.getStorageContext()).toEqual({
      scope: 'account:acct',
      keyId: 'account:acct',
    });
    await expect(storage.getAccountEncryptionKey('acct')).resolves.toBeNull();
    await expect(storage.loadAccountState('acct', 'k')).resolves.toBeNull();
    await expect(storage.getCurrentEncryptedRecord()).resolves.toBeNull();
    await expect(
      storage.deleteCurrentAccountLocalState('acct')
    ).resolves.toBeUndefined();
    await expect(storage.clearGuestState()).resolves.toBeUndefined();
  });

  test('default export exposes the public API', () => {
    const storage = loadStorage();
    expect(Object.keys(storage.default)).toEqual(
      expect.arrayContaining([
        'initializeSecureStorage',
        'saveSecureState',
        'loadAccountState',
        'clearGuestState',
      ])
    );
  });
});

describe('secureStorage IndexedDB backend', () => {
  let idb;

  beforeEach(() => {
    localStorage.clear();
    idb = createIndexedDbMock();
    global.indexedDB = idb.indexedDB;
    global.IDBKeyRange = {};
  });

  afterEach(() => {
    delete global.indexedDB;
    delete global.IDBKeyRange;
    jest.dontMock('./cryptoVault.js');
  });

  test('creates a guest device key and returns legacy state when no record exists', async () => {
    localStorage.setItem('urlHistory', JSON.stringify({ urls: [{ id: 'l' }] }));
    const storage = loadStorage();
    const state = await storage.initializeSecureStorage();
    expect(storage.getStorageMode()).toBe('indexeddb');
    expect(state.urls).toEqual([{ id: 'l' }]);
    expect(idb.stores.keys.get('guest').key).toBe('device-key');
  });

  test('reuses an existing guest key instead of generating a new one', async () => {
    idb.stores.keys.set('guest', { id: 'guest', key: 'existing-key' });
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    expect(idb.stores.keys.get('guest').key).toBe('existing-key');
  });

  test('save then reinitialise round-trips and removes migrated legacy keys', async () => {
    localStorage.setItem('urlHistory', JSON.stringify({ urls: [{ id: 'l' }] }));
    localStorage.setItem('paramPresets', '[]');
    let storage = loadStorage();
    await storage.initializeSecureStorage();
    await storage.saveSecureState({ schemaVersion: 1, urls: [{ id: 'n' }] });
    expect(localStorage.getItem('urlHistory')).toBeNull();
    expect(localStorage.getItem('paramPresets')).toBeNull();
    const record = idb.stores.records.get('local:guest');
    expect(record).toMatchObject({ scope: 'guest', version: 1 });
    expect(record.aad).toBe('local-state:guest:v1');

    storage = loadStorage();
    const state = await storage.initializeSecureStorage();
    expect(state.urls).toEqual([{ id: 'n' }]);
    expect(storage.isStorageUnreadable()).toBe(false);
    expect(storage.hasUnreadableGuestRecord()).toBe(false);
    await expect(storage.getCurrentEncryptedRecord()).resolves.toMatchObject({
      id: 'local:guest',
    });
  });

  test('keeps legacy keys until a verified encrypted write succeeds', async () => {
    localStorage.setItem('urlHistory', JSON.stringify({ urls: [{ id: 'l' }] }));
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    expect(localStorage.getItem('urlHistory')).not.toBeNull();
  });

  test('reads the pre-scope "local" record as a fallback', async () => {
    idb.stores.records.set('local', {
      id: 'local',
      data: JSON.stringify({ schemaVersion: 1, urls: [{ id: 'old' }] }),
    });
    const state = await loadStorage().initializeSecureStorage();
    expect(state.urls).toEqual([{ id: 'old' }]);
  });

  test('throws when the written record fails verification', async () => {
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    // Corrupt whatever is written so the read-back differs from the state.
    const store = idb.stores.records;
    const realSet = store.set.bind(store);
    store.set = (id, record) =>
      realSet(id, { ...record, data: JSON.stringify({ urls: ['tampered'] }) });
    await expect(
      storage.saveSecureState({ schemaVersion: 1, urls: [{ id: 'x' }] })
    ).rejects.toThrow(/verification failed/);
  });

  test('falls back to legacy when opening the database fails', async () => {
    localStorage.setItem('urlHistory', JSON.stringify({ urls: [{ id: 'l' }] }));
    global.indexedDB = {
      open: () => {
        const req = { error: new Error('blocked') };
        setTimeout(() => req.onerror && req.onerror(), 0);
        return req;
      },
    };
    const storage = loadStorage();
    const state = await storage.initializeSecureStorage();
    expect(storage.getStorageMode()).toBe('legacy');
    expect(state.urls).toEqual([{ id: 'l' }]);
  });

  test('account keys: store with salt and version, then read back', async () => {
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    await expect(storage.getAccountEncryptionKey('acct')).resolves.toBeNull();
    await expect(storage.getAccountEncryptionKey('')).resolves.toBeNull();

    await storage.useAccountEncryptionKey('acct', 'acct-key', {
      salt: 'salt-b64',
      keyVersion: 3,
    });
    expect(storage.getStorageContext()).toEqual({
      scope: 'account:acct',
      keyId: 'account:acct',
    });
    await expect(storage.getAccountEncryptionKey('acct')).resolves.toEqual({
      key: 'acct-key',
      salt: 'salt-b64',
      keyVersion: 3,
    });

    await storage.useAccountEncryptionKey('acct2', 'k2');
    await expect(storage.getAccountEncryptionKey('acct2')).resolves.toEqual({
      key: 'k2',
      salt: null,
      keyVersion: 1,
    });
  });

  test('loadAccountState reads an account record without leaving the active scope', async () => {
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    await storage.useAccountEncryptionKey('acct', 'acct-key');
    await storage.saveSecureState({ schemaVersion: 1, urls: [{ id: 'acct' }] });
    await storage.clearGuestState();
    // Switch back to guest context by re-initialising, then peek at the account.
    const fresh = loadStorage();
    await fresh.initializeSecureStorage();
    await expect(fresh.loadAccountState('acct', 'acct-key')).resolves.toEqual({
      schemaVersion: 1,
      urls: [{ id: 'acct' }],
    });
    expect(fresh.getStorageContext().scope).toBe('guest');
    await expect(fresh.loadAccountState('missing', 'k')).resolves.toBeNull();
    await expect(fresh.loadAccountState('', 'k')).resolves.toBeNull();
    await expect(fresh.loadAccountState('acct', null)).resolves.toBeNull();
  });

  test('loadAccountState returns null when the record scope does not match', async () => {
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    idb.stores.records.set('local:account:acct', {
      id: 'local:account:acct',
      scope: 'account:someone-else',
      data: JSON.stringify({ urls: [] }),
    });
    await expect(storage.loadAccountState('acct', 'k')).resolves.toBeNull();
  });

  test('loadAccountState restores the previous context even when decryption fails', async () => {
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    idb.stores.records.set('local:account:acct', {
      id: 'local:account:acct',
      scope: 'account:acct',
      corrupt: true,
      data: '',
    });
    await expect(storage.loadAccountState('acct', 'k')).rejects.toThrow(
      'bad tag'
    );
    expect(storage.getStorageContext().scope).toBe('guest');
  });

  test('deleteCurrentAccountLocalState removes key and record and returns to guest', async () => {
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    await storage.useAccountEncryptionKey('acct', 'acct-key');
    await storage.saveSecureState({ schemaVersion: 1, urls: [] });
    expect(idb.stores.records.has('local:account:acct')).toBe(true);

    await storage.deleteCurrentAccountLocalState('acct');
    expect(idb.stores.keys.has('account:acct')).toBe(false);
    expect(idb.stores.records.has('local:account:acct')).toBe(false);
    expect(storage.getStorageContext().scope).toBe('guest');

    await expect(
      storage.deleteCurrentAccountLocalState('')
    ).resolves.toBeUndefined();
  });

  test('clearGuestState deletes guest data and legacy keys', async () => {
    localStorage.setItem('urlHistory', JSON.stringify({ urls: [] }));
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    await storage.saveSecureState({ schemaVersion: 1, urls: [{ id: 'g' }] });
    idb.stores.records.set('local', { id: 'local', data: '{}' });
    localStorage.setItem('rebuildHistory', '[]');

    await storage.clearGuestState();
    expect(idb.stores.records.has('local:guest')).toBe(false);
    expect(idb.stores.records.has('local')).toBe(false);
    expect(localStorage.getItem('rebuildHistory')).toBeNull();
    // A new guest key is generated and stays usable.
    expect(idb.stores.keys.get('guest').key).toBe('device-key');
    await storage.saveSecureState({ schemaVersion: 1, urls: [] });
    expect(idb.stores.records.has('local:guest')).toBe(true);
  });

  test('clearGuestState refuses to delete an unreadable guest record', async () => {
    idb.stores.records.set('local:guest', {
      id: 'local:guest',
      scope: 'guest',
      corrupt: true,
      data: 'x',
    });
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    expect(storage.hasUnreadableGuestRecord()).toBe(true);
    await storage.clearGuestState();
    expect(idb.stores.records.get('local:guest').corrupt).toBe(true);
  });

  test('the first unreadable-record backup is never overwritten', async () => {
    idb.stores.records.set('local:guest', {
      id: 'local:guest',
      scope: 'guest',
      corrupt: true,
      data: 'first',
    });
    let storage = loadStorage();
    await storage.initializeSecureStorage();
    await flush();
    idb.stores.records.set('local:guest', {
      id: 'local:guest',
      scope: 'guest',
      corrupt: true,
      data: 'second',
    });
    storage = loadStorage();
    await storage.initializeSecureStorage();
    await flush();
    expect(idb.stores.records.get('unreadable-backup:local:guest').data).toBe(
      'first'
    );
  });
});

describe('secureStorage concurrent saves', () => {
  beforeEach(() => {
    global.indexedDB = createIndexedDbMock().indexedDB;
    global.IDBKeyRange = {};
  });

  afterEach(() => {
    delete global.indexedDB;
    delete global.IDBKeyRange;
    jest.dontMock('./cryptoVault.js');
  });

  test('a burst of saves all succeed and the last state wins', async () => {
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    expect(storage.getStorageMode()).toBe('indexeddb');

    const saves = [1, 2, 3, 4].map((n) =>
      storage.saveSecureState({ schemaVersion: 1, urls: [{ id: `u${n}` }] })
    );
    await expect(Promise.all(saves)).resolves.toBeDefined();

    jest.resetModules();
    const reloaded = loadStorage();
    const state = await reloaded.initializeSecureStorage();
    expect(state.urls).toEqual([{ id: 'u4' }]);
  });

  test('a failed save does not block later saves', async () => {
    const storage = loadStorage();
    await storage.initializeSecureStorage();
    const failing = storage.saveSecureState({
      schemaVersion: 1,
      get urls() {
        throw new Error('boom');
      },
    });
    await expect(failing).rejects.toThrow();
    await expect(
      storage.saveSecureState({ schemaVersion: 1, urls: [] })
    ).resolves.toBeUndefined();
  });
});
