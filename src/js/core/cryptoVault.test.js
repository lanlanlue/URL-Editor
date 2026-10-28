import {
  bytesToKeyMaterial,
  createRecoveryKey,
  decodeBytes,
  decryptJson,
  deriveEncryptionKey,
  encodeBytes,
  encryptJson,
  formatRecoveryKey,
  generateDeviceKey,
  parseRecoveryKey,
  randomBytes,
  supportsWebCrypto,
} from './cryptoVault.js';

describe('cryptoVault Recovery Key format', () => {
  test('round trips a 32-byte secret and rejects tampering', async () => {
    const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
    const formatted = await formatRecoveryKey(secret);
    const parsed = await parseRecoveryKey(formatted);
    expect([...parsed]).toEqual([...secret]);

    const tampered = `${formatted.slice(0, -1)}${formatted.endsWith('A') ? 'B' : 'A'}`;
    await expect(parseRecoveryKey(tampered)).rejects.toThrow(/checksum/i);
  });

  test('generates a versioned Recovery Key', async () => {
    const generated = await createRecoveryKey();
    expect(generated.display).toMatch(
      /^URE1-(?:[A-Za-z0-9_-]+-)+[A-Za-z0-9_-]+$/
    );
    expect(generated.secret).toHaveLength(32);
  });
});

describe('cryptoVault parseRecoveryKey validation', () => {
  const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

  test('rejects non-string input', async () => {
    await expect(parseRecoveryKey(undefined)).rejects.toThrow(/required/i);
    await expect(parseRecoveryKey(42)).rejects.toThrow(/required/i);
  });

  test('rejects a wrong prefix and too few segments', async () => {
    await expect(parseRecoveryKey('XXXX-AAAA-BBBB')).rejects.toThrow(/format/i);
    await expect(parseRecoveryKey('URE1-AAAA')).rejects.toThrow(/format/i);
    await expect(parseRecoveryKey('')).rejects.toThrow(/format/i);
  });

  test('rejects characters outside base64url', async () => {
    await expect(parseRecoveryKey('URE1-AB$D-ABCD')).rejects.toThrow(
      /base64url/i
    );
  });

  test('rejects a secret of the wrong length', async () => {
    await expect(parseRecoveryKey('URE1-AAAAAAAA-ABCD')).rejects.toThrow(
      /checksum/i
    );
  });

  test('accepts extra whitespace and newlines but is case-sensitive in the payload', async () => {
    const formatted = await formatRecoveryKey(secret);
    const spaced = `  ${formatted.replace(/-/g, '- ')}\n`;
    expect([...(await parseRecoveryKey(spaced))]).toEqual([...secret]);
    await expect(parseRecoveryKey(formatted.toLowerCase())).rejects.toThrow();
  });

  test('prefix and checksum are case-insensitive', async () => {
    const formatted = await formatRecoveryKey(secret);
    const parts = formatted.split('-');
    parts[0] = parts[0].toLowerCase();
    parts[parts.length - 1] = parts[parts.length - 1].toLowerCase();
    expect([...(await parseRecoveryKey(parts.join('-')))]).toEqual([...secret]);
  });

  test('formatRecoveryKey rejects non-32-byte or non-Uint8Array secrets', async () => {
    await expect(formatRecoveryKey(new Uint8Array(31))).rejects.toThrow(
      /32 bytes/
    );
    await expect(formatRecoveryKey([1, 2, 3])).rejects.toThrow(/32 bytes/);
  });
});

