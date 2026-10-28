import { TextDecoder, TextEncoder } from 'util';
import { apiInternals, handleApiRequest } from './api.js';

// jsdom does not expose these; the Workers runtime does.
global.TextEncoder = global.TextEncoder || TextEncoder;
global.TextDecoder = global.TextDecoder || TextDecoder;

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

  describe('session and sync D1 behaviour (fake DB)', () => {
    const ORIGIN = 'https://url-editor.ointw.com';
    const sha = async (value) =>
      [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
        ),
      ]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const req = (path, { method = 'GET', headers = {}, body } = {}) => {
      const bytes = new TextEncoder().encode(body ?? '');
      return {
        url: `${ORIGIN}${path}`,
        method,
        headers: new Headers(headers),
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
      };
    };
    const nowS = () => Math.floor(Date.now() / 1000);
    const envelope = (revision) => ({
      revision,
      payloadSchemaVersion: 1,
      keyVersion: 1,
      kdfSalt: base64Url(new Uint8Array(16)),
      iv: base64Url(new Uint8Array(12)),
      ciphertext: base64Url(new Uint8Array(16)),
    });
    let accountCounter = 0;
    // handlers: [sqlSubstring, (sql, args) => result]
    const makeDb = (handlers) => {
      const find = (sql) => handlers.find(([needle]) => sql.includes(needle));
      const exec = (sql, args) => {
        const h = find(sql);
        if (!h) throw new Error(`unexpected SQL: ${sql}`);
        return h[1](sql, args);
      };
      return {
        prepare: (sql) => ({
          bind: (...args) => ({
            sql,
            args,
            first: async () => exec(sql, args),
            run: async () => exec(sql, args),
            all: async () => exec(sql, args),
          }),
        }),
        batch: async (statements) =>
          Promise.all(statements.map((s) => s.run())),
      };
    };
    const sessionRow = async (token, extra = {}) => ({
      token_hash: await sha(token),
      csrf_hash: await sha('csrf-token'),
      user_id: 1,
      account_id: `acct-${++accountCounter}`,
      email: 'a@example.com',
      display_name: 'A',
      expires_at: nowS() + 86400,
      last_rotated_at: nowS() - 30 * 86400,
      last_authenticated_at: nowS(),
      ...extra,
    });

    test('B3: does not set a rotated cookie when the rotation UPDATE changed 0 rows (lost race)', async () => {
      const row = await sessionRow('old-token');
      const db = makeDb([
        ['SELECT s.*', () => row],
        ['UPDATE sessions SET token_hash', () => ({ meta: { changes: 0 } })],
        ['UPDATE sessions SET csrf_hash', () => ({ meta: { changes: 0 } })],
      ]);
      const response = await handleApiRequest(
        req('/api/session', {
          headers: { Cookie: '__Host-ue_session=old-token' },
        }),
        { DB: db }
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Set-Cookie')).toBeNull();
    });

    test('B3: sets the rotated cookie when the rotation UPDATE changed exactly 1 row', async () => {
      const row = await sessionRow('old-token');
      const db = makeDb([
        ['SELECT s.*', () => row],
        ['UPDATE sessions SET token_hash', () => ({ meta: { changes: 1 } })],
        ['UPDATE sessions SET csrf_hash', () => ({ meta: { changes: 1 } })],
      ]);
      const response = await handleApiRequest(
        req('/api/session', {
          headers: { Cookie: '__Host-ue_session=old-token' },
        }),
        { DB: db }
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('Set-Cookie')).toContain(
        '__Host-ue_session='
      );
    });

    const putSync = (db) =>
      handleApiRequest(
        req('/api/sync', {
          method: 'PUT',
          headers: {
            Origin: ORIGIN,
            Cookie: '__Host-ue_session=tok',
            'X-CSRF-Token': 'csrf-token',
            'If-Match': '"rev-1"',
          },
          body: JSON.stringify(envelope(2)),
        }),
        { DB: db }
      );
    const syncHandlers = async (cleanup) => {
      const row = await sessionRow('tok', { last_rotated_at: nowS() });
      return [
        ['SELECT s.*', () => row],
        ['SELECT * FROM sync_documents', () => ({ revision: 1 })],
        ['INSERT INTO sync_revisions', () => ({ meta: { changes: 1 } })],
        ['UPDATE sync_documents', () => ({ meta: { changes: 1 } })],
        ['DELETE FROM sync_revisions', cleanup],
      ];
    };

    test('B4: reports success when history cleanup throws after a committed write', async () => {
      const db = makeDb(
        await syncHandlers(() => {
          throw new Error('cleanup failed');
        })
      );
      const response = await putSync(db);
      expect(response.status).toBe(200);
      expect((await response.json()).revision).toBe(2);
    });

    test('B4: still returns SYNC_CONFLICT when the write itself matches 0 rows', async () => {
      const handlers = await syncHandlers(() => ({ meta: { changes: 0 } }));
      handlers.find(([n]) => n === 'UPDATE sync_documents')[1] = () => ({
        meta: { changes: 0 },
      });
      const response = await putSync(makeDb(handlers));
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('SYNC_CONFLICT');
    });

    test('B4: still returns SYNC_CONFLICT when the write throws', async () => {
      const handlers = await syncHandlers(() => ({ meta: { changes: 0 } }));
      handlers.find(([n]) => n === 'UPDATE sync_documents')[1] = () => {
        throw new Error('constraint');
      };
      const response = await putSync(makeDb(handlers));
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe('SYNC_CONFLICT');
    });
  });
});
