const TEXT_ENCODER =
  typeof TextEncoder !== 'undefined'
    ? new TextEncoder()
    : {
        encode: (value) =>
          Uint8Array.from(unescape(encodeURIComponent(value)), (character) =>
            character.charCodeAt(0)
          ),
      };
const TEXT_DECODER =
  typeof TextDecoder !== 'undefined'
    ? new TextDecoder()
    : {
        // SubtleCrypto.decrypt returns an ArrayBuffer (not iterable); wrap it
        // and convert in chunks to stay under the call-argument limit.
        decode: (input) => {
          const bytes = new Uint8Array(input);
          let binary = '';
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(
              null,
              bytes.subarray(i, i + 0x8000)
            );
          }
          return decodeURIComponent(escape(binary));
        },
      };
const RECOVERY_PREFIX = 'URE1';
const RECOVERY_GROUP_LENGTH = 8;
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 8;
const MIN_PBKDF2_ITERATIONS = 100_000;
const MAX_PBKDF2_ITERATIONS = 2_000_000;

function getCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('Web Crypto API is unavailable.');
  }
  return globalThis.crypto;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new Error('Invalid base64url value.');
  }
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error('Invalid base64url value.');
  }
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left[index] ^ right[index];
  }
  return result === 0;
}

async function recoveryChecksum(secret) {
  const digest = await getCrypto().subtle.digest('SHA-256', secret);
  return bytesToBase64Url(new Uint8Array(digest).slice(0, 3))
    .slice(0, 4)
    .toUpperCase();
}

export function supportsWebCrypto() {
  return Boolean(
    globalThis.crypto?.subtle &&
      globalThis.crypto?.getRandomValues &&
      typeof TextEncoder !== 'undefined' &&
      typeof TextDecoder !== 'undefined'
  );
}

export function randomBytes(length) {
  if (!Number.isInteger(length) || length <= 0 || length > 1024) {
    throw new Error('Invalid random byte length.');
  }
  const bytes = new Uint8Array(length);
  getCrypto().getRandomValues(bytes);
  return bytes;
}

export function bytesToKeyMaterial(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new Error('Recovery secret must contain 32 bytes.');
  }
  return new Uint8Array(bytes);
}

export async function formatRecoveryKey(secret) {
  const material = bytesToKeyMaterial(secret);
  const encoded = bytesToBase64Url(material);
  const groups =
    encoded.match(new RegExp(`.{1,${RECOVERY_GROUP_LENGTH}}`, 'g')) || [];
  return `${RECOVERY_PREFIX}-${groups.join('-')}-${await recoveryChecksum(material)}`;
}

export async function createRecoveryKey() {
  const secret = randomBytes(32);
  return { secret, display: await formatRecoveryKey(secret) };
}

export async function parseRecoveryKey(value) {
  if (typeof value !== 'string') throw new Error('Recovery Key is required.');
  const normalized = value.trim().replace(/\s+/g, '');
  const prefix = `${RECOVERY_PREFIX}-`;
  if (
    normalized.length < prefix.length + 6 ||
    normalized.slice(0, prefix.length).toUpperCase() !== prefix
  ) {
    throw new Error('Recovery Key format is invalid.');
  }
  const rest = normalized.slice(prefix.length);
  const sepIndex = rest.length - 5;
  if (sepIndex < 1 || rest[sepIndex] !== '-') {
    throw new Error('Recovery Key format is invalid.');
  }
  const body = rest.slice(0, sepIndex);
  const checksum = rest.slice(sepIndex + 1).toUpperCase();
  // Keep Base64URL '-' characters intact by only removing the 8-char group separators.
  const isGrouped =
    body.length === 48 &&
    [8, 17, 26, 35, 44].every((index) => body[index] === '-');
  const encoded = isGrouped
    ? [...body].filter((_, index) => index % 9 !== 8).join('')
    : body.replace(/-/g, '');
  const secret = base64UrlToBytes(encoded);
  const expectedChecksum = await recoveryChecksum(secret);
  if (
    secret.length !== 32 ||
    !constantTimeEqual(
      TEXT_ENCODER.encode(expectedChecksum),
      TEXT_ENCODER.encode(checksum)
    )
  ) {
    throw new Error('Recovery Key checksum is invalid.');
  }
  return secret;
}

