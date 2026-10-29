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

  // Fetch joins repeated CSP headers with ", ", and every policy is enforced,
  // so a page is embeddable only if each policy's frame-ancestors (when
  // present) allows any ancestor ('*').
  const csp = headers?.get?.('content-security-policy') || '';
  return csp.split(',').every((policy) => {
    const directive = policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .find((tokens) => tokens[0].toLowerCase() === 'frame-ancestors');
    return !directive || directive.slice(1).includes('*');
  });
}
