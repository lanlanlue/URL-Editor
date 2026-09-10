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

export default initExtensionBridge;
