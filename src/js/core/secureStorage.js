import {
  decodeBytes,
  encryptJson,
  decryptJson,
  encodeBytes,
  generateDeviceKey,
  supportsWebCrypto,
} from './cryptoVault.js';

const DB_NAME = 'url-editor-secure-v1';
const DB_VERSION = 1;
const RECORDS_STORE = 'records';
const KEYS_STORE = 'keys';
const LEGACY_KEYS = ['urlHistory', 'paramPresets', 'rebuildHistory'];

let database = null;
let backend = 'legacy';
let legacyPending = false;
let context = { scope: 'guest', keyId: 'guest', key: null };

function recordId(scope = context.scope) {
  return `local:${scope}`;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function readLocalStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeLocalStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Private browsing and disabled storage must not stop the application.
  }
}

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readLegacyState() {
  const history = parseJson(readLocalStorage('urlHistory'), { urls: [] });
  const data = Array.isArray(history) ? { urls: history } : history || {};
  const presets = parseJson(readLocalStorage('paramPresets'), undefined);
  const rebuildHistory = parseJson(readLocalStorage('rebuildHistory'), []);
  const hasLegacyData = LEGACY_KEYS.some((key) =>
    Boolean(readLocalStorage(key))
  );
  legacyPending = hasLegacyData;
  return {
    schemaVersion: 1,
    urls: Array.isArray(data.urls) ? data.urls : [],
    sortMode: data.sortMode,
    viewMode: data.viewMode,
    presets,
    rebuildHistory: Array.isArray(rebuildHistory) ? rebuildHistory : [],
    tombstones: Array.isArray(data.tombstones) ? data.tombstones : [],
  };
}

function canUseIndexedDb() {
  return Boolean(
    typeof indexedDB !== 'undefined' &&
      supportsWebCrypto() &&
      typeof IDBKeyRange !== 'undefined'
  );
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const nextDatabase = request.result;
      if (!nextDatabase.objectStoreNames.contains(RECORDS_STORE)) {
        nextDatabase.createObjectStore(RECORDS_STORE, { keyPath: 'id' });
      }
      if (!nextDatabase.objectStoreNames.contains(KEYS_STORE)) {
        nextDatabase.createObjectStore(KEYS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('IndexedDB unavailable.'));
  });
}

function idbRequest(storeName, mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let request;
    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('IndexedDB request failed.'));
  });
}

async function readRecord(id) {
  return idbRequest(RECORDS_STORE, 'readonly', (store) => store.get(id));
}

async function writeRecord(record) {
  return idbRequest(RECORDS_STORE, 'readwrite', (store) => store.put(record));
}

async function deleteRecord(id) {
  return idbRequest(RECORDS_STORE, 'readwrite', (store) => store.delete(id));
}

async function readKey(id) {
  return idbRequest(KEYS_STORE, 'readonly', (store) => store.get(id));
}

async function writeKey(record) {
  return idbRequest(KEYS_STORE, 'readwrite', (store) => store.put(record));
}

async function deleteKey(id) {
  return idbRequest(KEYS_STORE, 'readwrite', (store) => store.delete(id));
}

async function encryptLocalState(state) {
  const aad = `local-state:${context.scope}:v1`;
  return encryptJson(state, context.key, aad);
}

async function decryptLocalState(record) {
  return decryptJson(record, context.key, `local-state:${context.scope}:v1`);
}

async function createGuestContext() {
  let keyRecord = await readKey('guest');
  if (!keyRecord?.key) {
    keyRecord = {
      id: 'guest',
      key: await generateDeviceKey(),
      createdAt: Date.now(),
    };
    await writeKey(keyRecord);
  }
  context = { scope: 'guest', keyId: 'guest', key: keyRecord.key };
}

export function getStorageMode() {
  return backend;
}

export function getStorageContext() {
  return { scope: context.scope, keyId: context.keyId };
}

export function initializeSecureStorage() {
  const legacyState = readLegacyState();
  if (!canUseIndexedDb()) {
    backend = 'legacy';
    return legacyState;
  }

  return (async () => {
    try {
      database = await openDatabase();
      backend = 'indexeddb';
      await createGuestContext();
      const record =
        (await readRecord(recordId('guest'))) || (await readRecord('local'));
      if (!record) return legacyState;
      try {
        // Keep the migration marker until the next verified encrypted write
        // removes every legacy plaintext key.
        return await decryptLocalState(record);
      } catch {
        // Do not overwrite an unreadable encrypted record with legacy data.
        return {
          schemaVersion: 1,
          urls: [],
          presets: undefined,
          rebuildHistory: [],
          tombstones: [],
        };
      }
    } catch {
      database = null;
      backend = 'legacy';
      return legacyState;
    }
  })();
}

