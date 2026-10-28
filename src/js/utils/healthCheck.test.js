import { checkManyUrls, checkUrlHealth, isEmbeddable } from './healthCheck';

const headers = (map) => ({ get: (k) => map[k.toLowerCase()] ?? null });

describe('healthCheck', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.chrome;
  });

  describe('limited mode (plain web page)', () => {
    test('online when an opaque response comes back, without a status code', async () => {
      global.fetch.mockResolvedValueOnce({ type: 'opaque', status: 0 });

      const res = await checkUrlHealth('https://example.com');
      expect(res).toMatchObject({ status: 'online', mode: 'limited' });
      expect(res.code).toBeUndefined();
      expect(res.needsPermission).toBe(false);
    });

    test('offline when fetch rejects with a network error', async () => {
      global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const res = await checkUrlHealth('https://invalid-host-xxxx.com');
      expect(res).toMatchObject({
        status: 'offline',
        error: 'Failed to fetch',
      });
    });

    test('rejects empty input', async () => {
      expect((await checkUrlHealth('')).status).toBe('offline');
    });
  });

  describe('extension mode', () => {
    const setChrome = (granted) => {
      global.chrome = {
        tabs: { query: jest.fn() },
        permissions: {
          contains: jest.fn((_q, cb) => cb(granted)),
        },
      };
    };

    test('reads the real status when host permission is granted', async () => {
      setChrome(true);
      global.fetch.mockResolvedValueOnce({
        status: 200,
        url: 'https://intra.local/',
        redirected: false,
        headers: headers({}),
      });

      const res = await checkUrlHealth('intra.local');
      expect(global.fetch.mock.calls[0][0]).toBe('https://intra.local');
      expect(res).toMatchObject({
        status: 'online',
        code: 200,
        mode: 'extension',
        embeddable: true,
      });
      expect(typeof res.timeMs).toBe('number');
    });

    test('4xx/5xx are reported offline with the status code', async () => {
      setChrome(true);
      global.fetch.mockResolvedValueOnce({
        status: 503,
        url: 'https://intra.local/',
        headers: headers({}),
      });

      const res = await checkUrlHealth('https://intra.local');
      expect(res).toMatchObject({
        status: 'offline',
        code: 503,
        error: 'HTTP 503',
      });
    });

    test('falls back to GET when the server rejects HEAD', async () => {
      setChrome(true);
      global.fetch
        .mockResolvedValueOnce({ status: 405, headers: headers({}) })
        .mockResolvedValueOnce({ status: 200, headers: headers({}) });

      const res = await checkUrlHealth('https://intra.local');
      expect(global.fetch.mock.calls.map((c) => c[1].method)).toEqual([
        'HEAD',
        'GET',
      ]);
      expect(res.status).toBe('online');
    });

    test('flags non-embeddable pages', async () => {
      setChrome(true);
      global.fetch.mockResolvedValueOnce({
        status: 200,
        headers: headers({ 'x-frame-options': 'DENY' }),
      });
      expect((await checkUrlHealth('https://intra.local')).embeddable).toBe(
        false
      );
    });

    test('without permission: limited result that asks for access', async () => {
      setChrome(false);
      global.fetch.mockResolvedValueOnce({ type: 'opaque', status: 0 });

      const res = await checkUrlHealth('https://intra.local');
      expect(global.fetch.mock.calls[0][1].mode).toBe('no-cors');
      expect(res).toMatchObject({
        status: 'online',
        mode: 'limited',
        needsPermission: true,
      });
    });
  });

  describe('isEmbeddable', () => {
    test.each([
      [{}, true],
      [{ 'x-frame-options': 'SAMEORIGIN' }, false],
      [{ 'content-security-policy': "default-src 'self'" }, true],
      [{ 'content-security-policy': "frame-ancestors 'none'" }, false],
      [{ 'content-security-policy': 'frame-ancestors *' }, true],
    ])('%j -> %s', (map, expected) => {
      expect(isEmbeddable(headers(map))).toBe(expected);
    });
  });

  describe('checkManyUrls', () => {
    test('caps concurrency and returns every result', async () => {
      let active = 0;
      let peak = 0;
      const check = jest.fn(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { status: 'online' };
      });
      const entries = Array.from({ length: 10 }, (_, i) => ({
        id: `u${i}`,
        url: `https://x${i}.test`,
      }));
      const onResult = jest.fn();

      const results = await checkManyUrls(entries, {
        concurrency: 3,
        check,
        onResult,
      });

      expect(results.size).toBe(10);
      expect(onResult).toHaveBeenCalledTimes(10);
      expect(peak).toBeLessThanOrEqual(3);
    });

    test('a throwing check becomes an offline result', async () => {
      const results = await checkManyUrls(
        [{ id: 'a', url: 'https://a.test' }],
        {
          check: async () => {
            throw new Error('boom');
          },
        }
      );
      expect(results.get('a')).toEqual({ status: 'offline', error: 'boom' });
    });
  });
});
