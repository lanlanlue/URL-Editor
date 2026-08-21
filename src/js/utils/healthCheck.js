/**
 * Utility for user-triggered URL connectivity health checks.
 */

/**
 * Checks connectivity of a target URL.
 * @param {string} url
 * @param {number} [timeoutMs=4000]
 * @returns {Promise<{status: 'online'|'offline', code?: number, error?: string}>}
 */
export async function checkUrlHealth(url, timeoutMs = 4000) {
  if (!url || typeof url !== 'string') {
    return { status: 'offline', error: 'Invalid URL' };
  }
  if (typeof fetch !== 'function') {
    return { status: 'offline', error: 'Fetch unavailable' };
  }

  let formattedUrl = url.trim();
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = 'https://' + formattedUrl;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Try HEAD request first with no-cors mode for cross-origin URLs
    const response = await fetch(formattedUrl, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
    });
    clearTimeout(timer);

    // In no-cors mode, type is 'opaque' and status is 0, which indicates network reachability
    if (
      response.type === 'opaque' ||
      (response.status >= 200 && response.status < 400)
    ) {
      return { status: 'online', code: response.status || 200 };
    }
    return { status: 'online', code: response.status };
  } catch (err) {
    clearTimeout(timer);
    // Try GET request fallback if HEAD fails or is blocked
    if (err.name !== 'AbortError') {
      const getController = new AbortController();
      const getTimer = setTimeout(() => getController.abort(), timeoutMs);
      try {
        const getResp = await fetch(formattedUrl, {
          method: 'GET',
          mode: 'no-cors',
          signal: getController.signal,
        });
        clearTimeout(getTimer);
        return { status: 'online', code: getResp.status || 200 };
      } catch (getErr) {
        clearTimeout(getTimer);
        return {
          status: 'offline',
          error: getErr.name === 'AbortError' ? 'Timeout' : getErr.message,
        };
      }
    }
    return { status: 'offline', error: 'Timeout' };
  }
}
