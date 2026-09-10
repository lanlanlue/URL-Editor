export const UTM_KEYS = Object.freeze([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
]);

export const UTM_PRESETS = Object.freeze({
  googleAds: Object.freeze({
    label: 'Google Ads',
    utm_source: 'google',
    utm_medium: 'cpc',
    utm_campaign: '',
    utm_term: '',
    utm_content: '',
  }),
  facebookAds: Object.freeze({
    label: 'Facebook Ads',
    utm_source: 'facebook',
    utm_medium: 'paid_social',
    utm_campaign: '',
    utm_term: '',
    utm_content: '',
  }),
  edm: Object.freeze({
    label: 'EDM',
    utm_source: 'newsletter',
    utm_medium: 'email',
    utm_campaign: '',
    utm_term: '',
    utm_content: '',
  }),
});

function cleanValue(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function containsControlCharacters(value) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (code >= 0 && code <= 31) || code === 127;
  });
}

export function normalizeUtmParams(params = {}) {
  const normalized = {};
  UTM_KEYS.forEach((key) => {
    const value = cleanValue(params[key]);
    if (value) normalized[key] = value;
  });
  return normalized;
}

export function validateUtmParams(params = {}) {
  const values = normalizeUtmParams(params);
  const errors = [];
  const requiredKeys = ['utm_source', 'utm_medium', 'utm_campaign'];

  requiredKeys.forEach((key) => {
    if (!values[key]) errors.push(`${key} is required`);
  });

  Object.entries(values).forEach(([key, value]) => {
    if (containsControlCharacters(value)) {
      errors.push(`${key} must not contain control characters`);
    }
    if (value.length > 200)
      errors.push(`${key} must be 200 characters or less`);
  });

  return { valid: errors.length === 0, errors, values };
}

/**
 * Adds normalized UTM parameters to an absolute URL. Existing UTM values are
 * replaced, while unrelated business parameters remain untouched.
 * @param {string} baseUrl
 * @param {object} params
 * @param {{requireCampaign?: boolean}} [options]
 * @returns {string}
 */
export function buildUtmUrl(baseUrl, params = {}, options = {}) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new TypeError('baseUrl must be a non-empty URL string');
  }

  const parsed = new URL(baseUrl.trim());
  const normalized = normalizeUtmParams(params);
  const validation = validateUtmParams(normalized);
  if (options.requireCampaign === false) {
    validation.errors = validation.errors.filter(
      (error) => !error.startsWith('utm_campaign is required')
    );
    validation.valid = validation.errors.length === 0;
  }
  if (!validation.valid) {
    throw new TypeError(validation.errors.join('; '));
  }

  UTM_KEYS.forEach((key) => parsed.searchParams.delete(key));
  Object.entries(normalized).forEach(([key, value]) => {
    parsed.searchParams.set(key, value);
  });
  return parsed.toString();
}

export function getUtmPreset(name) {
  const preset = UTM_PRESETS[name];
  return preset ? { ...preset } : null;
}

export const buildUrlWithUtm = buildUtmUrl;
export const createUtmUrl = buildUtmUrl;

export default buildUtmUrl;
