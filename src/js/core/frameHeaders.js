/**
 * Reads X-Frame-Options / CSP frame-ancestors from a Headers-like object.
 * Returns false when the page cannot be shown in our iframe, true otherwise.
 * Shared by the extension probe and the server probe.
 * @param {{get?: function(string): (string|null)}} headers
 * @returns {boolean}
 */
export function isEmbeddable(headers) {
  const xfo = (headers?.get?.('x-frame-options') || '').toLowerCase();
  if (xfo.includes('deny') || xfo.includes('sameorigin')) return false;

  const csp = headers?.get?.('content-security-policy') || '';
  const directive = csp
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith('frame-ancestors'));
  if (directive) {
    const sources = directive.split(/\s+/).slice(1);
    if (!sources.includes('*')) return false;
  }
  return true;
}
