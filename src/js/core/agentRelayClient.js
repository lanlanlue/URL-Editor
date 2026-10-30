export const RELAY_HASH_KEY = 'agent-relay';
export const RELAY_STORAGE_KEY = 'urlEditorAgentRelay';

// Only these bridge methods can be invoked remotely, with fixed argument shapes.
const DISPATCH = {
  describe: (bridge) => bridge.describe(),
  list: (bridge, p) => bridge.list(p),
  get: (bridge, p) => bridge.get(p?.id),
  add: (bridge, p) => bridge.add(p),
  addMany: (bridge, p) => bridge.addMany(p?.inputs, p?.options),
  update: (bridge, p) => bridge.update(p?.id, p?.patch),
  remove: (bridge, p) => bridge.remove(p?.ids),
  undo: (bridge) => bridge.undo(),
};

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10000;

/**
 * Parses a pairing fragment such as `#agent-relay=17891:<token>`.
 * @returns {{port: number, token: string}|null}
 */
export function parseRelayPairing(hash) {
  if (typeof hash !== 'string') return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const value = params.get(RELAY_HASH_KEY);
  const match = /^(\d{4,5}):([A-Za-z0-9_-]{16,128})$/.exec(value || '');
  if (!match) return null;
  const port = Number(match[1]);
  if (port < 1024 || port > 65535) return null;
  return { port, token: match[2] };
}

async function runJob(bridge, job) {
  const handler = Object.prototype.hasOwnProperty.call(DISPATCH, job?.method)
    ? DISPATCH[job.method]
    : null;
  if (!handler) {
    return {
      ok: false,
      error: { code: 'unknown_method', message: 'Method not allowed.' },
    };
  }
  try {
    return await handler(bridge, job.params);
  } catch (error) {
    return {
      ok: false,
      error: { code: 'exception', message: String(error?.message || error) },
    };
  }
}

/**
 * Long-polls the local relay for bridge calls and posts the results back. The
 * host is fixed to loopback; the pairing only supplies a port and a token.
 *
 * @param {object} options
 * @param {number} options.port
 * @param {string} options.token
 * @param {object} options.bridge  object from createAgentBridge
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(status: 'connected'|'disconnected'|'rejected') => void} [options.onStatus]
 * @returns {{stop: () => void}}
 */
export function startRelayClient({
  port,
  token,
  bridge,
  fetchImpl = (...args) => globalThis.fetch(...args),
  onStatus = () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Bearer ${token}` };
  let stopped = false;
  let controller = null;
  let status = null;

  function setStatus(next) {
    if (status === next) return;
    status = next;
    onStatus(next);
  }

  async function loop() {
    let backoff = MIN_BACKOFF_MS;
    while (!stopped) {
      try {
        controller = new AbortController();
        const response = await fetchImpl(`${base}/poll`, {
          headers,
          signal: controller.signal,
          cache: 'no-store',
        });
        if (response.status === 401 || response.status === 403) {
          setStatus('rejected');
          return;
        }
        if (!response.ok) throw new Error(`poll ${response.status}`);
        setStatus('connected');
        backoff = MIN_BACKOFF_MS;
        if (response.status === 204) continue;
        const job = await response.json();
        const result = await runJob(bridge, job);
        await fetchImpl(`${base}/result`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: job.id, result }),
        });
      } catch {
        if (stopped) return;
        setStatus('disconnected');
        await sleep(backoff);
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
      }
    }
  }

  void loop();

  return {
    stop() {
      stopped = true;
      controller?.abort();
    },
  };
}

/**
 * Reads the pairing from the URL fragment (then removes it from the address
 * bar) or from sessionStorage, and starts the client. Returns null when the
 * page is not paired.
 */
export function initAgentRelay({
  bridge,
  location = globalThis.location,
  history = globalThis.history,
  storage,
  onStatus,
  fetchImpl,
} = {}) {
  let store = storage;
  if (store === undefined) {
    try {
      store = globalThis.sessionStorage;
    } catch {
      store = null;
    }
  }

  let pairing = parseRelayPairing(location?.hash);
  if (pairing) {
    try {
      store?.setItem(RELAY_STORAGE_KEY, JSON.stringify(pairing));
    } catch {
      // Pairing still works for this page load without persistence.
    }
    try {
      history?.replaceState(null, '', location.pathname + location.search);
    } catch {
      // Cosmetic only.
    }
  } else {
    try {
      const saved = JSON.parse(store?.getItem(RELAY_STORAGE_KEY) || 'null');
      pairing = parseRelayPairing(
        `#${RELAY_HASH_KEY}=${saved?.port}:${saved?.token}`
      );
    } catch {
      pairing = null;
    }
  }
  if (!pairing) return null;

  return startRelayClient({
    port: pairing.port,
    token: pairing.token,
    bridge,
    onStatus: (status) => {
      if (status === 'rejected') {
        try {
          store?.removeItem(RELAY_STORAGE_KEY);
        } catch {
          // ignore
        }
      }
      onStatus?.(status);
    },
    fetchImpl,
  });
}
