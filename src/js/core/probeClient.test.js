import { probeViaServer, resetProbeClient } from './probeClient';

const reply = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

describe('probeViaServer', () => {
  beforeEach(() => {
    resetProbeClient();
    global.fetch = jest.fn();
  });

  test('maps a server response to a health result', async () => {
    global.fetch.mockResolvedValueOnce(
      reply(200, {
        reachable: true,
        code: 200,
        finalUrl: 'https://e.com/x',
        redirects: [{ url: 'https://e.com/', status: 301 }],
        timeMs: 120,
        embeddable: true,
        title: 'Hi',
        keywordFound: true,
      })
    );
    const res = await probeViaServer('https://e.com/', 'Hi');
    expect(res).toMatchObject({
      status: 'online',
      code: 200,
      mode: 'server',
      redirected: true,
      keywordFound: true,
      title: 'Hi',
    });
    const [path, init] = global.fetch.mock.calls[0];
    expect(path).toBe('/api/probe');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(init.body)).toEqual({
      url: 'https://e.com/',
      keyword: 'Hi',
    });
  });

  test('5xx from the target is offline with the code', async () => {
    global.fetch.mockResolvedValueOnce(
      reply(200, { reachable: true, code: 502, timeMs: 5 })
    );
    expect(await probeViaServer('https://e.com/')).toMatchObject({
      status: 'offline',
      code: 502,
      error: 'HTTP 502',
    });
  });

  test('unreachable target is offline', async () => {
    global.fetch.mockResolvedValueOnce(
      reply(200, { reachable: false, error: 'Timeout' })
    );
    expect(await probeViaServer('https://e.com/')).toMatchObject({
      status: 'offline',
      error: 'Timeout',
      mode: 'server',
    });
  });

  test('blocked/private address falls back without disabling the probe', async () => {
    global.fetch.mockResolvedValueOnce(reply(422, { code: 'URL_BLOCKED' }));
    expect(await probeViaServer('http://10.0.0.1/')).toBeNull();
    global.fetch.mockResolvedValueOnce(
      reply(200, { reachable: true, code: 200 })
    );
    expect(await probeViaServer('https://e.com/')).not.toBeNull();
  });

  test('signed out (401) disables further attempts for a while', async () => {
    global.fetch.mockResolvedValueOnce(reply(401, {}));
    expect(await probeViaServer('https://e.com/')).toBeNull();
    expect(await probeViaServer('https://e.com/')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('network failure falls back', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await probeViaServer('https://e.com/')).toBeNull();
  });

  test('a 5xx from the probe endpoint does not disable later probes', async () => {
    global.fetch.mockResolvedValueOnce(reply(502, {}));
    expect(await probeViaServer('https://slow.example/')).toBeNull();
    global.fetch.mockResolvedValueOnce(
      reply(200, { reachable: true, code: 200 })
    );
    expect(await probeViaServer('https://e.com/')).toMatchObject({
      mode: 'server',
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('a single URL timing out does not disable later probes', async () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    global.fetch.mockRejectedValueOnce(abort);
    expect(await probeViaServer('https://slow.example/')).toBeNull();
    global.fetch.mockResolvedValueOnce(
      reply(200, { reachable: true, code: 200 })
    );
    expect(await probeViaServer('https://e.com/')).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('a network failure does not disable later probes', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await probeViaServer('https://e.com/')).toBeNull();
    global.fetch.mockResolvedValueOnce(
      reply(200, { reachable: true, code: 200 })
    );
    expect(await probeViaServer('https://e.com/')).not.toBeNull();
  });

  test('no backend (404) disables further attempts for a while', async () => {
    global.fetch.mockResolvedValueOnce(reply(404, {}));
    expect(await probeViaServer('https://e.com/')).toBeNull();
    expect(await probeViaServer('https://e.com/')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  describe('consecutive failure backoff', () => {
    const ok = () => reply(200, { reachable: true, code: 200 });
    const timeout = () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return err;
    };
    let now;

    beforeEach(() => {
      now = 1_000_000;
      jest.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('one timeout among successes never disables probing', async () => {
      global.fetch
        .mockResolvedValueOnce(ok())
        .mockRejectedValueOnce(timeout())
        .mockResolvedValue(ok());
      const results = [];
      for (let i = 0; i < 6; i += 1) {
        results.push(await probeViaServer(`https://e.com/${i}`));
      }
      expect(global.fetch).toHaveBeenCalledTimes(6);
      expect(results.filter(Boolean)).toHaveLength(5);
    });

    test('a failing backend is only called a handful of times for 300 URLs', async () => {
      global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
      for (let i = 0; i < 300; i += 1) {
        expect(await probeViaServer(`https://e.com/${i}`)).toBeNull();
      }
      expect(global.fetch.mock.calls.length).toBeLessThanOrEqual(5);
    });

    test('consecutive 5xx and timeouts also trip the backoff', async () => {
      global.fetch
        .mockResolvedValueOnce(reply(502, {}))
        .mockRejectedValueOnce(timeout())
        .mockResolvedValueOnce(reply(503, {}));
      for (let i = 0; i < 10; i += 1) {
        await probeViaServer(`https://e.com/${i}`);
      }
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    test('a success resets the failure counter', async () => {
      global.fetch
        .mockRejectedValueOnce(new TypeError('x'))
        .mockRejectedValueOnce(new TypeError('x'))
        .mockResolvedValueOnce(ok())
        .mockRejectedValueOnce(new TypeError('x'))
        .mockRejectedValueOnce(new TypeError('x'))
        .mockResolvedValue(ok());
      for (let i = 0; i < 6; i += 1) {
        await probeViaServer(`https://e.com/${i}`);
      }
      // 2 failures, success, 2 failures: never 3 in a row, so never disabled.
      expect(global.fetch).toHaveBeenCalledTimes(6);
    });

    test('B22: a late 429 never shortens an already longer 30s backoff', async () => {
      let resolveLate;
      global.fetch.mockImplementationOnce(
        () => new Promise((resolve) => (resolveLate = resolve))
      );
      const late = probeViaServer('https://e.com/late');
      // Meanwhile three failures trip the 30s backoff.
      global.fetch.mockRejectedValue(new TypeError('x'));
      for (let i = 0; i < 3; i += 1) await probeViaServer(`https://e.com/${i}`);
      const callsAfterTrip = global.fetch.mock.calls.length;

      resolveLate(reply(429, {}));
      expect(await late).toBeNull();

      now += 15 * 1000; // past a 10s window, inside the 30s one
      await probeViaServer('https://e.com/x');
      expect(global.fetch).toHaveBeenCalledTimes(callsAfterTrip);
    });

    test('B22: a 429 on a healthy client still backs off for 10s only', async () => {
      global.fetch.mockResolvedValueOnce(reply(429, {}));
      await probeViaServer('https://e.com/');
      await probeViaServer('https://e.com/');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      now += 11 * 1000;
      global.fetch.mockResolvedValue(ok());
      expect(await probeViaServer('https://e.com/')).not.toBeNull();
    });

    test('probing resumes after the backoff window', async () => {
      global.fetch.mockRejectedValue(new TypeError('x'));
      for (let i = 0; i < 5; i += 1) await probeViaServer('https://e.com/');
      const callsWhileDisabled = global.fetch.mock.calls.length;
      expect(callsWhileDisabled).toBeLessThanOrEqual(5);
      await probeViaServer('https://e.com/');
      expect(global.fetch).toHaveBeenCalledTimes(callsWhileDisabled);

      now += 31 * 1000;
      global.fetch.mockResolvedValue(ok());
      expect(await probeViaServer('https://e.com/')).not.toBeNull();
      expect(global.fetch).toHaveBeenCalledTimes(callsWhileDisabled + 1);
    });
  });
});
