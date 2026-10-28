import cloudApi, {
  CloudApiError,
  getSession,
  getOAuthCsrfToken,
  getPublicConfig,
  authenticateGoogle,
  logout,
  getSyncDocument,
  putSyncDocument,
  listSyncRevisions,
  getSyncRevision,
  deleteAccount,
} from './cloudApi.js';

function mockResponse({ status = 200, body, headers = {}, badJson = false }) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    json: async () => {
      if (badJson) throw new SyntaxError('bad json');
      return body;
    },
  };
}

function lastCall() {
  const [url, init] = global.fetch.mock.calls.at(-1);
  return { url, init };
}

describe('cloudApi', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });
  afterEach(() => {
    delete global.fetch;
  });

  test('default export exposes every named wrapper', () => {
    expect(Object.keys(cloudApi).sort()).toEqual(
      [
        'authenticateGoogle',
        'deleteAccount',
        'getOAuthCsrfToken',
        'getPublicConfig',
        'getSession',
        'getSyncDocument',
        'getSyncRevision',
        'listSyncRevisions',
        'logout',
        'putSyncDocument',
      ].sort()
    );
  });

  describe('getSession', () => {
    test('GETs /api/session with same-origin credentials and JSON accept', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({ body: { user: { id: 'u1' } } })
      );
      await expect(getSession()).resolves.toEqual({ user: { id: 'u1' } });
      const { url, init } = lastCall();
      expect(url).toBe('/api/session');
      expect(init.credentials).toBe('same-origin');
      expect(init.headers.Accept).toBe('application/json');
      expect(init.headers['Content-Type']).toBeUndefined();
      expect(init.method).toBeUndefined();
    });

    test('maps 401 to null', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({ status: 401, body: { error: 'no', code: 'AUTH' } })
      );
      await expect(getSession()).resolves.toBeNull();
    });

    test('rethrows non-401 errors', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({ status: 500, body: { error: 'boom', code: 'SERVER' } })
      );
      await expect(getSession()).rejects.toMatchObject({
        status: 500,
        code: 'SERVER',
        message: 'boom',
      });
    });
  });

  test('getOAuthCsrfToken returns csrfToken from /api/auth/csrf', async () => {
    global.fetch.mockResolvedValue(
      mockResponse({ body: { csrfToken: 'tok' } })
    );
    await expect(getOAuthCsrfToken()).resolves.toBe('tok');
    expect(lastCall().url).toBe('/api/auth/csrf');
  });

  test('getPublicConfig returns payload from /api/config', async () => {
    global.fetch.mockResolvedValue(
      mockResponse({ body: { googleClientId: 'abc' } })
    );
    await expect(getPublicConfig()).resolves.toEqual({ googleClientId: 'abc' });
    expect(lastCall().url).toBe('/api/config');
  });

  test('authenticateGoogle POSTs credential and csrfToken as JSON', async () => {
    global.fetch.mockResolvedValue(mockResponse({ body: { csrfToken: 'c2' } }));
    await expect(authenticateGoogle('cred', 'oauth')).resolves.toEqual({
      csrfToken: 'c2',
    });
    const { url, init } = lastCall();
    expect(url).toBe('/api/auth/google');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      credential: 'cred',
      csrfToken: 'oauth',
    });
  });

  test('logout POSTs {} with the CSRF header and returns payload+response', async () => {
    const res = mockResponse({ body: { ok: true } });
    global.fetch.mockResolvedValue(res);
    const result = await logout('csrf1');
    const { url, init } = lastCall();
    expect(url).toBe('/api/logout');
    expect(init.method).toBe('POST');
    expect(init.headers['X-CSRF-Token']).toBe('csrf1');
    expect(init.body).toBe('{}');
    expect(result.payload).toEqual({ ok: true });
    expect(result.response).toBe(res);
  });

  describe('getSyncDocument', () => {
    test('sends the CSRF header and prefers the ETag response header', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({
          body: { revision: 3, etag: '"body"' },
          headers: { ETag: '"hdr"' },
        })
      );
      const doc = await getSyncDocument('csrf');
      expect(lastCall().url).toBe('/api/sync');
      expect(lastCall().init.headers['X-CSRF-Token']).toBe('csrf');
      expect(doc).toEqual({ revision: 3, etag: '"hdr"' });
    });

    test('omits the CSRF header when no token is given', async () => {
      global.fetch.mockResolvedValue(mockResponse({ body: {} }));
      await getSyncDocument();
      expect(lastCall().init.headers['X-CSRF-Token']).toBeUndefined();
    });

    test('falls back to payload etag, then to "rev-0"', async () => {
      global.fetch.mockResolvedValueOnce(
        mockResponse({ body: { etag: '"p"' } })
      );
      expect((await getSyncDocument('c')).etag).toBe('"p"');
      global.fetch.mockResolvedValueOnce(mockResponse({ body: {} }));
      expect((await getSyncDocument('c')).etag).toBe('"rev-0"');
    });
  });

  describe('putSyncDocument', () => {
    test('PUTs the envelope with CSRF and default If-Match "rev-0"', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({ body: { revision: 1 }, headers: { etag: '"rev-1"' } })
      );
      const envelope = { version: 1, ciphertext: 'x' };
      const result = await putSyncDocument(envelope, 'csrf');
      const { url, init } = lastCall();
      expect(url).toBe('/api/sync');
      expect(init.method).toBe('PUT');
      expect(init.headers['X-CSRF-Token']).toBe('csrf');
      expect(init.headers['If-Match']).toBe('"rev-0"');
      expect(JSON.parse(init.body)).toEqual(envelope);
      expect(result).toEqual({ revision: 1, etag: '"rev-1"' });
    });

    test('uses a caller-supplied etag and falls back to payload etag', async () => {
      global.fetch.mockResolvedValue(mockResponse({ body: { etag: '"pe"' } }));
      const result = await putSyncDocument({}, 'csrf', '"rev-7"');
      expect(lastCall().init.headers['If-Match']).toBe('"rev-7"');
      expect(result.etag).toBe('"pe"');
    });

    test('maps a 412 conflict to CloudApiError with payload.code', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({
          status: 412,
          body: { error: 'stale', code: 'SYNC_CONFLICT', revision: 9 },
        })
      );
      const error = await putSyncDocument({}, 'c').catch((e) => e);
      expect(error).toBeInstanceOf(CloudApiError);
      expect(error.name).toBe('CloudApiError');
      expect(error.status).toBe(412);
      expect(error.code).toBe('SYNC_CONFLICT');
      expect(error.details).toEqual({
        error: 'stale',
        code: 'SYNC_CONFLICT',
        revision: 9,
      });
    });
  });

  describe('revisions', () => {
    test('listSyncRevisions returns the revisions array or []', async () => {
      global.fetch.mockResolvedValueOnce(
        mockResponse({ body: { revisions: [{ revision: 2 }] } })
      );
      await expect(listSyncRevisions('csrf')).resolves.toEqual([
        { revision: 2 },
      ]);
      expect(lastCall().url).toBe('/api/sync/revisions');
      expect(lastCall().init.headers['X-CSRF-Token']).toBe('csrf');
      global.fetch.mockResolvedValueOnce(mockResponse({ body: {} }));
      await expect(listSyncRevisions('csrf')).resolves.toEqual([]);
    });

    test('getSyncRevision URL-encodes the revision and returns the envelope', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({ body: { envelope: { ciphertext: 'z' } } })
      );
      await expect(getSyncRevision('a/b c', 'csrf')).resolves.toEqual({
        ciphertext: 'z',
      });
      expect(lastCall().url).toBe('/api/sync/revisions/a%2Fb%20c');
      expect(lastCall().init.headers['X-CSRF-Token']).toBe('csrf');
    });
  });

  test('deleteAccount DELETEs /api/account with confirmation body and CSRF', async () => {
    global.fetch.mockResolvedValue(mockResponse({ body: { deleted: true } }));
    const result = await deleteAccount('csrf', 'DELETE');
    const { url, init } = lastCall();
    expect(url).toBe('/api/account');
    expect(init.method).toBe('DELETE');
    expect(init.headers['X-CSRF-Token']).toBe('csrf');
    expect(JSON.parse(init.body)).toEqual({ confirmation: 'DELETE' });
    expect(result.payload).toEqual({ deleted: true });
  });

  describe('error mapping', () => {
    test('uses payload.error and payload.code', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({ status: 403, body: { error: 'Nope', code: 'CSRF' } })
      );
      await expect(logout('x')).rejects.toMatchObject({
        message: 'Nope',
        status: 403,
        code: 'CSRF',
      });
    });

    test('defaults message and code when payload is empty', async () => {
      global.fetch.mockResolvedValue(mockResponse({ status: 502, body: {} }));
      await expect(getPublicConfig()).rejects.toMatchObject({
        message: 'Cloud API request failed (502).',
        status: 502,
        code: 'CLOUD_API_ERROR',
      });
    });

    test('tolerates a non-JSON error body', async () => {
      global.fetch.mockResolvedValue(
        mockResponse({ status: 500, badJson: true })
      );
      await expect(getPublicConfig()).rejects.toMatchObject({
        message: 'Cloud API request failed (500).',
        code: 'CLOUD_API_ERROR',
        details: null,
      });
    });

    test('a 200 with a non-JSON body yields a null payload (wrapper TypeError)', async () => {
      global.fetch.mockResolvedValue(mockResponse({ badJson: true }));
      await expect(getOAuthCsrfToken()).rejects.toThrow(TypeError);
    });

    test('network failure propagates the fetch rejection', async () => {
      global.fetch.mockRejectedValue(new TypeError('offline'));
      await expect(getSession()).rejects.toThrow('offline');
    });
  });

  test('CloudApiError defaults', () => {
    const error = new CloudApiError('m');
    expect(error).toMatchObject({ status: 0, code: 'CLOUD_API_ERROR' });
    expect(error.details).toBeUndefined();
  });
});