describe('cryptoVault helpers', () => {
  test('randomBytes validates length and returns random data', () => {
    expect(() => randomBytes(0)).toThrow(/length/i);
    expect(() => randomBytes(-1)).toThrow(/length/i);
    expect(() => randomBytes(1.5)).toThrow(/length/i);
    expect(() => randomBytes(1025)).toThrow(/length/i);
    const a = randomBytes(16);
    const b = randomBytes(16);
    expect(a).toHaveLength(16);
    expect([...a]).not.toEqual([...b]);
  });

  test('bytesToKeyMaterial copies the input', () => {
    const source = new Uint8Array(32).fill(7);
    const copy = bytesToKeyMaterial(source);
    copy[0] = 9;
    expect(source[0]).toBe(7);
  });

  test('encodeBytes/decodeBytes round trip and reject invalid base64url', () => {
    const bytes = Uint8Array.from([0, 250, 251, 252, 253, 254, 255]);
    const encoded = encodeBytes(bytes);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect([...decodeBytes(encoded)]).toEqual([...bytes]);
    expect(() => decodeBytes('a+b')).toThrow(/base64url/i);
    expect(() => decodeBytes(null)).toThrow(/base64url/i);
  });

  test('supportsWebCrypto is false in jsdom (no TextEncoder/TextDecoder globals)', () => {
    expect(typeof TextDecoder).toBe('undefined');
    expect(supportsWebCrypto()).toBe(false);
  });
});

// jsdom lacks TextEncoder/TextDecoder, and the module's TextDecoder fallback
// cannot decode the ArrayBuffer returned by SubtleCrypto.decrypt (see report).
// Browsers have the real classes, so the encrypt/decrypt suite loads a fresh
// module copy with Node's implementations installed, as in a real browser.
function loadVaultWithTextCodecs() {
  const util = require('util');
  const saved = { enc: global.TextEncoder, dec: global.TextDecoder };
  global.TextEncoder = util.TextEncoder;
  global.TextDecoder = util.TextDecoder;
  let vault;
  jest.isolateModules(() => {
    vault = require('./cryptoVault.js');
  });
  return {
    vault,
    restore: () => {
      global.TextEncoder = saved.enc;
      global.TextDecoder = saved.dec;
    },
  };
}