export async function deriveEncryptionKey(
  secret,
  salt,
  info = 'URL Editor E2EE v1'
) {
  const material = bytesToKeyMaterial(secret);
  const normalizedSalt =
    salt instanceof Uint8Array ? salt : base64UrlToBytes(salt);
  if (normalizedSalt.length !== 16)
    throw new Error('Encryption salt must contain 16 bytes.');
  const baseKey = await getCrypto().subtle.importKey(
    'raw',
    material,
    'HKDF',
    false,
    ['deriveKey']
  );
  return getCrypto().subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: normalizedSalt,
      info: TEXT_ENCODER.encode(info),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function generateDekBytes() {
  return randomBytes(32);
}

export async function importDekKey(dekBytes) {
  const material = bytesToKeyMaterial(dekBytes);
  return getCrypto().subtle.importKey(
    'raw',
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function evaluatePasswordStrength(password) {
  const value = typeof password === 'string' ? password : '';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, score: 0, label: 'tooShort' };
  }
  let score = 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  if (value.length >= 16 && score < 4) score += 1;
  const label = score >= 4 ? 'strong' : score >= 2 ? 'fair' : 'weak';
  return { valid: true, score, label };
}

function normalizeSalt16(salt) {
  const normalized = salt instanceof Uint8Array ? salt : base64UrlToBytes(salt);
  if (normalized.length !== 16) {
    throw new Error('Encryption salt must contain 16 bytes.');
  }
  return normalized;
}

export async function derivePasswordKek(
  password,
  salt,
  iterations = PBKDF2_ITERATIONS
) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password is required.');
  }
  if (
    !Number.isInteger(iterations) ||
    iterations < MIN_PBKDF2_ITERATIONS ||
    iterations > MAX_PBKDF2_ITERATIONS
  ) {
    throw new Error('Invalid PBKDF2 iteration count.');
  }
  const normalizedSalt = normalizeSalt16(salt);
  const baseKey = await getCrypto().subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return getCrypto().subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: normalizedSalt,
      iterations,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function slotAad(accountId, slotName, keyVersion = 1) {
  if (typeof accountId !== 'string' || !accountId) {
    throw new Error('Account ID is required.');
  }
  return JSON.stringify({ accountId, slot: slotName, keyVersion });
}

export async function deriveRecoveryKek(secret, salt, accountId) {
  if (typeof accountId !== 'string' || !accountId) {
    throw new Error('Account ID is required.');
  }
  return deriveEncryptionKey(
    secret,
    salt,
    `URL Editor Recovery KEK v2:${accountId}`
  );
}

export async function wrapDekWithKek(dekBytes, kek, aad) {
  const material = bytesToKeyMaterial(dekBytes);
  const iv = randomBytes(12);
  const ciphertext = await getCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encodeAad(aad), tagLength: 128 },
    kek,
    material
  );
  return {
    iv: bytesToBase64Url(iv),
    wrappedKey: bytesToBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function unwrapDekWithKek(slot, kek, aad) {
  if (!slot || typeof slot !== 'object') {
    throw new Error('Key slot is missing.');
  }
  const plaintext = await getCrypto().subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(slot.iv),
      additionalData: encodeAad(aad),
      tagLength: 128,
    },
    kek,
    base64UrlToBytes(slot.wrappedKey)
  );
  return bytesToKeyMaterial(new Uint8Array(plaintext));
}

