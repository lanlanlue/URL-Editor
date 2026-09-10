/**
 * faviconService.js
 *
 * Offline-safe favicon rendering service.
 *
 * Favicon loading is intentionally local-only. Automatically probing an
 * arbitrary URL's `/favicon.ico` and then falling back to a third-party
 * favicon proxy creates a network request for every saved URL. Missing
 * favicons, invalid certificates, DNS failures, and proxy 404s are then
 * reported by the browser as Console errors even when the application has
 * handled the failure correctly. A favicon is decorative, so it must not
 * make rendering depend on an external host.
 */

/** Inline SVG globe icon – zero network, always works offline. */
export const DEFAULT_FAVICON_SVG =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="%23737373" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

/**
 * Create an <img> element with a local, deterministic favicon.
 *
 * The function keeps the old public API so cards and live-test rows do not
 * need to know how the fallback is implemented. In particular, it never
 * assigns a remote URL to `src`, so rendering a list cannot trigger requests
 * to arbitrary domains or Google Favicon Service.
 *
 * @param {string} _url      Kept for API compatibility; not fetched.
 * @param {string} className CSS class applied to the <img>.
 * @returns {HTMLImageElement}
 */
export function createFaviconImg(_url, className) {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';
  img.src = DEFAULT_FAVICON_SVG;
  return img;
}