export async function saveSecureState(state) {
  const safeState = clone(state);
  if (backend !== 'indexeddb' || !database || !context.key) {
    try {
      localStorage.setItem(
        'urlHistory',
        JSON.stringify({
          urls: safeState.urls || [],
          sortMode: safeState.sortMode,
          viewMode: safeState.viewMode,
          tombstones: safeState.tombstones || [],
        })
      );
      if (safeState.presets !== undefined) {
        localStorage.setItem('paramPresets', JSON.stringify(safeState.presets));
      }
      if (safeState.rebuildHistory !== undefined) {
        localStorage.setItem(
          'rebuildHistory',
          JSON.stringify(safeState.rebuildHistory)
        );
      }
    } catch {
      // Storage quota failures leave the in-memory application state usable.
    }
    return;
  }

  const encrypted = await encryptLocalState(safeState);
  const record = {
    id: recordId(),
    version: 1,
    scope: context.scope,
    ...encrypted,
    updatedAt: Date.now(),
  };
  await writeRecord(record);
  const verified = await decryptLocalState(await readRecord(recordId()));
  if (JSON.stringify(verified) !== JSON.stringify(safeState)) {
    throw new Error('Encrypted local state verification failed.');
  }
  if (legacyPending) {
    LEGACY_KEYS.forEach(removeLocalStorage);
    legacyPending = false;
  }
}

export async function useAccountEncryptionKey(accountId, key, metadata = {}) {
  if (typeof accountId !== 'string' || !accountId || !key) {
    throw new Error('A valid account encryption context is required.');
  }
  if (backend !== 'indexeddb' || !database) {
    context = {
      scope: `account:${accountId}`,
      keyId: `account:${accountId}`,
      key,
    };
    return;
  }
  const keyId = `account:${accountId}`;
  await writeKey({
    id: keyId,
    key,
    salt: metadata.salt ? encodeBytes(metadata.salt) : undefined,
    keyVersion: metadata.keyVersion || 1,
    updatedAt: Date.now(),
  });
  context = { scope: keyId, keyId, key };
}

export async function getAccountEncryptionKey(accountId) {
  if (backend !== 'indexeddb' || !database || !accountId) return null;
  const record = await readKey(`account:${accountId}`);
  if (!record?.key) return null;
  return {
    key: record.key,
    salt: record.salt ? decodeBytes(record.salt) : null,
    keyVersion: record.keyVersion || 1,
  };
}

export async function loadAccountState(accountId, key) {
  if (!accountId || !key) return null;
  if (backend !== 'indexeddb' || !database) return null;
  const previousContext = context;
  context = {
    scope: `account:${accountId}`,
    keyId: `account:${accountId}`,
    key,
  };
  try {
    const record = await readRecord(recordId());
    if (!record || record.scope !== context.scope) return null;
    return await decryptLocalState(record);
  } finally {
    context = previousContext;
  }
}

export async function deleteCurrentAccountLocalState(accountId) {
  if (backend !== 'indexeddb' || !database || !accountId) return;
  const keyId = `account:${accountId}`;
  await deleteKey(keyId);
  const record = await readRecord(recordId(keyId));
  if (record?.scope === keyId) await deleteRecord(recordId(keyId));
  await createGuestContext();
}

export async function clearGuestState() {
  if (backend !== 'indexeddb' || !database) return;
  await deleteRecord(recordId('guest'));
  await deleteRecord('local');
  if (context.scope === 'guest') await createGuestContext();
  legacyPending = false;
  LEGACY_KEYS.forEach(removeLocalStorage);
}

export async function getCurrentEncryptedRecord() {
  if (backend !== 'indexeddb' || !database) return null;
  return readRecord(recordId());
}

export default {
  initializeSecureStorage,
  saveSecureState,
  useAccountEncryptionKey,
  getAccountEncryptionKey,
  loadAccountState,
  deleteCurrentAccountLocalState,
  clearGuestState,
};
