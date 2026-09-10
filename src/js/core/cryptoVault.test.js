import {
  createRecoveryKey,
  formatRecoveryKey,
  parseRecoveryKey,
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
