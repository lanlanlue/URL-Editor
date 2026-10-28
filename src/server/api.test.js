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

    describe('B8: body read errors map to a fixed code set', () => {
      const failingBody = (message) => ({
        arrayBuffer: async () => {
          throw new Error(message);
        },
      });
      const login = (overrides) =>
        handleApiRequest(
          {
            ...req('/api/auth/google', {
              method: 'POST',
              headers: { Origin: ORIGIN, 'CF-Connecting-IP': 'b8-login' },
            }),
            ...overrides,
          },
          {}
        );

      test.each([
        ['PAYLOAD_TOO_LARGE', 413],
        ['INVALID_JSON', 422],
      ])('login keeps sentinel %s', async (code, status) => {
        const response = await login(failingBody(code));
        expect(response.status).toBe(status);
        expect((await response.json()).code).toBe(code);
      });

      test('login does not echo an arbitrary error message as the code', async () => {
        const response = await login(failingBody('D1_ERROR: secret detail'));
        const body = await response.json();
        expect(response.status).toBe(422);
        expect(body.code).toBe('INVALID_BODY');
        expect(JSON.stringify(body)).not.toContain('secret detail');
      });

      test('sync PUT does not echo an arbitrary error message as the code', async () => {
        const handlers = await syncHandlers(() => ({ meta: { changes: 0 } }));
        const response = await handleApiRequest(
          {
            ...req('/api/sync', {
              method: 'PUT',
              headers: {
                Origin: ORIGIN,
                Cookie: '__Host-ue_session=tok',
                'X-CSRF-Token': 'csrf-token',
                'If-Match': '"rev-1"',
              },
            }),
            ...failingBody('stream exploded at /internal/path'),
          },
          { DB: makeDb(handlers) }
        );
        const body = await response.json();
        expect(response.status).toBe(422);
        expect(body.code).toBe('INVALID_BODY');
        expect(JSON.stringify(body)).not.toContain('/internal/path');
      });

      test('sync PUT keeps the PAYLOAD_TOO_LARGE sentinel', async () => {
        const handlers = await syncHandlers(() => ({ meta: { changes: 0 } }));
        const response = await handleApiRequest(
          {
            ...req('/api/sync', {
              method: 'PUT',
              headers: {
                Origin: ORIGIN,
                Cookie: '__Host-ue_session=tok',
                'X-CSRF-Token': 'csrf-token',
                'If-Match': '"rev-1"',
              },
            }),
            ...failingBody('PAYLOAD_TOO_LARGE'),
          },
          { DB: makeDb(handlers) }
        );
        expect(response.status).toBe(413);
        expect((await response.json()).code).toBe('PAYLOAD_TOO_LARGE');
      });
    });

    describe('B9: Google credential verification', () => {
      const CLIENT_ID = 'test-client-id';
      const toB64Url = (value) =>
        base64Url(
          typeof value === 'string' ? new TextEncoder().encode(value) : value
        );
      let keyPair;
      let publicJwk;
      let ipCounter = 0;
      const loadApi = () => {
        let api;
        jest.isolateModules(() => {
          api = require('./api.js');
        });
        return api;
      };
      const signedCredential = async (claimsOverride = {}, removeExp) => {
        const header = toB64Url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
        const claims = {
          iss: 'https://accounts.google.com',
          aud: CLIENT_ID,
          email_verified: true,
          sub: 'google-sub-1',
          email: 'a@example.com',
          exp: nowS() + 3600,
          ...claimsOverride,
        };
        if (removeExp) delete claims.exp;
        const payload = toB64Url(JSON.stringify(claims));
        const signature = await crypto.subtle.sign(
          { name: 'RSASSA-PKCS1-v1_5' },
          keyPair.privateKey,
          new TextEncoder().encode(`${header}.${payload}`)
        );
        return `${header}.${payload}.${toB64Url(new Uint8Array(signature))}`;
      };
      const jwksFetch = () =>
        jest.fn(async () => ({
          ok: true,
          json: async () => ({ keys: [{ ...publicJwk, kid: 'k1' }] }),
          headers: new Headers(),
        }));
      const loginWith = (api, credential) => {
        const csrf = 'oauth-csrf';
        const db = makeDb([
          ['SELECT id FROM users', () => ({ id: 'user-1' })],
          ['', () => ({ meta: { changes: 1 } })],
        ]);
        return api.handleApiRequest(
          req('/api/auth/google', {
            method: 'POST',
            headers: {
              Origin: ORIGIN,
              Cookie: `__Host-ue_oauth_csrf=${csrf}`,
              'CF-Connecting-IP': `b9-${++ipCounter}`,
            },
            body: JSON.stringify({ credential, csrfToken: csrf }),
          }),
          { DB: db, GOOGLE_CLIENT_ID: CLIENT_ID }
        );
      };
      const realFetch = global.fetch;
      afterEach(() => {
        global.fetch = realFetch;
        jest.useRealTimers();
      });

      beforeAll(async () => {
        keyPair = await crypto.subtle.generateKey(
          {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
          },
          true,
          ['sign', 'verify']
        );
        publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
      });

      test('accepts a valid, unexpired credential (control)', async () => {
        global.fetch = jwksFetch();
        const response = await loginWith(loadApi(), await signedCredential());
        expect(response.status).toBe(200);
      });

      test('rejects a credential with no exp claim', async () => {
        global.fetch = jwksFetch();
        const response = await loginWith(
          loadApi(),
          await signedCredential({}, true)
        );
        expect(response.status).toBe(401);
        expect((await response.json()).code).toBe('GOOGLE_TOKEN_INVALID');
      });

      test('rejects a credential with a non-numeric exp claim', async () => {
        global.fetch = jwksFetch();
        const response = await loginWith(
          loadApi(),
          await signedCredential({ exp: 'never' })
        );
        expect(response.status).toBe(401);
        expect((await response.json()).code).toBe('GOOGLE_TOKEN_INVALID');
      });

      test('rejects an expired credential', async () => {
        global.fetch = jwksFetch();
        const response = await loginWith(
          loadApi(),
          await signedCredential({ exp: nowS() - 10 })
        );
        expect(response.status).toBe(401);
      });

      test('JWKS fetch carries an abort signal that fires after 3s', async () => {
        jest.useFakeTimers();
        let seenSignal;
        global.fetch = jest.fn(
          (url, init) =>
            new Promise((resolve, reject) => {
              seenSignal = init?.signal;
              seenSignal?.addEventListener('abort', () =>
                reject(new Error('aborted'))
              );
            })
        );
        const pending = loginWith(loadApi(), await signedCredential());
        await jest.advanceTimersByTimeAsync(2900);
        expect(seenSignal).toBeDefined();
        expect(seenSignal.aborted).toBe(false);
        await jest.advanceTimersByTimeAsync(200);
        expect(seenSignal.aborted).toBe(true);
        const response = await pending;
        expect(response.status).toBe(401);
      });

      describe('claim and signature validation', () => {
        const expect401 = async (credential, api = loadApi()) => {
          const response = await loginWith(api, credential);
          expect(response.status).toBe(401);
          expect((await response.json()).code).toBe('GOOGLE_TOKEN_INVALID');
        };

        test('rejects a wrong audience (string)', async () => {
          global.fetch = jwksFetch();
          await expect401(await signedCredential({ aud: 'other-client' }));
        });

        test('audience array must contain the client id', async () => {
          global.fetch = jwksFetch();
          const ok = await loginWith(
            loadApi(),
            await signedCredential({ aud: ['x', CLIENT_ID] })
          );
          expect(ok.status).toBe(200);
          await expect401(await signedCredential({ aud: ['x', 'y'] }));
        });

        test('rejects a wrong issuer and accepts the bare accounts.google.com form', async () => {
          global.fetch = jwksFetch();
          await expect401(await signedCredential({ iss: 'https://evil.test' }));
          const ok = await loginWith(
            loadApi(),
            await signedCredential({ iss: 'accounts.google.com' })
          );
          expect(ok.status).toBe(200);
        });

        test('rejects unverified email and missing or non-string sub', async () => {
          global.fetch = jwksFetch();
          await expect401(await signedCredential({ email_verified: false }));
          await expect401(await signedCredential({ email_verified: 'true' }));
          await expect401(await signedCredential({ sub: undefined }));
          await expect401(await signedCredential({ sub: 12345 }));
        });

        test('exp equal to now is already expired', async () => {
          global.fetch = jwksFetch();
          await expect401(await signedCredential({ exp: nowS() }));
        });

        test('rejects a payload that was altered after signing', async () => {
          global.fetch = jwksFetch();
          const [header, , signature] = (await signedCredential()).split('.');
          const forged = toB64Url(
            JSON.stringify({
              iss: 'https://accounts.google.com',
              aud: CLIENT_ID,
              email_verified: true,
              sub: 'attacker',
              exp: nowS() + 3600,
            })
          );
          await expect401(`${header}.${forged}.${signature}`);
        });

        test('rejects a credential signed by a different key', async () => {
          global.fetch = jwksFetch();
          const other = await crypto.subtle.generateKey(
            {
              name: 'RSASSA-PKCS1-v1_5',
              modulusLength: 2048,
              publicExponent: new Uint8Array([1, 0, 1]),
              hash: 'SHA-256',
            },
            true,
            ['sign', 'verify']
          );
          const header = toB64Url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
          const payload = toB64Url(
            JSON.stringify({
              iss: 'https://accounts.google.com',
              aud: CLIENT_ID,
              email_verified: true,
              sub: 's',
              exp: nowS() + 3600,
            })
          );
          const sig = await crypto.subtle.sign(
            { name: 'RSASSA-PKCS1-v1_5' },
            other.privateKey,
            new TextEncoder().encode(`${header}.${payload}`)
          );
          await expect401(
            `${header}.${payload}.${toB64Url(new Uint8Array(sig))}`
          );
        });

        test('rejects a non-RS256 alg, a missing kid and an unknown kid', async () => {
          global.fetch = jwksFetch();
          const valid = await signedCredential();
          const [, payload, signature] = valid.split('.');
          const withHeader = (header) =>
            `${toB64Url(JSON.stringify(header))}.${payload}.${signature}`;
          await expect401(withHeader({ alg: 'none', kid: 'k1' }));
          await expect401(withHeader({ alg: 'RS256' }));
          await expect401(withHeader({ alg: 'RS256', kid: 'unknown' }));
        });

        test('rejects structurally invalid credentials', async () => {
          global.fetch = jwksFetch();
          await expect401('short');
          await expect401(undefined);
          await expect401(`${'a'.repeat(60)}.${'b'.repeat(60)}`);
          await expect401(`${'a'.repeat(5000)}.${'b'.repeat(5000)}.cc`);
          await expect401(
            `${'!'.repeat(40)}.${'b'.repeat(40)}.${'c'.repeat(40)}`
          );
        });

        test('JWKS non-OK response and network failure both yield 401', async () => {
          global.fetch = jest.fn(async () => ({
            ok: false,
            status: 503,
            headers: new Headers(),
          }));
          await expect401(await signedCredential());
          global.fetch = jest.fn(async () => {
            throw new Error('network down');
          });
          await expect401(await signedCredential());
        });

        test('JWKS payload without keys yields 401', async () => {
          global.fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({}),
            headers: new Headers(),
          }));
          await expect401(await signedCredential());
        });

        test('JWKS are cached within one module instance and refetched after max-age', async () => {
          const fetchMock = jest.fn(async () => ({
            ok: true,
            json: async () => ({ keys: [{ ...publicJwk, kid: 'k1' }] }),
            headers: new Headers({ 'Cache-Control': 'public, max-age=10' }),
          }));
          global.fetch = fetchMock;
          const api = loadApi();
          expect((await loginWith(api, await signedCredential())).status).toBe(
            200
          );
          expect((await loginWith(api, await signedCredential())).status).toBe(
            200
          );
          expect(fetchMock).toHaveBeenCalledTimes(1);

          const realNow = Date.now();
          const spy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 11000);
          try {
            const credential = await signedCredential();
            expect((await loginWith(api, credential)).status).toBe(200);
            expect(fetchMock).toHaveBeenCalledTimes(2);
          } finally {
            spy.mockRestore();
          }
        });

        test('JWKS cache lifetime is capped at one hour', async () => {
          const fetchMock = jest.fn(async () => ({
            ok: true,
            json: async () => ({ keys: [{ ...publicJwk, kid: 'k1' }] }),
            headers: new Headers({ 'Cache-Control': 'max-age=999999' }),
          }));
          global.fetch = fetchMock;
          const api = loadApi();
          await loginWith(api, await signedCredential());
          const realNow = Date.now();
          const spy = jest
            .spyOn(Date, 'now')
            .mockReturnValue(realNow + 3601 * 1000);
          try {
            const credential = await signedCredential();
            await loginWith(api, credential);
            expect(fetchMock).toHaveBeenCalledTimes(2);
          } finally {
            spy.mockRestore();
          }
        });

        test('first login creates the user and sets session cookie while clearing the OAuth CSRF cookie', async () => {
          global.fetch = jwksFetch();
          const inserted = [];
          const db = makeDb([
            ['SELECT id FROM users', () => null],
            [
              'INSERT INTO users',
              (sql, args) => {
                inserted.push(args);
                return { meta: { changes: 1 } };
              },
            ],
            ['INSERT INTO sessions', () => ({ meta: { changes: 1 } })],
          ]);
          const response = await loadApi().handleApiRequest(
            req('/api/auth/google', {
              method: 'POST',
              headers: {
                Origin: ORIGIN,
                Cookie: '__Host-ue_oauth_csrf=c1',
                'CF-Connecting-IP': `b9-new-${++ipCounter}`,
              },
              body: JSON.stringify({
                credential: await signedCredential({ name: 'N'.repeat(300) }),
                csrfToken: 'c1',
              }),
            }),
            { DB: db, GOOGLE_CLIENT_ID: CLIENT_ID }
          );
          expect(response.status).toBe(200);
          const body = await response.json();
          expect(body.user.email).toBe('a@example.com');
          expect(body.csrfToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
          expect(inserted).toHaveLength(1);
          expect(inserted[0][1]).toBe('google-sub-1');
          expect(inserted[0][3]).toHaveLength(200);
          const cookies = response.headers.get('Set-Cookie');
          expect(cookies).toContain('__Host-ue_session=');
          expect(cookies).toContain('HttpOnly');
          expect(cookies).toContain('__Host-ue_oauth_csrf=; Max-Age=0');
        });

        test('returning user is updated rather than inserted', async () => {
          global.fetch = jwksFetch();
          const sqls = [];
          const db = makeDb([
            ['SELECT id FROM users', () => ({ id: 'user-1' })],
            ['', (sql) => (sqls.push(sql), { meta: { changes: 1 } })],
          ]);
          const response = await loadApi().handleApiRequest(
            req('/api/auth/google', {
              method: 'POST',
              headers: {
                Origin: ORIGIN,
                Cookie: '__Host-ue_oauth_csrf=c1',
                'CF-Connecting-IP': `b9-ret-${++ipCounter}`,
              },
              body: JSON.stringify({
                credential: await signedCredential(),
                csrfToken: 'c1',
              }),
            }),
            { DB: db, GOOGLE_CLIENT_ID: CLIENT_ID }
          );
          expect(response.status).toBe(200);
          expect(sqls.some((s) => s.startsWith('UPDATE users'))).toBe(true);
          expect(sqls.some((s) => s.startsWith('INSERT INTO users'))).toBe(
            false
          );
        });
      });
    });

    describe('routing and public endpoints', () => {
      const get = (path, env = {}, base = ORIGIN) =>
        handleApiRequest({ ...req(path), url: `${base}${path}` }, env);

      test('OPTIONS returns 204 with no body', async () => {
        const response = await handleApiRequest(
          req('/api/sync', { method: 'OPTIONS' }),
          {}
        );
        expect(response.status).toBe(204);
      });

      test('unknown routes and wrong methods return 404 NOT_FOUND', async () => {
        const unknown = await get('/api/nope');
        expect(unknown.status).toBe(404);
        expect((await unknown.json()).code).toBe('NOT_FOUND');
        const wrongMethod = await handleApiRequest(
          req('/api/config', { method: 'POST', headers: { Origin: ORIGIN } }),
          {}
        );
        expect(wrongMethod.status).toBe(404);
      });

      test('a trailing slash is tolerated', async () => {
        const response = await get('/api/config/', { GOOGLE_CLIENT_ID: 'cid' });
        expect(response.status).toBe(200);
        expect((await response.json()).googleClientId).toBe('cid');
      });

      test('responses are never cacheable', async () => {
        const response = await get('/api/config');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Content-Type')).toContain(
          'application/json'
        );
      });

      test('config: empty id when unset, allowed on localhost, preview opt-in', async () => {
        expect((await (await get('/api/config')).json()).googleClientId).toBe(
          ''
        );
        expect(
          (
            await (
              await get(
                '/api/config',
                { GOOGLE_CLIENT_ID: 'cid' },
                'http://localhost:8788'
              )
            ).json()
          ).googleClientId
        ).toBe('cid');
        expect(
          (
            await (
              await get(
                '/api/config',
                { GOOGLE_CLIENT_ID: 'cid' },
                'https://x.pages.dev'
              )
            ).json()
          ).googleClientId
        ).toBe('');
        expect(
          (
            await (
              await get(
                '/api/config',
                { GOOGLE_CLIENT_ID: 'cid', ALLOW_PREVIEW_OAUTH: 'true' },
                'https://x.pages.dev'
              )
            ).json()
          ).googleClientId
        ).toBe('cid');
      });

      test('auth/csrf issues a random token mirrored in an HttpOnly cookie', async () => {
        const a = await get('/api/auth/csrf');
        const b = await get('/api/auth/csrf');
        const tokenA = (await a.json()).csrfToken;
        expect(tokenA).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(tokenA).not.toBe((await b.json()).csrfToken);
        const cookie = a.headers.get('Set-Cookie');
        expect(cookie).toContain(`__Host-ue_oauth_csrf=${tokenA}`);
        expect(cookie).toMatch(/Max-Age=600.*Secure.*HttpOnly.*SameSite=Lax/);
      });

      test('an unexpected exception becomes a generic 500', async () => {
        const db = {
          prepare: () => {
            throw new Error('SECRET internal detail');
          },
        };
        const response = await handleApiRequest(
          req('/api/session', {
            headers: { Cookie: '__Host-ue_session=tok' },
          }),
          { DB: db }
        );
        const body = await response.json();
        expect(response.status).toBe(500);
        expect(body.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(body)).not.toContain('SECRET');
      });
    });

    describe('POST /api/auth/google gatekeeping', () => {
      let ip = 0;
      const login = (
        { headers = {}, body, base = ORIGIN, bodyObject } = {},
        env = {}
      ) =>
        handleApiRequest(
          {
            ...req('/api/auth/google', {
              method: 'POST',
              headers: {
                Origin: base,
                'CF-Connecting-IP': `gate-${++ip}`,
                ...headers,
              },
              body: body ?? JSON.stringify(bodyObject ?? {}),
            }),
            url: `${base}/api/auth/google`,
          },
          env
        );

      test('rejects OAuth on a non-allowed host', async () => {
        const response = await login({ base: 'https://x.pages.dev' });
        expect(response.status).toBe(403);
        expect((await response.json()).code).toBe('OAUTH_DISABLED');
      });

      test('rejects a body with unknown keys or a non-string csrfToken', async () => {
        for (const bodyObject of [
          { credential: 'c', csrfToken: 'x', extra: 1 },
          { credential: 'c', csrfToken: 5 },
          { credential: 'c' },
          [],
        ]) {
          const response = await login({ bodyObject });
          expect(response.status).toBe(422);
          expect((await response.json()).code).toBe('INVALID_BODY');
        }
      });

      test('rejects malformed JSON with INVALID_JSON', async () => {
        const response = await login({ body: '{nope' });
        expect(response.status).toBe(422);
        expect((await response.json()).code).toBe('INVALID_JSON');
      });

      test('rejects a missing or mismatching OAuth CSRF cookie with 403', async () => {
        const bodyObject = { credential: 'c', csrfToken: 'token-a' };
        const missing = await login({ bodyObject });
        expect(missing.status).toBe(403);
        expect((await missing.json()).code).toBe('CSRF_INVALID');
        const mismatch = await login({
          bodyObject,
          headers: { Cookie: '__Host-ue_oauth_csrf=token-b' },
        });
        expect(mismatch.status).toBe(403);
        expect((await mismatch.json()).code).toBe('CSRF_INVALID');
      });

      test('a matching CSRF cookie proceeds to credential verification (401 for garbage)', async () => {
        const response = await login({
          bodyObject: { credential: 'garbage', csrfToken: 'same' },
          headers: { Cookie: '__Host-ue_oauth_csrf=same' },
        });
        expect(response.status).toBe(401);
        expect((await response.json()).code).toBe('GOOGLE_TOKEN_INVALID');
      });

      test('CSRF cookie is URL-decoded before comparison', async () => {
        const response = await login({
          bodyObject: { credential: 'garbage', csrfToken: 'a b' },
          headers: { Cookie: '__Host-ue_oauth_csrf=a%20b' },
        });
        expect(response.status).toBe(401);
      });

      test('an undecodable cookie value is compared raw and fails', async () => {
        const response = await login({
          bodyObject: { credential: 'c', csrfToken: 'x' },
          headers: { Cookie: '__Host-ue_oauth_csrf=%E0%A4%A' },
        });
        expect(response.status).toBe(403);
      });

      describe('rate limiting (10 attempts per 15 minutes per address)', () => {
        afterEach(() => jest.useRealTimers());

        test('blocks the 11th attempt and recovers after the window expires', async () => {
          jest.useFakeTimers({ now: Date.now() });
          const attempt = () =>
            login({
              headers: { 'CF-Connecting-IP': 'rl-window' },
              bodyObject: {},
            });
          for (let i = 0; i < 10; i += 1) {
            expect((await attempt()).status).toBe(422);
          }
          const blocked = await attempt();
          expect(blocked.status).toBe(429);
          expect((await blocked.json()).code).toBe('RATE_LIMITED');

          jest.setSystemTime(Date.now() + 15 * 60 * 1000 - 1);
          expect((await attempt()).status).toBe(429);

          jest.setSystemTime(Date.now() + 2);
          expect((await attempt()).status).toBe(422);
        });

        test('buckets are per address, falling back to X-Forwarded-For then "unknown"', async () => {
          const exhaust = async (headers) => {
            for (let i = 0; i < 10; i += 1) {
              await login({ headers, bodyObject: {} });
            }
            return login({ headers, bodyObject: {} });
          };
          expect((await exhaust({ 'CF-Connecting-IP': 'rl-a' })).status).toBe(
            429
          );
          expect(
            (
              await login({
                headers: { 'CF-Connecting-IP': 'rl-b' },
                bodyObject: {},
              })
            ).status
          ).toBe(422);
          expect(
            (
              await exhaust({
                'CF-Connecting-IP': '',
                'X-Forwarded-For': 'rl-xff',
              })
            ).status
          ).toBe(429);
        });
      });
    });

    describe('GET /api/session', () => {
      const getSessionReq = (cookie = '__Host-ue_session=tok') =>
        req('/api/session', { headers: cookie ? { Cookie: cookie } : {} });

      test('401 UNAUTHORIZED without a cookie, without touching the DB', async () => {
        const response = await handleApiRequest(getSessionReq(''), {
          DB: makeDb([]),
        });
        expect(response.status).toBe(401);
        expect((await response.json()).code).toBe('UNAUTHORIZED');
      });

      test('401 when the token is unknown', async () => {
        const db = makeDb([['SELECT s.*', () => null]]);
        const response = await handleApiRequest(getSessionReq(), { DB: db });
        expect(response.status).toBe(401);
      });

      test('401 when the session has expired (expires_at in the past or now)', async () => {
        for (const offset of [-10, 0]) {
          const row = await sessionRow('tok', {
            expires_at: nowS() + offset,
            last_rotated_at: nowS(),
          });
          const db = makeDb([['SELECT s.*', () => row]]);
          const response = await handleApiRequest(getSessionReq(), { DB: db });
          expect(response.status).toBe(401);
        }
      });

      test('looks sessions up by SHA-256 of the cookie value, never the raw token', async () => {
        const seen = [];
        const db = makeDb([
          [
            'SELECT s.*',
            (sql, args) => {
              seen.push(args);
              return null;
            },
          ],
        ]);
        await handleApiRequest(getSessionReq('__Host-ue_session=tok%2B1'), {
          DB: db,
        });
        expect(seen).toEqual([[await sha('tok+1')]]);
      });

      test('returns the user and a fresh CSRF token whose hash is stored', async () => {
        const row = await sessionRow('tok', { last_rotated_at: nowS() });
        const updates = [];
        const db = makeDb([
          ['SELECT s.*', () => row],
          [
            'UPDATE sessions SET csrf_hash',
            (sql, args) => {
              updates.push(args);
              return { meta: { changes: 1 } };
            },
          ],
        ]);
        const response = await handleApiRequest(getSessionReq(), { DB: db });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.user).toEqual({
          id: row.account_id,
          email: 'a@example.com',
          name: 'A',
        });
        expect(body.accountId).toBe(row.account_id);
        expect(updates).toEqual([[await sha(body.csrfToken), row.token_hash]]);
        expect(response.headers.get('Set-Cookie')).toBeNull();
      });

      test('rotation re-keys the session row and issues a bounded cookie', async () => {
        const row = await sessionRow('tok');
        const rotations = [];
        const csrfUpdates = [];
        const db = makeDb([
          ['SELECT s.*', () => row],
          [
            'UPDATE sessions SET token_hash',
            (sql, args) => {
              rotations.push(args);
              return { meta: { changes: 1 } };
            },
          ],
          [
            'UPDATE sessions SET csrf_hash',
            (sql, args) => {
              csrfUpdates.push(args);
              return { meta: { changes: 1 } };
            },
          ],
        ]);
        const response = await handleApiRequest(getSessionReq(), { DB: db });
        const cookie = response.headers.get('Set-Cookie');
        expect(rotations).toHaveLength(1);
        expect(rotations[0][2]).toBe(await sha('tok'));
        const newToken = decodeURIComponent(
          /__Host-ue_session=([^;]+)/.exec(cookie)[1]
        );
        expect(await sha(newToken)).toBe(rotations[0][0]);
        // The CSRF hash is attached to the rotated token hash.
        expect(csrfUpdates[0][1]).toBe(rotations[0][0]);
        const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)[1]);
        expect(maxAge).toBeGreaterThan(86400 - 5);
        expect(maxAge).toBeLessThanOrEqual(86400);
      });

      test('no rotation while last_rotated_at is under 7 days old', async () => {
        const row = await sessionRow('tok', {
          last_rotated_at: nowS() - 6 * 86400,
        });
        const db = makeDb([
          ['SELECT s.*', () => row],
          ['UPDATE sessions SET csrf_hash', () => ({ meta: { changes: 1 } })],
        ]);
        const response = await handleApiRequest(getSessionReq(), { DB: db });
        expect(response.status).toBe(200);
        expect(response.headers.get('Set-Cookie')).toBeNull();
      });
    });

    describe('authenticated sync/account routes', () => {
      const authed = (path, { method = 'GET', headers = {}, body } = {}) =>
        req(path, {
          method,
          headers: {
            Origin: ORIGIN,
            Cookie: '__Host-ue_session=tok',
            'X-CSRF-Token': 'csrf-token',
            ...headers,
          },
          body,
        });
      const freshRow = (extra = {}) =>
        sessionRow('tok', { last_rotated_at: nowS(), ...extra });
      const call = (request, handlers) =>
        handleApiRequest(request, { DB: makeDb(handlers) });

      describe('every protected route requires a session', () => {
        const noCookie = [
          ['GET', '/api/sync'],
          ['PUT', '/api/sync'],
          ['GET', '/api/sync/revisions'],
          ['GET', '/api/sync/revisions/1'],
          ['POST', '/api/logout'],
          ['DELETE', '/api/account'],
        ];
        test.each(noCookie)('%s %s -> 401', async (method, path) => {
          const promise = handleApiRequest(
            req(path, { method, headers: { Origin: ORIGIN } }),
            { DB: makeDb([]) }
          );
          await expect(promise).resolves.toBeInstanceOf(Response);
          const response = await promise;
          expect(response.status).toBe(401);
          expect((await response.json()).code).toBe('UNAUTHORIZED');
        });
      });

      describe('errors inside awaited route handlers resolve to JSON Responses (B23)', () => {
        const dbError = () => {
          throw new Error('D1 exploded');
        };
        const cases = [
          [
            'GET /api/sync',
            () => authed('/api/sync'),
            [['SELECT * FROM sync_documents', dbError]],
          ],
          [
            'GET /api/sync/revisions',
            () => authed('/api/sync/revisions'),
            [['FROM sync_revisions', dbError]],
          ],
          [
            'GET /api/sync/revisions/1',
            () => authed('/api/sync/revisions/1'),
            [['FROM sync_revisions', dbError]],
          ],
          [
            'POST /api/logout',
            () => authed('/api/logout', { method: 'POST' }),
            [['DELETE FROM sessions', dbError]],
          ],
          [
            'DELETE /api/account',
            () =>
              authed('/api/account', {
                method: 'DELETE',
                body: JSON.stringify({ confirmation: 'DELETE' }),
              }),
            [['DELETE FROM sync_revisions', dbError]],
          ],
          [
            'PUT /api/sync',
            () =>
              authed('/api/sync', {
                method: 'PUT',
                headers: { 'If-Match': '"rev-0"' },
                body: JSON.stringify(envelope(1)),
              }),
            [['SELECT * FROM sync_documents', dbError]],
          ],
        ];
        test.each(cases)(
          '%s with a DB error resolves to 500 INTERNAL_ERROR',
          async (name, makeRequest, extra) => {
            const row = await freshRow();
            const promise = call(makeRequest(), [
              ['SELECT s.*', () => row],
              ...extra,
            ]);
            await expect(promise).resolves.toBeInstanceOf(Response);
            const response = await promise;
            expect(response.status).toBe(500);
            expect((await response.json()).code).toBe('INTERNAL_ERROR');
          }
        );
      });

      describe('origin and CSRF checks on mutations', () => {
        const mutations = [
          ['PUT', '/api/sync'],
          ['POST', '/api/logout'],
          ['DELETE', '/api/account'],
        ];
        test.each(mutations)(
          '%s %s without Origin -> 403 ORIGIN_INVALID',
          async (method, path) => {
            const response = await handleApiRequest(
              req(path, {
                method,
                headers: {
                  Cookie: '__Host-ue_session=tok',
                  'X-CSRF-Token': 'csrf-token',
                },
              }),
              { DB: makeDb([]) }
            );
            expect(response.status).toBe(403);
            expect((await response.json()).code).toBe('ORIGIN_INVALID');
          }
        );

        test.each(mutations)(
          '%s %s with a foreign Origin -> 403',
          async (method, path) => {
            const response = await handleApiRequest(
              authed(path, {
                method,
                headers: { Origin: 'https://evil.test' },
              }),
              { DB: makeDb([]) }
            );
            expect(response.status).toBe(403);
          }
        );

        test.each(mutations)(
          '%s %s without X-CSRF-Token -> 403 CSRF_INVALID',
          async (method, path) => {
            const row = await freshRow();
            const request = authed(path, { method });
            request.headers = new Headers({
              Origin: ORIGIN,
              Cookie: '__Host-ue_session=tok',
            });
            const response = await call(request, [['SELECT s.*', () => row]]);
            expect(response.status).toBe(403);
            expect((await response.json()).code).toBe('CSRF_INVALID');
          }
        );

        test.each(mutations)(
          '%s %s with a wrong X-CSRF-Token -> 403 CSRF_INVALID',
          async (method, path) => {
            const row = await freshRow();
            const response = await call(
              authed(path, { method, headers: { 'X-CSRF-Token': 'forged' } }),
              [['SELECT s.*', () => row]]
            );
            expect(response.status).toBe(403);
            expect((await response.json()).code).toBe('CSRF_INVALID');
          }
        );
      });

      describe('GET /api/sync', () => {
        test('returns a null document with revision 0 when none is stored', async () => {
          const row = await freshRow();
          const response = await call(authed('/api/sync'), [
            ['SELECT s.*', () => row],
            ['SELECT * FROM sync_documents', () => null],
          ]);
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({
            document: null,
            revision: 0,
          });
          expect(response.headers.get('ETag')).toBe('"rev-0"');
        });

        test('maps the stored row to the camelCase envelope and ETag', async () => {
          const row = await freshRow();
          const stored = {
            user_id: row.account_id,
            revision: '4',
            payload_schema_version: 1,
            key_version: '2',
            kdf_salt: 'salt',
            iv: 'iv',
            ciphertext: 'ct',
          };
          const queries = [];
          const response = await call(authed('/api/sync'), [
            ['SELECT s.*', () => row],
            [
              'SELECT * FROM sync_documents',
              (sql, args) => (queries.push(args), stored),
            ],
          ]);
          const body = await response.json();
          expect(body).toEqual({
            document: {
              revision: 4,
              payloadSchemaVersion: 1,
              keyVersion: 2,
              kdfSalt: 'salt',
              iv: 'iv',
              ciphertext: 'ct',
            },
            revision: 4,
          });
          expect(response.headers.get('ETag')).toBe('"rev-4"');
          expect(queries).toEqual([[row.account_id]]);
        });

        test('forwards a rotated session cookie', async () => {
          const row = await sessionRow('tok');
          const response = await call(authed('/api/sync'), [
            ['SELECT s.*', () => row],
            [
              'UPDATE sessions SET token_hash',
              () => ({ meta: { changes: 1 } }),
            ],
            ['SELECT * FROM sync_documents', () => null],
          ]);
          expect(response.headers.get('Set-Cookie')).toContain(
            '__Host-ue_session='
          );
        });
      });

      describe('PUT /api/sync validation and revision handling', () => {
        const put = async (
          { body, headers = {}, row } = {},
          handlers = [],
          rawBody
        ) => {
          const session = row || (await freshRow());
          return call(
            authed('/api/sync', {
              method: 'PUT',
              headers,
              body: rawBody ?? JSON.stringify(body),
            }),
            [['SELECT s.*', () => session], ...handlers]
          );
        };

        test.each([
          ['unknown field', { ...envelope(1), extra: true }],
          ['revision 0', envelope(0)],
          ['fractional revision', envelope(1.5)],
          ['string revision', { ...envelope(1), revision: '1' }],
          ['wrong schema version', { ...envelope(1), payloadSchemaVersion: 2 }],
          ['key version 0', { ...envelope(1), keyVersion: 0 }],
          [
            'short salt',
            { ...envelope(1), kdfSalt: base64Url(new Uint8Array(8)) },
          ],
          ['non-base64url salt', { ...envelope(1), kdfSalt: 'not+valid/==' }],
          ['short iv', { ...envelope(1), iv: base64Url(new Uint8Array(8)) }],
          ['non-string iv', { ...envelope(1), iv: 5 }],
          [
            'ciphertext under 16 bytes',
            { ...envelope(1), ciphertext: base64Url(new Uint8Array(15)) },
          ],
          ['empty ciphertext', { ...envelope(1), ciphertext: '' }],
          [
            'missing field',
            Object.fromEntries(
              Object.entries(envelope(1)).filter(([key]) => key !== 'iv')
            ),
          ],
          ['array body', []],
          ['null body', null],
        ])('rejects an invalid envelope: %s', async (_label, body) => {
          const response = await put({
            body,
            headers: { 'If-Match': '"rev-0"' },
          });
          expect(response.status).toBe(422);
          expect((await response.json()).code).toBe('INVALID_ENVELOPE');
        });

        test('an empty body is an invalid envelope', async () => {
          const response = await put(
            { headers: { 'If-Match': '"rev-0"' } },
            [],
            ''
          );
          expect(response.status).toBe(422);
          expect((await response.json()).code).toBe('INVALID_ENVELOPE');
        });

        test('malformed JSON is INVALID_JSON', async () => {
          const response = await put(
            { headers: { 'If-Match': '"rev-0"' } },
            [],
            '{bad'
          );
          expect(response.status).toBe(422);
          expect((await response.json()).code).toBe('INVALID_JSON');
        });

        test('Content-Length over 1 MiB is rejected before reading the body', async () => {
          const response = await put(
            {
              body: envelope(1),
              headers: { 'If-Match': '"rev-0"', 'Content-Length': '1048577' },
            },
            []
          );
          expect(response.status).toBe(413);
          expect((await response.json()).code).toBe('PAYLOAD_TOO_LARGE');
        });

        test('a body over 1 MiB is rejected even when Content-Length lies', async () => {
          const response = await put(
            { headers: { 'If-Match': '"rev-0"' } },
            [],
            ' '.repeat(1024 * 1024 + 1)
          );
          expect(response.status).toBe(413);
        });

        test.each([
          ['missing', undefined],
          ['unquoted', 'rev-1'],
          ['wildcard', '*'],
          ['non-numeric', '"rev-x"'],
          ['weak validator', 'W/"rev-0"'],
        ])('If-Match %s -> 422 IF_MATCH_REQUIRED', async (_label, value) => {
          const response = await put({
            body: envelope(1),
            headers: value === undefined ? {} : { 'If-Match': value },
          });
          expect(response.status).toBe(422);
          expect((await response.json()).code).toBe('IF_MATCH_REQUIRED');
        });

        test('If-Match that differs from the stored revision -> 409 SYNC_CONFLICT', async () => {
          const response = await put(
            { body: envelope(6), headers: { 'If-Match': '"rev-4"' } },
            [['SELECT * FROM sync_documents', () => ({ revision: 5 })]]
          );
          expect(response.status).toBe(409);
          expect((await response.json()).code).toBe('SYNC_CONFLICT');
        });

        test.each([
          ['skips a revision', 7],
          ['repeats the current revision', 5],
          ['goes backwards', 3],
        ])(
          'body revision that %s -> 409 even with a matching If-Match',
          async (_l, revision) => {
            const response = await put(
              { body: envelope(revision), headers: { 'If-Match': '"rev-5"' } },
              [['SELECT * FROM sync_documents', () => ({ revision: 5 })]]
            );
            expect(response.status).toBe(409);
            expect((await response.json()).code).toBe('SYNC_CONFLICT');
          }
        );

        test('first write (no stored document) inserts revision 1 and returns ETag "rev-1"', async () => {
          const inserted = [];
          const row = await freshRow();
          const response = await put(
            { body: envelope(1), headers: { 'If-Match': '"rev-0"' }, row },
            [
              ['SELECT * FROM sync_documents', () => null],
              [
                'INSERT INTO sync_documents',
                (sql, args) => (inserted.push(args), { meta: { changes: 1 } }),
              ],
              ['DELETE FROM sync_revisions', () => ({ meta: { changes: 0 } })],
            ]
          );
          expect(response.status).toBe(200);
          expect(response.headers.get('ETag')).toBe('"rev-1"');
          expect((await response.json()).revision).toBe(1);
          expect(inserted).toHaveLength(1);
          expect(inserted[0][0]).toBe(row.account_id);
          expect(inserted[0][1]).toBe(1);
        });

        test('a first write must start at revision 1 against If-Match rev-0', async () => {
          const response = await put(
            { body: envelope(2), headers: { 'If-Match': '"rev-0"' } },
            [['SELECT * FROM sync_documents', () => null]]
          );
          expect(response.status).toBe(409);
        });

        test('insert failure (concurrent first write) -> 409', async () => {
          const response = await put(
            { body: envelope(1), headers: { 'If-Match': '"rev-0"' } },
            [
              ['SELECT * FROM sync_documents', () => null],
              [
                'INSERT INTO sync_documents',
                () => {
                  throw new Error('UNIQUE constraint failed');
                },
              ],
            ]
          );
          expect(response.status).toBe(409);
          expect((await response.json()).code).toBe('SYNC_CONFLICT');
        });

        test('update archives the previous revision, bumps the document and prunes history', async () => {
          const order = [];
          const row = await freshRow();
          const response = await put(
            { body: envelope(6), headers: { 'If-Match': '"rev-5"' }, row },
            [
              ['SELECT * FROM sync_documents', () => ({ revision: 5 })],
              [
                'INSERT INTO sync_revisions',
                (sql, args) => (
                  order.push(['archive', args]),
                  { meta: { changes: 1 } }
                ),
              ],
              [
                'UPDATE sync_documents',
                (sql, args) => (
                  order.push(['update', args]),
                  { meta: { changes: 1 } }
                ),
              ],
              [
                'DELETE FROM sync_revisions',
                (sql, args) => (
                  order.push(['cleanup', args]),
                  { meta: { changes: 0 } }
                ),
              ],
            ]
          );
          expect(response.status).toBe(200);
          expect(response.headers.get('ETag')).toBe('"rev-6"');
          const body = await response.json();
          expect(body.revision).toBe(6);
          expect(body.document).toEqual(envelope(6));
          expect(order.map(([name]) => name)).toEqual([
            'archive',
            'update',
            'cleanup',
          ]);
          expect(order[0][1]).toEqual([row.account_id, 5]);
          // optimistic lock: UPDATE is conditional on the previous revision
          expect(order[1][1].slice(-2)).toEqual([row.account_id, 5]);
          expect(order[2][1][0]).toBe(row.account_id);
          expect(order[2][1][1]).toBeLessThan(nowS() - 29 * 86400);
        });

        test('sync writes are limited to 120 per hour per account and recover after the window', async () => {
          jest.useFakeTimers({ now: Date.now() });
          try {
            const row = await freshRow({ account_id: 'acct-sync-rl' });
            const attempt = () =>
              put({ headers: { 'If-Match': '"rev-0"' }, row }, [], '');
            for (let i = 0; i < 120; i += 1) {
              expect((await attempt()).status).toBe(422);
            }
            const blocked = await attempt();
            expect(blocked.status).toBe(429);
            expect((await blocked.json()).code).toBe('RATE_LIMITED');
            jest.setSystemTime(Date.now() + 60 * 60 * 1000 + 1);
            // keep the fixture session valid at the advanced time
            row.last_rotated_at = nowS();
            row.expires_at = nowS() + 86400;
            expect((await attempt()).status).toBe(422);
          } finally {
            jest.useRealTimers();
          }
        });
      });

      describe('GET /api/sync/revisions', () => {
        test('lists up to 20 revisions for the account', async () => {
          const row = await freshRow();
          const rows = [{ revision: 3 }, { revision: 2 }];
          const args = [];
          const response = await call(authed('/api/sync/revisions'), [
            ['SELECT s.*', () => row],
            [
              'FROM sync_revisions WHERE user_id = ? ORDER BY',
              (sql, a) => (args.push(a), { results: rows }),
            ],
          ]);
          expect(response.status).toBe(200);
          expect((await response.json()).revisions).toEqual(rows);
          expect(args).toEqual([[row.account_id, 20]]);
        });

        test('returns [] when D1 returns no results array', async () => {
          const row = await freshRow();
          const response = await call(authed('/api/sync/revisions'), [
            ['SELECT s.*', () => row],
            ['FROM sync_revisions', () => ({})],
          ]);
          expect((await response.json()).revisions).toEqual([]);
        });

        test.each(['abc', '0', '-1', '1.5'])(
          'rejects revision %p -> 422 INVALID_REVISION',
          async (value) => {
            const row = await freshRow();
            const response = await call(
              authed(`/api/sync/revisions/${value}`),
              [['SELECT s.*', () => row]]
            );
            expect(response.status).toBe(422);
            expect((await response.json()).code).toBe('INVALID_REVISION');
          }
        );

        test('unknown revision -> 404 REVISION_NOT_FOUND', async () => {
          const row = await freshRow();
          const response = await call(authed('/api/sync/revisions/9'), [
            ['SELECT s.*', () => row],
            ['SELECT * FROM sync_revisions', () => null],
          ]);
          expect(response.status).toBe(404);
          expect((await response.json()).code).toBe('REVISION_NOT_FOUND');
        });

        test('known revision returns the envelope scoped to the account', async () => {
          const row = await freshRow();
          const args = [];
          const response = await call(authed('/api/sync/revisions/2'), [
            ['SELECT s.*', () => row],
            [
              'SELECT * FROM sync_revisions',
              (sql, a) => (
                args.push(a),
                {
                  revision: 2,
                  payload_schema_version: 1,
                  key_version: 1,
                  kdf_salt: 's',
                  iv: 'i',
                  ciphertext: 'c',
                }
              ),
            ],
          ]);
          expect(await response.json()).toEqual({
            envelope: {
              revision: 2,
              payloadSchemaVersion: 1,
              keyVersion: 1,
              kdfSalt: 's',
              iv: 'i',
              ciphertext: 'c',
            },
          });
          expect(args).toEqual([[row.account_id, 2]]);
        });
      });

      describe('POST /api/logout', () => {
        test('deletes only the current session, clears the cookie and does not rotate', async () => {
          // last_rotated_at is old: a rotation would hit an unregistered UPDATE and 500.
          const row = await sessionRow('tok');
          const deleted = [];
          const response = await call(
            authed('/api/logout', { method: 'POST', body: '{}' }),
            [
              ['SELECT s.*', () => row],
              [
                'DELETE FROM sessions WHERE token_hash',
                (sql, args) => (deleted.push(args), { meta: { changes: 1 } }),
              ],
            ]
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ ok: true });
          expect(deleted).toEqual([[row.token_hash]]);
          expect(response.headers.get('Set-Cookie')).toBe(
            '__Host-ue_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax'
          );
        });
      });

      describe('DELETE /api/account', () => {
        const del = async ({ body, row, headers } = {}, handlers = []) => {
          const session = row || (await freshRow());
          return call(
            authed('/api/account', {
              method: 'DELETE',
              body: typeof body === 'string' ? body : JSON.stringify(body),
              headers,
            }),
            [['SELECT s.*', () => session], ...handlers]
          );
        };

        test('requires a recent sign-in (older than 10 minutes -> 403)', async () => {
          const stale = await freshRow({
            last_authenticated_at: nowS() - 11 * 60,
          });
          const response = await del(
            { body: { confirmation: 'DELETE' }, row: stale },
            []
          );
          expect(response.status).toBe(403);
          expect((await response.json()).code).toBe('RECENT_AUTH_REQUIRED');
        });

        test('a sign-in 9 minutes ago is still recent', async () => {
          const recent = await freshRow({
            last_authenticated_at: nowS() - 9 * 60,
          });
          const response = await del(
            { body: { confirmation: 'nope' }, row: recent },
            []
          );
          expect(response.status).toBe(422);
        });

        test.each([
          ['lowercase text', { confirmation: 'delete' }],
          ['wrong text', { confirmation: 'DELETE ' }],
          ['missing confirmation', {}],
          ['non-string confirmation', { confirmation: true }],
          ['extra field', { confirmation: 'DELETE', force: true }],
          ['array body', []],
        ])('rejects %s -> 422 CONFIRMATION_REQUIRED', async (_l, body) => {
          const deletes = [];
          const response = await del({ body }, [
            ['DELETE FROM', (sql) => deletes.push(sql)],
          ]);
          expect(response.status).toBe(422);
          expect((await response.json()).code).toBe('CONFIRMATION_REQUIRED');
          expect(deletes).toHaveLength(0);
        });

        test('an empty body is CONFIRMATION_REQUIRED', async () => {
          const response = await del({ body: '' }, []);
          expect(response.status).toBe(422);
          expect((await response.json()).code).toBe('CONFIRMATION_REQUIRED');
        });

        test('malformed JSON -> 422 INVALID_BODY', async () => {
          const response = await del({ body: '{bad' }, []);
          expect(response.status).toBe(422);
          expect((await response.json()).code).toBe('INVALID_BODY');
        });

        test('confirmed deletion removes revisions, document, sessions and user in order', async () => {
          const statements = [];
          const row = await freshRow();
          const record = (sql, args) => (
            statements.push([sql, args]),
            { meta: { changes: 1 } }
          );
          const response = await del(
            { body: { confirmation: 'DELETE' }, row },
            [
              ['DELETE FROM sync_revisions', record],
              ['DELETE FROM sync_documents', record],
              ['DELETE FROM sessions', record],
              ['DELETE FROM users', record],
            ]
          );
          expect(response.status).toBe(200);
          expect(await response.json()).toEqual({ ok: true });
          expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
          expect(statements.map(([sql]) => sql.split(' WHERE')[0])).toEqual([
            'DELETE FROM sync_revisions',
            'DELETE FROM sync_documents',
            'DELETE FROM sessions',
            'DELETE FROM users',
          ]);
          statements.forEach(([, args]) => {
            expect(args).toEqual([row.account_id]);
          });
        });
      });

      describe('POST /api/probe input validation', () => {
        const probe = async (body, rawBody) => {
          const row = await freshRow({
            account_id: `acct-probe-${Math.random()}`,
          });
          return call(
            authed('/api/probe', {
              method: 'POST',
              body: rawBody ?? JSON.stringify(body),
            }),
            [['SELECT s.*', () => row]]
          );
        };

        test.each([
          ['extra field', { url: 'https://example.com', x: 1 }],
          ['non-string url', { url: 5 }],
          ['missing url', {}],
          ['non-string keyword', { url: 'https://example.com', keyword: 5 }],
          [
            'keyword over 200 chars',
            { url: 'https://example.com', keyword: 'k'.repeat(201) },
          ],
        ])('rejects %s -> 422 INVALID_BODY', async (_l, body) => {
          const response = await probe(body);
          expect(response.status).toBe(422);
          expect((await response.json()).code).toBe('INVALID_BODY');
        });

        test('malformed JSON -> 422 INVALID_JSON', async () => {
          const response = await probe(undefined, '{bad');
          expect(response.status).toBe(422);
          expect((await response.json()).code).toBe('INVALID_JSON');
        });

        test('a private-address URL is reported as URL_BLOCKED without any network call', async () => {
          const realFetch = global.fetch;
          global.fetch = jest.fn();
          try {
            const response = await probe({ url: 'http://127.0.0.1/' });
            expect(response.status).toBe(422);
            expect((await response.json()).code).toBe('URL_BLOCKED');
            expect(global.fetch).not.toHaveBeenCalled();
          } finally {
            global.fetch = realFetch;
          }
        });

        test('probe is limited to 120 requests per minute per account', async () => {
          jest.useFakeTimers({ now: Date.now() });
          try {
            const row = await freshRow({ account_id: 'acct-probe-rl' });
            const attempt = () =>
              call(
                authed('/api/probe', {
                  method: 'POST',
                  body: JSON.stringify({ url: 5 }),
                }),
                [['SELECT s.*', () => row]]
              );
            for (let i = 0; i < 120; i += 1) {
              expect((await attempt()).status).toBe(422);
            }
            expect((await attempt()).status).toBe(429);
            jest.setSystemTime(Date.now() + 60 * 1000 + 1);
            row.last_rotated_at = nowS();
            expect((await attempt()).status).toBe(422);
          } finally {
            jest.useRealTimers();
          }
        });
      });
    });
  });
});
