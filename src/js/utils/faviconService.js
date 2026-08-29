/**
 * faviconService.js
 *
 * Offline-safe favicon loading service.
 *
 * Design decision: Favicon fetching is ALWAYS deferred – it never fires on
 * page load. Instead, `createFaviconImg` immediately returns an element showing
 * the local SVG placeholder and schedules the real fetch with a combination of
 * `IntersectionObserver` (wait until visible) + `requestIdleCallback` / timeout
 * (wait until the browser is idle after layout).
 *
 * Fetch strategy (only runs while navigator.onLine === true):
 *   1. Try `{protocol}//{domain}/favicon.ico` – works for intranet hosts that
 *      have no public internet route but do serve a favicon locally.
 *   2. Fall back to the Google Favicon API – only when internet is reachable.
 *   3. On any failure, silently keep the inline SVG placeholder.
 *
 * Results are cached per-domain so duplicate cards never re-fire requests.
 * When the browser comes back online, pending placeholders auto-retry.
 */

/** Inline SVG globe icon – zero network, always works offline. */
export const DEFAULT_FAVICON_SVG =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%23737373" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

/** Per-domain resolved favicon URL cache. */
const _cache = new Map();

/** In-flight fetch promises per domain – prevents concurrent duplicate probes. */
const _inflight = new Map();

/**
 * Probe the best favicon source for a domain (never called until idle + visible).
 * @param {string} domain
 * @param {string} protocol  e.g. "https:" | "http:"
 * @returns {Promise<string>} resolved src URL
 */
function _probe(domain, protocol = 'https:') {
  if (_cache.has(domain)) return Promise.resolve(_cache.get(domain));
  if (_inflight.has(domain)) return _inflight.get(domain);

  const p = new Promise((resolve) => {
    // Hard offline guard – navigator.onLine is false only when the device has
    // no network at all; for intranet-only we still try the direct path.
    if (!navigator.onLine) {
      _cache.set(domain, DEFAULT_FAVICON_SVG);
      resolve(DEFAULT_FAVICON_SVG);
      return;
    }

    const directUrl = `${protocol}//${domain}/favicon.ico`;
    const googleUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;

    // Step 1 – direct /favicon.ico (works on private networks)
    const img1 = new Image();
    img1.onload = () => {
      _cache.set(domain, directUrl);
      resolve(directUrl);
    };
    img1.onerror = () => {
      // Step 2 – Google Favicon API (internet only)
      const img2 = new Image();
      img2.onload = () => {
        _cache.set(domain, googleUrl);
        resolve(googleUrl);
      };
      img2.onerror = () => {
        _cache.set(domain, DEFAULT_FAVICON_SVG);
        resolve(DEFAULT_FAVICON_SVG);
      };
      img2.src = googleUrl;
    };
    img1.src = directUrl;
  }).finally(() => _inflight.delete(domain));

  _inflight.set(domain, p);
  return p;
}

/** True when a domain is worth probing at all. */
function _probeWorthy(domain) {
  return (
    Boolean(domain) && domain !== 'localhost' && !domain.startsWith('127.')
  );
}

/**
 * Set img.src from a resolved favicon URL, but only if it still shows the
 * placeholder (the card may have been recycled in the meantime).
 */
function _applyFavicon(img, src) {
  if (img.src !== src) {
    img.src = src;
  }
}

/**
 * Run the actual probe for an img element that has become visible + idle.
 * @param {HTMLImageElement} img
 */
function _fetchForImg(img) {
  const domain = img.dataset.favDomain;
  const protocol = img.dataset.favProtocol || 'https:';
  if (!domain) return;
  _probe(domain, protocol).then((src) => _applyFavicon(img, src));
}

/**
 * Schedule a favicon probe using requestIdleCallback (or setTimeout fallback)
 * so it never competes with layout/paint on page load.
 * @param {HTMLImageElement} img
 */
function _scheduleProbe(img) {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => _fetchForImg(img), { timeout: 4000 });
  } else {
    setTimeout(() => _fetchForImg(img), 1500);
  }
}

/**
 * IntersectionObserver that defers until the img scrolls INTO the viewport.
 * We use rootMargin: '0px' (not 200px) so only truly visible cards are probed.
 */
const _observer = new IntersectionObserver(
  (entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      obs.unobserve(entry.target);
      // Wait for idle time AFTER the card is visible before hitting the network.
      _scheduleProbe(entry.target);
    });
  },
  { rootMargin: '0px' }
);

/**
 * Create an <img> element with offline-safe, deferred favicon loading.
 *
 * The returned element immediately shows the SVG placeholder.
 * The real favicon is fetched only when:
 *   (a) the element enters the viewport, AND
 *   (b) the browser has idle capacity (requestIdleCallback / 1.5 s timeout).
 *
 * @param {string}  url       Full URL of the site (used to extract domain + protocol).
 * @param {string}  className CSS class applied to the <img>.
 * @returns {HTMLImageElement}
 */
export function createFaviconImg(url, className) {
  let domain = '';
  let protocol = 'https:';
  try {
    const parsed = new URL(url);
    domain = parsed.hostname;
    protocol = parsed.protocol;
  } catch (_) {
    /* malformed URL – leave domain empty, always use SVG */
  }

  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.src = DEFAULT_FAVICON_SVG; // Start immediately with offline-safe placeholder

  if (_probeWorthy(domain)) {
    img.dataset.favDomain = domain;
    img.dataset.favProtocol = protocol;
    _observer.observe(img); // Probe deferred until visible + idle
  }

  return img;
}

// ── Online recovery ──────────────────────────────────────────────────────────
// When the device regains internet, retry any cards still showing the SVG
// placeholder so users don't need to reload the page.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    // Invalidate cached failures so they can be re-probed.
    for (const [domain, src] of _cache.entries()) {
      if (src === DEFAULT_FAVICON_SVG) _cache.delete(domain);
    }
    // Re-observe all placeholder imgs that are already in the DOM.
    document.querySelectorAll('img[data-fav-domain]').forEach((img) => {
      if (img.src.startsWith('data:image/svg')) {
        _observer.observe(img);
      }
    });
  });
}
