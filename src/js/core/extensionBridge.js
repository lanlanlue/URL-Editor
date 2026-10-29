function getChromeApi() {
  const chromeApi =
    typeof globalThis !== 'undefined' ? globalThis.chrome : undefined;
  if (!chromeApi?.tabs) return null;
  return chromeApi;
}

export function isExtensionEnvironment() {
  const chromeApi = getChromeApi();
  return Boolean(chromeApi && typeof chromeApi.tabs.query === 'function');
}

function isLoadableUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getActiveTabUrl() {
  const chromeApi = getChromeApi();
  if (!chromeApi || typeof chromeApi.tabs.query !== 'function') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (tabs) => {
      if (settled) return;
      settled = true;
      const url = tabs?.[0]?.url;
      resolve(isLoadableUrl(url) ? url : null);
    };

    try {
      const result = chromeApi.tabs.query(
        { active: true, currentWindow: true },
        finish
      );
      if (result && typeof result.then === 'function')
        result.then(finish).catch(() => finish([]));
    } catch {
      finish([]);
    }
  });
}

/**
 * Loads the active browser tab into the editor when the app is running as an
 * MV3 popup. The callback keeps this bridge independent from editor internals.
 * @param {{onUrl?: function, input?: HTMLInputElement}} [options]
 * @returns {Promise<string|null>}
 */
export async function initExtensionBridge(options = {}) {
  if (!isExtensionEnvironment()) return null;
  const url = await getActiveTabUrl();
  if (!url) return null;

  if (options.input) {
    options.input.value = url;
    options.input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (typeof options.onUrl === 'function') options.onUrl(url);
  return url;
}

function getPermissionsApi() {
  const chromeApi =
    typeof globalThis !== 'undefined' ? globalThis.chrome : undefined;
  const api = chromeApi?.permissions;
  return api && typeof api.contains === 'function' ? api : null;
}

/**
 * Converts a URL to the origin match pattern used for optional host
 * permissions (e.g. "https://staging.example.com/*"). Null if not http(s).
 * @param {string} url
 * @returns {string|null}
 */
export function toOriginPattern(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return `${parsed.protocol}//${parsed.hostname}/*`;
  } catch {
    return null;
  }
}

function callPermissions(method, origins) {
  const api = getPermissionsApi();
  if (!api || typeof api[method] !== 'function') return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const result = api[method]({ origins }, (granted) => resolve(!!granted));
      if (result && typeof result.then === 'function') {
        result
          .then((granted) => resolve(!!granted))
          .catch(() => resolve(false));
      }
    } catch {
      resolve(false);
    }
  });
}

/**
 * True when the extension already holds host access for the URL's origin.
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export function hasHostPermission(url) {
  const pattern = toOriginPattern(url);
  return pattern
    ? callPermissions('contains', [pattern])
    : Promise.resolve(false);
}

/**
 * Asks the user to grant host access for the given URLs' origins in a single
 * prompt. Must be called from a user gesture (click handler).
 * @param {string[]} urls
 * @returns {Promise<boolean>}
 */
export function requestHostPermissions(urls) {
  const origins = [...new Set(urls.map(toOriginPattern).filter(Boolean))];
  return origins.length
    ? callPermissions('request', origins)
    : Promise.resolve(false);
}

export default initExtensionBridge;
