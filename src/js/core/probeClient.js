import { BUILD_MODE } from './buildMode.js';

const PROBE_TIMEOUT_MS = 12000;
const FAILURE_THRESHOLD = 3;
const FAILURE_BACKOFF_MS = 30 * 1000;
let disabledUntil = 0;
let consecutiveFailures = 0;

/** Test hook: forget earlier failures. */
export function resetProbeClient() {
  disabledUntil = 0;
  consecutiveFailures = 0;
}

function disableFor(ms) {
  disabledUntil = Date.now() + ms;
}

function recordSuccess() {
  consecutiveFailures = 0;
}

/**
 * A timeout, network error or 5xx for one URL must not disable probing for
 * everyone, but a backend that keeps failing would otherwise cost one slow
 * request per URL. After a few failures in a row, back off briefly.
 */
function recordFailure() {
  if (Date.now() < disabledUntil) return; // late result of an in-flight call
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    consecutiveFailures = 0;
    disableFor(FAILURE_BACKOFF_MS);
  }
}

/**
 * Asks the cloud backend to probe a public URL. Returns a HealthResult, or
 * null when the server probe is unavailable (local build, signed out, no
 * backend, rate limited, or a private/blocked address) so the caller can fall
 * back to the browser-only check.
 * @param {string} url
 * @param {string} [keyword]
 * @returns {Promise<object|null>}
 */
export async function probeViaServer(url, keyword) {
  if (BUILD_MODE === 'local' || typeof fetch !== 'function') return null;
  if (Date.now() < disabledUntil) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch('/api/probe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(keyword ? { url, keyword } : { url }),
      signal: controller.signal,
    });
    if (response.status === 422) {
      recordSuccess(); // backend answered; this address is just not probeable
      return null; // blocked/private: use browser check
    }
    if (response.status === 429) {
      disableFor(10 * 1000);
      return null;
    }
    if (response.status === 401 || response.status === 404) {
      disableFor(60 * 1000); // signed out / no backend: every URL would fail
      return null;
    }
    if (!response.ok) {
      recordFailure(); // 5xx etc.
      return null;
    }
    const data = await response.json();
    recordSuccess();
    return toHealthResult(data);
  } catch {
    // One timeout or network error falls back for this URL only; repeated
    // ones trip the short backoff in recordFailure().
    recordFailure();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toHealthResult(data) {
  if (!data || typeof data !== 'object') return null;
  if (!data.reachable) {
    return {
      status: 'offline',
      error: data.error || 'Unreachable',
      timeMs: data.timeMs,
      redirects: data.redirects,
      mode: 'server',
    };
  }
  const ok = data.code >= 200 && data.code < 400;
  return {
    status: ok ? 'online' : 'offline',
    code: data.code,
    error: ok ? undefined : `HTTP ${data.code}`,
    timeMs: data.timeMs,
    finalUrl: data.finalUrl,
    redirected: Array.isArray(data.redirects) && data.redirects.length > 0,
    redirects: data.redirects,
    embeddable: data.embeddable,
    title: data.title,
    ...(typeof data.keywordFound === 'boolean'
      ? { keywordFound: data.keywordFound }
      : {}),
    mode: 'server',
  };
}
