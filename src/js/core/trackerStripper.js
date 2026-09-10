export const DEFAULT_TRACKER_PARAMS = Object.freeze([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  '_hsenc',
  '__hssc',
  '__hstc',
  'hsCtaTracking',
  'mc_cid',
  'mc_eid',
]);

function normalizeBlacklist(blacklist) {
  return new Set(
    (Array.isArray(blacklist) ? blacklist : DEFAULT_TRACKER_PARAMS).map((key) =>
      String(key).trim().toLowerCase()
    )
  );
}

/**
 * Removes known marketing and click-tracking parameters while retaining all
 * business parameters, URL fragments, and parameter order.
 * @param {string} urlString
 * @param {string[]} [blacklist]
 * @returns {string}
 */
export function stripTrackers(urlString, blacklist = DEFAULT_TRACKER_PARAMS) {
  if (typeof urlString !== 'string' || !urlString.trim())
    return urlString || '';

  try {
    const parsed = new URL(urlString.trim());
    const blocked = normalizeBlacklist(blacklist);
    [...parsed.searchParams.keys()].forEach((key) => {
      if (blocked.has(key.toLowerCase())) parsed.searchParams.delete(key);
    });
    return parsed.toString();
  } catch {
    return urlString;
  }
}

export function stripTrackersDetailed(
  urlString,
  blacklist = DEFAULT_TRACKER_PARAMS
) {
  const cleanedUrl = stripTrackers(urlString, blacklist);
  return {
    originalUrl: urlString,
    cleanedUrl,
    changed: cleanedUrl !== urlString,
  };
}

/**
 * Cleans a list of URLs. A newline-delimited string is accepted for modal use.
 * @param {string[]|string} urlList
 * @param {string[]} [blacklist]
 * @returns {string[]}
 */
export function batchStrip(urlList = [], blacklist = DEFAULT_TRACKER_PARAMS) {
  const list = Array.isArray(urlList)
    ? urlList
    : String(urlList)
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
  return list.map((url) => stripTrackers(url, blacklist));
}

export default stripTrackers;
