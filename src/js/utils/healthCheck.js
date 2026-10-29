/**
 * Utility for user-triggered URL connectivity health checks.
 *
 * Three modes:
 *  - server: plain web page signed in to the cloud app; `/api/probe` fetches
 *    public URLs from the server (real status, redirect chain, title). It
 *    cannot reach intranet hosts.
 *  - extension: running as an extension page that holds host permission for the
 *    target origin, so fetch() can read the real HTTP status and response
 *    headers (works for intranet hosts reachable from this machine).
 *  - limited: plain web page, or no permission yet. Cross-origin responses are
 *    opaque, so we can only tell whether the host answered, not its status.
 */
import { isEmbeddable } from '../core/frameHeaders';
import { probeViaServer } from '../core/probeClient';
import {
  hasHostPermission,
  isExtensionEnvironment,
} from '../core/extensionBridge';

/**
 * @typedef {object} HealthResult
 * @property {'online'|'offline'} status
 * @property {number} [code] HTTP status (extension/server mode)
 * @property {string} [error]
 * @property {number} [timeMs]
 * @property {string} [finalUrl] URL after redirects (extension/server mode)
 * @property {boolean} [redirected]
 * @property {boolean} [embeddable] false when headers forbid iframe embedding
 * @property {boolean} [needsPermission] extension could give exact results if
 *   the user grants host access for this origin
 * @property {string} [title] page <title> (server mode only)
 * @property {Array<{url: string, status: number}>} [redirects] hops before the
 *   final response (server mode only)
 * @property {boolean} [keywordFound] set when a keyword was requested
 * @property {'extension'|'server'|'limited'} [mode]
 */

export { isEmbeddable };

function normalizeUrl(url) {
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
}

/**
 * fetch() with an abort timer. The timer is NOT cleared when headers arrive:
 * the caller owns it through `release()` so body reads stay bounded too.
 * On a rejected fetch the timer is cleared here.
 */
async function timedFetch(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const release = () => clearTimeout(timer);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    return { resp, release };
  } catch (err) {
    release();
    throw err;
  }
}

/** Discards an unread response body so the connection is not held open. */
function discardBody(resp) {
  try {
    const result = resp?.body?.cancel?.();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Nothing to release.
  }
}

function errorMessage(err) {
  return err?.name === 'AbortError' ? 'Timeout' : err?.message || 'Error';
}

async function readCappedText(resp, maxBytes = 256 * 1024) {
  if (!resp.body?.getReader) return (await resp.text()).slice(0, maxBytes);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return text;
}

async function probeWithExtension(url, timeoutMs, keyword) {
  const started = Date.now();
  const init = {
    credentials: 'include',
    redirect: 'follow',
    cache: 'no-store',
  };
  let release = () => {};
  try {
    let resp;
    if (keyword) {
      // Keyword assertions need the body, so skip HEAD.
      ({ resp, release } = await timedFetch(
        url,
        { ...init, method: 'GET' },
        timeoutMs
      ));
    } else {
      try {
        ({ resp, release } = await timedFetch(
          url,
          { ...init, method: 'HEAD' },
          timeoutMs
        ));
        // Some servers reject HEAD; confirm with GET before reporting failure.
        if (resp.status === 405 || resp.status === 501) {
          release();
          discardBody(resp);
          ({ resp, release } = await timedFetch(
            url,
            { ...init, method: 'GET' },
            timeoutMs
          ));
        }
      } catch (headErr) {
        if (headErr?.name === 'AbortError') throw headErr;
        ({ resp, release } = await timedFetch(
          url,
          { ...init, method: 'GET' },
          timeoutMs
        ));
      }
    }
    const ok = resp.status >= 200 && resp.status < 400;
    let keywordFound;
    if (keyword) {
      // The abort timer is still armed here, so a stalling body is cut off.
      keywordFound = (await readCappedText(resp)).includes(keyword);
    } else {
      discardBody(resp);
    }
    return {
      status: ok ? 'online' : 'offline',
      code: resp.status,
      error: ok ? undefined : `HTTP ${resp.status}`,
      timeMs: Date.now() - started,
      finalUrl: resp.url || url,
      redirected: Boolean(resp.redirected),
      embeddable: isEmbeddable(resp.headers),
      ...(keyword ? { keywordFound } : {}),
      mode: 'extension',
    };
  } catch (err) {
    return {
      status: 'offline',
      error: errorMessage(err),
      timeMs: Date.now() - started,
      mode: 'extension',
    };
  } finally {
    release();
  }
}

async function probeLimited(url, timeoutMs, needsPermission) {
  const started = Date.now();
  const init = { mode: 'no-cors' };
  try {
    try {
      const { release } = await timedFetch(
        url,
        { ...init, method: 'HEAD' },
        timeoutMs
      );
      release();
    } catch (headErr) {
      if (headErr?.name === 'AbortError') throw headErr;
      const { release } = await timedFetch(
        url,
        { ...init, method: 'GET' },
        timeoutMs
      );
      release();
    }
    // Opaque response: the host answered, but its status is unknown.
    return {
      status: 'online',
      timeMs: Date.now() - started,
      needsPermission,
      mode: 'limited',
    };
  } catch (err) {
    return {
      status: 'offline',
      error: errorMessage(err),
      timeMs: Date.now() - started,
      needsPermission,
      mode: 'limited',
    };
  }
}

/**
 * Checks connectivity of a target URL.
 * @param {string} url
 * @param {number} [timeoutMs=4000]
 * @param {{keyword?: string}} [options]
 * @returns {Promise<HealthResult>}
 */
export async function checkUrlHealth(url, timeoutMs = 4000, options = {}) {
  if (!url || typeof url !== 'string') {
    return { status: 'offline', error: 'Invalid URL' };
  }
  if (typeof fetch !== 'function') {
    return { status: 'offline', error: 'Fetch unavailable' };
  }

  const target = normalizeUrl(url);
  const inExtension = isExtensionEnvironment();
  if (inExtension && (await hasHostPermission(target))) {
    return probeWithExtension(target, timeoutMs, options.keyword);
  }
  if (!inExtension) {
    const viaServer = await probeViaServer(target, options.keyword);
    if (viaServer) return viaServer;
  }
  return probeLimited(target, timeoutMs, inExtension);
}

/**
 * Runs a check over many entries with a concurrency cap so a large list does
 * not open hundreds of simultaneous connections.
 * @param {Array<{id: string, url: string}>} entries
 * @param {object} [options]
 * @param {number} [options.concurrency=6]
 * @param {number} [options.timeoutMs]
 * @param {(url: string, timeoutMs?: number) => Promise<HealthResult>} [options.check]
 * @param {(entry: object) => Promise<HealthResult>} [options.run] overrides
 *   `check`, for callers that need the whole entry (assertions, history)
 * @param {(entry: object, result: HealthResult) => void} [options.onResult]
 * @returns {Promise<Map<string, HealthResult>>}
 */
export async function checkManyUrls(entries, options = {}) {
  const {
    concurrency = 6,
    timeoutMs,
    check = checkUrlHealth,
    run,
    onResult,
  } = options;
  const results = new Map();
  const queue = [...entries];

  const worker = async () => {
    while (queue.length) {
      const entry = queue.shift();
      let res;
      try {
        res = run ? await run(entry) : await check(entry.url, timeoutMs);
      } catch (err) {
        res = { status: 'offline', error: errorMessage(err) };
      }
      results.set(entry.id, res);
      if (onResult) onResult(entry, res);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker)
  );
  return results;
}
