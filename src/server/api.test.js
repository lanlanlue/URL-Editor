import { apiInternals, handleApiRequest } from './api.js';

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

describe('Pages API boundary', () => {
  test('returns only public OAuth configuration without touching D1', async () => {
    const response = await handleApiRequest(
      new Request('https://url-editor.ointw.com/api/config'),
      { GOOGLE_CLIENT_ID: 'public-client-id' }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      googleClientId: 'public-client-id',
    });
  });

  test('does not expose OAuth configuration on a Pages preview host', async () => {
    const response = await handleApiRequest(
      new Request('https://preview.url-editor.pages.dev/api/config'),
      { GOOGLE_CLIENT_ID: 'public-client-id' }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ googleClientId: '' });
  });

  test('accepts the documented envelope and rejects unknown fields', () => {
    const valid = {
      revision: 1,
      payloadSchemaVersion: 1,
      keyVersion: 1,
      kdfSalt: base64Url(new Uint8Array(16)),
      iv: base64Url(new Uint8Array(12)),
      ciphertext: base64Url(new Uint8Array(16)),
    };
    expect(apiInternals.validateEnvelope(valid)).toBe(true);
    expect(
      apiInternals.validateEnvelope({ ...valid, plaintext: 'secret' })
    ).toBe(false);
    expect(apiInternals.parseEtag('"rev-12"')).toBe(12);
    expect(apiInternals.parseEtag('rev-12')).toBeNull();
  });

  test('rejects mutation requests without a same-origin Origin header', async () => {
    const response = await handleApiRequest(
      new Request('https://url-editor.ointw.com/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential: 'invalid', csrfToken: 'invalid' }),
      }),
      {}
    );
    expect(response.status).toBe(403);
  });

  describe('POST /api/probe', () => {
    const post = (headers = {}, body = { url: 'https://example.com' }) =>
      handleApiRequest(
        new Request('https://url-editor.ointw.com/api/probe', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
        {}
      );

    test('rejects a cross-origin or missing Origin', async () => {
      expect((await post()).status).toBe(403);
      expect((await post({ Origin: 'https://evil.example' })).status).toBe(403);
    });

    test('requires a session', async () => {
      const response = await post({ Origin: 'https://url-editor.ointw.com' });
      expect(response.status).toBe(401);
    });
  });
});
