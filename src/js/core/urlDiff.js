function parseUrl(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty URL string`);
  }

  try {
    return new URL(value.trim());
  } catch {
    throw new TypeError(`${label} is not a valid URL`);
  }
}

function getQueryValue(searchParams, key) {
  const values = searchParams.getAll(key);
  if (values.length <= 1) return values[0] ?? '';
  return values;
}

function valuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftValues = Array.isArray(left) ? left : [left];
    const rightValues = Array.isArray(right) ? right : [right];
    return (
      leftValues.length === rightValues.length &&
      leftValues.every((value, index) => value === rightValues[index])
    );
  }
  return left === right;
}

function collectQueryParams(url) {
  const params = {};
  const keys = new Set();
  url.searchParams.forEach((_value, key) => keys.add(key));
  keys.forEach((key) => {
    params[key] = getQueryValue(url.searchParams, key);
  });
  return params;
}

/**
 * Compares two absolute URLs and returns a stable, serializable diff.
 * Query parameter values retain arrays when a key occurs more than once.
 * @param {string} urlA
 * @param {string} urlB
 * @returns {object}
 */
export function compareUrls(urlA, urlB) {
  const parsedA = parseUrl(urlA, 'urlA');
  const parsedB = parseUrl(urlB, 'urlB');
  const paramsA = collectQueryParams(parsedA);
  const paramsB = collectQueryParams(parsedB);
  const addedParams = {};
  const removedParams = {};
  const modifiedParams = {};

  Object.keys(paramsB).forEach((key) => {
    if (!(key in paramsA)) {
      addedParams[key] = paramsB[key];
    } else if (!valuesEqual(paramsA[key], paramsB[key])) {
      modifiedParams[key] = {
        oldVal: paramsA[key],
        newVal: paramsB[key],
      };
    }
  });

  Object.keys(paramsA).forEach((key) => {
    if (!(key in paramsB)) removedParams[key] = paramsA[key];
  });

  return {
    domainChanged: parsedA.origin !== parsedB.origin,
    pathChanged: parsedA.pathname !== parsedB.pathname,
    addedParams,
    removedParams,
    modifiedParams,
    protocolChanged: parsedA.protocol !== parsedB.protocol,
    hostChanged: parsedA.host !== parsedB.host,
    hashChanged: parsedA.hash !== parsedB.hash,
    hasChanges:
      parsedA.origin !== parsedB.origin ||
      parsedA.pathname !== parsedB.pathname ||
      parsedA.hash !== parsedB.hash ||
      Object.keys(addedParams).length > 0 ||
      Object.keys(removedParams).length > 0 ||
      Object.keys(modifiedParams).length > 0,
  };
}

export const diffUrls = compareUrls;
export const getUrlDiff = compareUrls;

export function tryCompareUrls(urlA, urlB) {
  try {
    return { ok: true, diff: compareUrls(urlA, urlB) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export default compareUrls;
