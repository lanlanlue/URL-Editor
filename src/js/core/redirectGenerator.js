export const REDIRECT_FORMATS = Object.freeze({
  NGINX: 'nginx',
  APACHE: 'apache',
  CLOUDFLARE: 'cloudflare',
  VERCEL: 'vercel',
});

function isAbsoluteUrl(value) {
  return /^[a-z][a-z\d+.-]*:\/\//i.test(value);
}

function normalizeSource(source) {
  const value = String(source || '').trim();
  if (!value) throw new TypeError('source is required');

  if (isAbsoluteUrl(value)) {
    const parsed = new URL(value);
    return `${parsed.pathname || '/'}${parsed.search}`;
  }

  const path = value.startsWith('/') ? value : `/${value}`;
  return path.split('#')[0];
}

function normalizeDestination(destination) {
  const value = String(destination || '').trim();
  if (!value) throw new TypeError('destination is required');
  if (isAbsoluteUrl(value)) return value;
  return value.startsWith('/') ? value : `/${value}`;
}

function splitWildcard(sourcePath) {
  const wildcardIndex = sourcePath.indexOf('*');
  if (wildcardIndex < 0) {
    return { hasWildcard: false, prefix: sourcePath, suffix: '' };
  }
  return {
    hasWildcard: true,
    prefix: sourcePath.slice(0, wildcardIndex),
    suffix: sourcePath.slice(wildcardIndex + 1),
  };
}

function replaceDestinationWildcard(destination, sourceInfo) {
  if (!sourceInfo.hasWildcard) return destination;
  return destination.replaceAll('*', '$1');
}

function escapeSingleQuoted(value) {
  return value.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

function buildNginx(sourcePath, destination, preserveQuery) {
  const sourceInfo = splitWildcard(sourcePath);
  const expression = sourceInfo.hasWildcard
    ? `^${sourceInfo.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.*)${sourceInfo.suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
    : `^${sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  const target = replaceDestinationWildcard(destination, sourceInfo);
  const queryNote = preserveQuery
    ? ' # original query string is preserved'
    : '';
  return `rewrite ${expression} ${target} permanent;${queryNote}`;
}

function buildApache(sourcePath, destination, preserveQuery) {
  const sourceInfo = splitWildcard(sourcePath);
  const target = replaceDestinationWildcard(destination, sourceInfo);
  const queryNote = preserveQuery
    ? ' # original query string is preserved'
    : '';
  if (sourceInfo.hasWildcard) {
    const expression = `^${sourceInfo.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.*)${sourceInfo.suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
    return `RedirectMatch 301 ${expression} ${target}${queryNote}`;
  }
  return `Redirect 301 ${sourcePath} ${target}${queryNote}`;
}

function buildCloudflare(sourcePath, destination, preserveQuery) {
  const sourceInfo = splitWildcard(sourcePath);
  const escapedDestination = escapeSingleQuoted(
    replaceDestinationWildcard(destination, sourceInfo)
  );

  if (!sourceInfo.hasWildcard && !preserveQuery) {
    return `if (url.pathname === '${escapeSingleQuoted(sourcePath)}') { return Response.redirect('${escapedDestination}', 301); }`;
  }

  const condition = sourceInfo.hasWildcard
    ? `url.pathname.startsWith('${escapeSingleQuoted(sourceInfo.prefix)}')`
    : `url.pathname === '${escapeSingleQuoted(sourcePath)}'`;
  return [
    `if (${condition}) {`,
    `  const target = new URL('${escapedDestination}', url);`,
    preserveQuery ? '  target.search = url.search;' : '',
    '  return Response.redirect(target.toString(), 301);',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildVercel(sourcePath, destination, preserveQuery) {
  const sourceInfo = splitWildcard(sourcePath);
  const source = sourceInfo.hasWildcard
    ? `${sourceInfo.prefix}:splat*${sourceInfo.suffix}`
    : sourcePath;
  const target = sourceInfo.hasWildcard
    ? destination.replaceAll('*', ':splat*')
    : destination;
  const rule = { source, destination: target, permanent: true };
  // Vercel forwards the original query string automatically when the
  // destination does not define a replacement query string.
  void preserveQuery;
  return JSON.stringify(rule, null, 2);
}

/**
 * Generates one redirect rule for a server/CDN format.
 * @param {string|object} source
 * @param {string} [destination]
 * @param {'nginx'|'apache'|'cloudflare'|'vercel'} [format='nginx']
 * @param {{preserveQuery?: boolean}} [options]
 * @returns {string}
 */
export function generateRedirectRule(
  source,
  destination,
  format = REDIRECT_FORMATS.NGINX,
  options = {}
) {
  let sourceValue = source;
  let destinationValue = destination;
  let formatValue = format;
  let optionsValue = options;

  if (source && typeof source === 'object') {
    sourceValue = source.source || source.oldUrl || source.from;
    destinationValue = source.destination || source.newUrl || source.to;
    formatValue = source.format || REDIRECT_FORMATS.NGINX;
    optionsValue = source.options || {};
  }

  const sourcePath = normalizeSource(sourceValue);
  const target = normalizeDestination(destinationValue);
  const preserveQuery = optionsValue.preserveQuery !== false;

  switch (String(formatValue).toLowerCase()) {
    case REDIRECT_FORMATS.APACHE:
      return buildApache(sourcePath, target, preserveQuery);
    case REDIRECT_FORMATS.CLOUDFLARE:
    case 'cloudflare-workers':
      return buildCloudflare(sourcePath, target, preserveQuery);
    case REDIRECT_FORMATS.VERCEL:
    case 'vercel.json':
      return buildVercel(sourcePath, target, preserveQuery);
    case REDIRECT_FORMATS.NGINX:
      return buildNginx(sourcePath, target, preserveQuery);
    default:
      throw new RangeError(`Unsupported redirect format: ${formatValue}`);
  }
}

export const generateRedirect = generateRedirectRule;

/**
 * Generates every supported format in one call. Passing a format in the
 * source object keeps this helper compatible with generateRedirectRule.
 */
export function generateRedirectRules(source, destination, options = {}) {
  if (source && typeof source === 'object' && source.format) {
    return generateRedirectRule(source);
  }
  const sourceValue =
    source && typeof source === 'object'
      ? source.source || source.oldUrl || source.from
      : source;
  const destinationValue =
    source && typeof source === 'object'
      ? source.destination || source.newUrl || source.to
      : destination;
  const optionsValue =
    source && typeof source === 'object' ? source.options || options : options;
  const formats = Object.values(REDIRECT_FORMATS);
  return formats.reduce((rules, format) => {
    rules[format] = generateRedirectRule(
      sourceValue,
      destinationValue,
      format,
      optionsValue
    );
    return rules;
  }, {});
}

export const generateAllRedirectRules = generateRedirectRules;

export default generateRedirectRule;