describe('cryptoVault encrypt/decrypt', () => {
  let decryptJson, deriveEncryptionKey, encryptJson, generateDeviceKey;
  let supportsWebCrypto;
  let restore;
  beforeAll(() => {
    const loaded = loadVaultWithTextCodecs();
    ({ decryptJson, deriveEncryptionKey, encryptJson, generateDeviceKey } =
      loaded.vault);
    ({ supportsWebCrypto } = loaded.vault);
    restore = loaded.restore;
  });
  afterAll(() => restore());

  test('supportsWebCrypto is true with Web Crypto and text codecs', () => {
    expect(supportsWebCrypto()).toBe(true);
  });

  const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
  const secret = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
  const otherSecret = Uint8Array.from({ length: 32 }, (_, index) => index);

  test('round trips JSON with string and object AAD', async () => {
    const key = await deriveEncryptionKey(secret, salt);
    const envelope = await encryptJson({ a: [1, 'é'] }, key, 'ctx');
    expect(envelope.aad).toBe('ctx');
    await expect(decryptJson(envelope, key)).resolves.toEqual({ a: [1, 'é'] });

    const withObject = await encryptJson({ n: 1 }, key, { user: 'u1', rev: 2 });
    expect(withObject.aad).toBe(JSON.stringify({ user: 'u1', rev: 2 }));
    await expect(
      decryptJson(withObject, key, { user: 'u1', rev: 2 })
    ).resolves.toEqual({ n: 1 });
  });

  test('uses a fresh IV per encryption', async () => {
    const key = await deriveEncryptionKey(secret, salt);
    const one = await encryptJson({ x: 1 }, key);
    const two = await encryptJson({ x: 1 }, key);
    expect(one.iv).not.toBe(two.iv);
    expect(one.ciphertext).not.toBe(two.ciphertext);
  });

  test('derivation accepts base64url salt and rejects bad salt/secret length', async () => {
    const keyA = await deriveEncryptionKey(secret, salt);
    const keyB = await deriveEncryptionKey(secret, encodeBytes(salt));
    const envelope = await encryptJson({ ok: true }, keyA, 'x');
    await expect(decryptJson(envelope, keyB)).resolves.toEqual({ ok: true });
    await expect(
      deriveEncryptionKey(secret, new Uint8Array(8))
    ).rejects.toThrow(/16 bytes/);
    await expect(deriveEncryptionKey(new Uint8Array(5), salt)).rejects.toThrow(
      /32 bytes/
    );
  });

  test('different info strings derive different keys', async () => {
    const keyA = await deriveEncryptionKey(secret, salt, 'info-a');
    const keyB = await deriveEncryptionKey(secret, salt, 'info-b');
    const envelope = await encryptJson({ v: 1 }, keyA);
    await expect(decryptJson(envelope, keyB)).rejects.toThrow();
  });

  test('decrypt with the wrong key fails', async () => {
    const key = await deriveEncryptionKey(secret, salt);
    const wrong = await deriveEncryptionKey(otherSecret, salt);
    const envelope = await encryptJson({ v: 1 }, key, 'aad');
    await expect(decryptJson(envelope, wrong)).rejects.toThrow();
  });

  test('tampered ciphertext fails authentication', async () => {
    const key = await deriveEncryptionKey(secret, salt);
    const envelope = await encryptJson({ v: 1 }, key, 'aad');
    const bytes = decodeBytes(envelope.ciphertext);
    bytes[0] ^= 0xff;
    await expect(
      decryptJson({ ...envelope, ciphertext: encodeBytes(bytes) }, key)
    ).rejects.toThrow();
  });

  test('tampered IV fails authentication', async () => {
    const key = await deriveEncryptionKey(secret, salt);
    const envelope = await encryptJson({ v: 1 }, key, 'aad');
    const iv = decodeBytes(envelope.iv);
    iv[0] ^= 0xff;
    await expect(
      decryptJson({ ...envelope, iv: encodeBytes(iv) }, key)
    ).rejects.toThrow();
  });

  test('mismatched AAD is rejected by argument and by envelope edit', async () => {
    const key = await deriveEncryptionKey(secret, salt);
    const envelope = await encryptJson({ v: 1 }, key, 'aad-1');
    await expect(decryptJson(envelope, key, 'aad-2')).rejects.toThrow(
      /authentication failed/i
    );
    // Rewriting the stored AAD makes the pre-check pass but AES-GCM still rejects.
    await expect(
      decryptJson({ ...envelope, aad: 'aad-2' }, key)
    ).rejects.toThrow();
  });

  test('rejects missing or non-object envelopes', async () => {
    const key = await deriveEncryptionKey(secret, salt);
    await expect(decryptJson(null, key)).rejects.toThrow(/invalid/i);
    await expect(decryptJson('str', key)).rejects.toThrow(/invalid/i);
  });

  test('rejects envelopes with malformed base64url fields', async () => {
    const key = await deriveEncryptionKey(secret, salt);
    const envelope = await encryptJson({ v: 1 }, key);
    await expect(
      decryptJson({ ...envelope, ciphertext: 'a+b/' }, key)
    ).rejects.toThrow(/base64url/i);
  });

  test('generateDeviceKey yields a non-extractable AES-GCM key', async () => {
    const key = await generateDeviceKey();
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    const envelope = await encryptJson({ d: 1 }, key);
    await expect(decryptJson(envelope, key)).resolves.toEqual({ d: 1 });
  });
});

describe('cryptoVault without Web Crypto', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', original);
  });

  function stubCrypto(value) {
    Object.defineProperty(globalThis, 'crypto', {
      value,
      configurable: true,
      writable: true,
    });
  }

  test('supportsWebCrypto is false and operations throw', async () => {
    stubCrypto(undefined);
    expect(supportsWebCrypto()).toBe(false);
    expect(() => randomBytes(8)).toThrow(/Web Crypto API is unavailable/);
    await expect(generateDeviceKey()).rejects.toThrow(/unavailable/);
    await expect(formatRecoveryKey(new Uint8Array(32))).rejects.toThrow(
      /unavailable/
    );
  });

  test('missing getRandomValues alone is also unsupported', () => {
    stubCrypto({ subtle: {} });
    expect(supportsWebCrypto()).toBe(false);
    expect(() => randomBytes(8)).toThrow(/unavailable/);
  });
});
