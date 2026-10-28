import { isEmbeddable } from '../js/core/frameHeaders.js';

export const PROBE_LIMITS = {
  maxRedirects: 5,
  timeoutMs: 8000,
  maxBodyBytes: 256 * 1024,
  maxKeywordLength: 200,
  maxUrlLength: 2048,
};

// Web-facing ports only. The probe returns headers and the page title, so it
// must not be usable to read arbitrary TCP services.
const ALLOWED_PORTS = new Set([
  '80',
  '443',
  '3000',
  '5000',
  '8000',
  '8080',
  '8443',
  '8888',
]);

const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
];

function ipv4Octets(host) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

function isPrivateIpv4([a, b, c]) {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

// Inside 2000::/3 but still not routable public hosts: 6to4 (2002::/16, can
// embed any IPv4 incl. private), Teredo (2001::/32) and documentation
// (2001:db8::/32). `bare` is the WHATWG-normalised literal (lowercase).
function isReservedIpv6Prefix(bare) {
  const parts = bare.split(':');
  const first = parseInt(parts[0], 16);
  const second = parts[1] === '' ? 0 : parseInt(parts[1], 16);
  return (
    first === 0x2002 || (first === 0x2001 && (second === 0 || second === 0xdb8))
  );
}

/**
 * Validates a probe target. Only public http(s) hosts on web ports pass.
 * WHATWG URL parsing already normalises decimal/hex/octal IPv4 spellings
 * (http://2130706433 -> 127.0.0.1), so the checks below see the dotted form.
 * @param {string} raw
 * @returns {{ok: true, url: URL} | {ok: false, reason: string}}
 */
export function validateProbeTarget(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > PROBE_LIMITS.maxUrlLength)
    return { ok: false, reason: 'Invalid URL' };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { ok: false, reason: 'Only http(s) is supported' };
  if (url.username || url.password)
    return { ok: false, reason: 'Credentials in URLs are not allowed' };
  if (url.port && !ALLOWED_PORTS.has(url.port))
    return { ok: false, reason: 'Port is not allowed' };

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) {
    // IPv6 literal: allow only global unicast 2000::/3.
    const bare = host.slice(1, -1);
    if (!/^[23]/.test(bare) || isReservedIpv6Prefix(bare))
      return { ok: false, reason: 'Private or reserved address' };
    return { ok: true, url };
  }

  const octets = ipv4Octets(host);
  if (octets) {
    return isPrivateIpv4(octets)
      ? { ok: false, reason: 'Private or reserved address' }
      : { ok: true, url };
  }

  if (
    host === 'localhost' ||
    !host.includes('.') ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))
  )
    return { ok: false, reason: 'Private or reserved address' };
  return { ok: true, url };
}

async function readCapped(response, maxBytes) {
  if (!response.body?.getReader)
    return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
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

// Linear-time: `/<title[^>]*>/` backtracks quadratically on a body made of
// repeated "<title" with no ">". The first ">" after the first "<title" always
// ends the tag, and if there is none no later "<title" can match either.
function extractTitle(html) {
  const start = /<title/i.exec(html);
  if (!start) return '';
  const tagEnd = html.indexOf('>', start.index);
  if (tagEnd === -1) return '';
  const raw = html.slice(tagEnd + 1, tagEnd + 1 + 300);
  const lt = raw.indexOf('<');
  return (lt === -1 ? raw : raw.slice(0, lt)).replace(/\s+/g, ' ').trim();
}

/**
 * Probes a public URL: follows redirects manually (re-validating every hop),
 * then reads up to 256 KB of the final response for the title and keyword.
 * @param {string} rawUrl
 * @param {{keyword?: string}} [options]
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object>} `{blocked, reason}` for a rejected initial URL,
 *   otherwise `{reachable, ...}`.
 */
export async function runProbe(rawUrl, options = {}, fetchImpl = fetch) {
  const first = validateProbeTarget(rawUrl);
  if (!first.ok) return { blocked: true, reason: first.reason };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_LIMITS.timeoutMs);
  const redirects = [];
  let current = first.url;

  try {
    for (let hop = 0; ; hop++) {
      const response = await fetchImpl(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'URL-Editor-Probe/1.0', Accept: '*/*' },
      });

      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        response.body?.cancel?.().catch(() => {});
        redirects.push({ url: current.href, status: response.status });
        if (hop >= PROBE_LIMITS.maxRedirects)
          return fail('Too many redirects', started, redirects);
        let next;
        try {
          next = validateProbeTarget(new URL(location, current).href);
        } catch {
          return fail('Invalid redirect target', started, redirects);
        }
        if (!next.ok)
          return fail('Redirected to a blocked address', started, redirects);
        current = next.url;
        continue;
      }

      const body = await readCapped(response, PROBE_LIMITS.maxBodyBytes);
      const result = {
        reachable: true,
        code: response.status,
        finalUrl: current.href,
        redirects,
        timeMs: Date.now() - started,
        embeddable: isEmbeddable(response.headers),
        contentType: response.headers.get('content-type') || '',
        title: extractTitle(body),
      };
      if (options.keyword) result.keywordFound = body.includes(options.keyword);
      return result;
    }
  } catch (err) {
    return fail(
      err?.name === 'AbortError' ? 'Timeout' : 'Connection failed',
      started,
      redirects
    );
  } finally {
    clearTimeout(timer);
  }
}

function fail(error, started, redirects) {
  return {
    reachable: false,
    error,
    redirects,
    timeMs: Date.now() - started,
  };
}