export async function createKeySlots({
  dekBytes,
  password,
  recoverySecret,
  accountId,
  keyVersion = 1,
  iterations = PBKDF2_ITERATIONS,
}) {
  const material = bytesToKeyMaterial(dekBytes);
  if (!password && !recoverySecret) {
    throw new Error('At least one key slot secret is required.');
  }
  const slots = { v: 1 };
  if (password !== undefined && password !== null) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
    }
    const salt = randomBytes(16);
    const kek = await derivePasswordKek(password, salt, iterations);
    const wrapped = await wrapDekWithKek(
      material,
      kek,
      slotAad(accountId, 'password', keyVersion)
    );
    slots.password = {
      kdf: 'PBKDF2-SHA256',
      salt: bytesToBase64Url(salt),
      iterations,
      iv: wrapped.iv,
      wrappedKey: wrapped.wrappedKey,
    };
  }
  if (recoverySecret) {
    const salt = randomBytes(16);
    const kek = await deriveRecoveryKek(recoverySecret, salt, accountId);
    const wrapped = await wrapDekWithKek(
      material,
      kek,
      slotAad(accountId, 'recovery', keyVersion)
    );
    slots.recovery = {
      kdf: 'HKDF-SHA256',
      salt: bytesToBase64Url(salt),
      iv: wrapped.iv,
      wrappedKey: wrapped.wrappedKey,
    };
  }
  return slots;
}

export async function unwrapDekFromPasswordSlot(
  slot,
  password,
  accountId,
  keyVersion = 1
) {
  if (!slot || slot.kdf !== 'PBKDF2-SHA256') {
    throw new Error('Password key slot is unavailable.');
  }
  const kek = await derivePasswordKek(password, slot.salt, slot.iterations);
  const dekBytes = await unwrapDekWithKek(
    slot,
    kek,
    slotAad(accountId, 'password', keyVersion)
  );
  const dekKey = await importDekKey(dekBytes);
  return { dekBytes, dekKey };
}

export async function unwrapDekFromRecoverySlot(
  slot,
  recoverySecret,
  accountId,
  keyVersion = 1
) {
  if (!slot || slot.kdf !== 'HKDF-SHA256') {
    throw new Error('Recovery key slot is unavailable.');
  }
  const kek = await deriveRecoveryKek(recoverySecret, slot.salt, accountId);
  const dekBytes = await unwrapDekWithKek(
    slot,
    kek,
    slotAad(accountId, 'recovery', keyVersion)
  );
  const dekKey = await importDekKey(dekBytes);
  return { dekBytes, dekKey };
}

export async function generateDeviceKey() {
  return getCrypto().subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function encodeAad(aad) {
  return TEXT_ENCODER.encode(
    typeof aad === 'string' ? aad : JSON.stringify(aad)
  );
}

export async function encryptJson(value, key, aad = '') {
  const iv = randomBytes(12);
  const ciphertext = await getCrypto().subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encodeAad(aad), tagLength: 128 },
    key,
    TEXT_ENCODER.encode(JSON.stringify(value))
  );
  return {
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    aad: typeof aad === 'string' ? aad : JSON.stringify(aad),
  };
}

export async function decryptJson(envelope, key, aad = envelope?.aad || '') {
  if (!envelope || typeof envelope !== 'object')
    throw new Error('Encrypted data is invalid.');
  const expectedAad = typeof aad === 'string' ? aad : JSON.stringify(aad);
  if (envelope.aad !== expectedAad)
    throw new Error('Encrypted data authentication failed.');
  const plaintext = await getCrypto().subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(envelope.iv),
      additionalData: encodeAad(expectedAad),
      tagLength: 128,
    },
    key,
    base64UrlToBytes(envelope.ciphertext)
  );
  return JSON.parse(TEXT_DECODER.decode(plaintext));
}

export function encodeBytes(bytes) {
  return bytesToBase64Url(bytes);
}

export function decodeBytes(value) {
  return base64UrlToBytes(value);
}

export default {
  PBKDF2_ITERATIONS,
  MIN_PASSWORD_LENGTH,
  supportsWebCrypto,
  randomBytes,
  createRecoveryKey,
  formatRecoveryKey,
  parseRecoveryKey,
  deriveEncryptionKey,
  generateDekBytes,
  importDekKey,
  evaluatePasswordStrength,
  derivePasswordKek,
  deriveRecoveryKek,
  wrapDekWithKek,
  unwrapDekWithKek,
  createKeySlots,
  unwrapDekFromPasswordSlot,
  unwrapDekFromRecoverySlot,
  generateDeviceKey,
  encryptJson,
  decryptJson,
  encodeBytes,
  decodeBytes,
};
