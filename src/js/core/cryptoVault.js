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
        decode: (bytes) =>
          decodeURIComponent(escape(String.fromCharCode(...bytes))),
      };
const RECOVERY_PREFIX = 'URE1';
const RECOVERY_GROUP_LENGTH = 8;

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
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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
  const parts = normalized.split('-');
  if (parts.length < 3 || parts.shift().toUpperCase() !== RECOVERY_PREFIX) {
    throw new Error('Recovery Key format is invalid.');
  }
  const checksum = parts.pop().toUpperCase();
  const encoded = parts.join('');
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
  supportsWebCrypto,
  randomBytes,
  createRecoveryKey,
  formatRecoveryKey,
  parseRecoveryKey,
  deriveEncryptionKey,
  generateDeviceKey,
  encryptJson,
  decryptJson,
  encodeBytes,
  decodeBytes,
};
