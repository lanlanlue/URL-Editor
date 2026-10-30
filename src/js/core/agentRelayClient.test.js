import {
  RELAY_STORAGE_KEY,
  initAgentRelay,
  parseRelayPairing,
  startRelayClient,
} from './agentRelayClient';

const TOKEN = 'abcdefghijklmnop1234';
const flush = () => new Promise((r) => setTimeout(r, 0));

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

describe('parseRelayPairing', () => {
  test('accepts a valid fragment and rejects malformed ones', () => {
    expect(parseRelayPairing(`#agent-relay=17891:${TOKEN}`)).toEqual({
      port: 17891,
      token: TOKEN,
    });
    expect(parseRelayPairing('')).toBeNull();
    expect(
      parseRelayPairing('#agent-relay=80:abcdefghijklmnop1234')
    ).toBeNull();
    expect(parseRelayPairing('#agent-relay=17891:short')).toBeNull();
    expect(parseRelayPairing(`#agent-relay=99999:${TOKEN}`)).toBeNull();
    expect(parseRelayPairing(`#agent-relay=17891:${TOKEN}/../x`)).toBeNull();
    expect(parseRelayPairing(null)).toBeNull();
  });
});

describe('startRelayClient', () => {
  test('runs a job against the bridge and posts the result', async () => {
    const bridge = { list: jest.fn(() => ({ ok: true, total: 0, items: [] })) };
    const calls = [];
    let polls = 0;
    const fetchImpl = jest.fn(async (url, init = {}) => {
      calls.push([url, init]);
      if (url.endsWith('/poll')) {
        polls += 1;
        return polls === 1
          ? response(200, { id: 'r1', method: 'list', params: { query: 'a' } })
          : new Promise(() => {});
      }
      return response(200, { ok: true });
    });
    const client = startRelayClient({
      port: 17891,
      token: TOKEN,
      bridge,
      fetchImpl,
    });
    await flush();
    await flush();
    client.stop();

    expect(bridge.list).toHaveBeenCalledWith({ query: 'a' });
    const [url, init] = calls.find(([u]) => u.endsWith('/result'));
    expect(url).toBe('http://127.0.0.1:17891/result');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({
      id: 'r1',
      result: { ok: true, total: 0, items: [] },
    });
  });

  test('refuses methods outside the dispatch table and survives bridge exceptions', async () => {
    const bridge = {
      remove: () => {
        throw new Error('storage unreadable');
      },
    };
    const posted = [];
    const jobs = [
      { id: 'a', method: '__proto__', params: {} },
      { id: 'b', method: 'constructor', params: {} },
      { id: 'c', method: 'remove', params: { ids: ['x'] } },
    ];
    const fetchImpl = async (url, init = {}) => {
      if (url.endsWith('/poll')) {
        return jobs.length
          ? response(200, jobs.shift())
          : new Promise(() => {});
      }
      posted.push(JSON.parse(init.body));
      return response(200, {});
    };
    const client = startRelayClient({
      port: 17891,
      token: TOKEN,
      bridge,
      fetchImpl,
    });
    for (let i = 0; i < 6; i++) await flush();
    client.stop();

    expect(posted.map((p) => p.result.error.code)).toEqual([
      'unknown_method',
      'unknown_method',
      'exception',
    ]);
  });

  test('stops permanently when the relay rejects the token', async () => {
    const statuses = [];
    const fetchImpl = jest.fn(async () => response(401, {}));
    startRelayClient({
      port: 17891,
      token: TOKEN,
      bridge: {},
      fetchImpl,
      onStatus: (s) => statuses.push(s),
    });
    await flush();
    await flush();
    expect(statuses).toEqual(['rejected']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('backs off and reports disconnected on network errors', async () => {
    const sleeps = [];
    const statuses = [];
    let attempts = 0;
    let client;
    const fetchImpl = async () => {
      attempts += 1;
      if (attempts > 3) {
        client.stop();
        return new Promise(() => {});
      }
      throw new Error('refused');
    };
    client = startRelayClient({
      port: 17891,
      token: TOKEN,
      bridge: {},
      fetchImpl,
      sleep: async (ms) => sleeps.push(ms),
      onStatus: (s) => statuses.push(s),
    });
    for (let i = 0; i < 8; i++) await flush();
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(statuses).toEqual(['disconnected']);
  });
});

describe('initAgentRelay', () => {
  const never = () => new Promise(() => {});

  test('consumes the fragment, stores it for the session and cleans the URL', () => {
    const storage = memoryStorage();
    const replaceState = jest.fn();
    const client = initAgentRelay({
      bridge: {},
      location: {
        hash: `#agent-relay=17891:${TOKEN}`,
        pathname: '/',
        search: '?agent=1',
      },
      history: { replaceState },
      storage,
      fetchImpl: never,
    });
    expect(client).not.toBeNull();
    client.stop();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?agent=1');
    expect(JSON.parse(storage.getItem(RELAY_STORAGE_KEY))).toEqual({
      port: 17891,
      token: TOKEN,
    });
  });

  test('resumes from sessionStorage and returns null when unpaired', () => {
    const resumed = initAgentRelay({
      bridge: {},
      location: { hash: '', pathname: '/', search: '' },
      history: { replaceState: jest.fn() },
      storage: memoryStorage({
        [RELAY_STORAGE_KEY]: JSON.stringify({ port: 17891, token: TOKEN }),
      }),
      fetchImpl: never,
    });
    expect(resumed).not.toBeNull();
    resumed.stop();

    expect(
      initAgentRelay({
        bridge: {},
        location: { hash: '', pathname: '/', search: '' },
        history: { replaceState: jest.fn() },
        storage: memoryStorage(),
        fetchImpl: never,
      })
    ).toBeNull();
  });

  test('ignores corrupt stored pairing', () => {
    expect(
      initAgentRelay({
        bridge: {},
        location: { hash: '', pathname: '/', search: '' },
        history: { replaceState: jest.fn() },
        storage: memoryStorage({ [RELAY_STORAGE_KEY]: '{bad' }),
        fetchImpl: never,
      })
    ).toBeNull();
  });
});
