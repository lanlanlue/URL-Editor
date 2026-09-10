export const SETTINGS_STORAGE_KEY = 'urlEditorSettings';

export const DEFAULT_SETTINGS = Object.freeze({
  theme: 'dark',
  enableMarketingToolkit: false,
  cloudSyncProvider: 'none',
});

const VALID_THEMES = new Set(['dark', 'light']);
const VALID_CLOUD_PROVIDERS = new Set(['none', 'cloudflare', 'webdav']);

function getStorage(storage) {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function normalizeSettings(settings = {}) {
  const candidate = settings && typeof settings === 'object' ? settings : {};
  return {
    theme: VALID_THEMES.has(candidate.theme)
      ? candidate.theme
      : DEFAULT_SETTINGS.theme,
    enableMarketingToolkit: candidate.enableMarketingToolkit === true,
    cloudSyncProvider: VALID_CLOUD_PROVIDERS.has(candidate.cloudSyncProvider)
      ? candidate.cloudSyncProvider
      : DEFAULT_SETTINGS.cloudSyncProvider,
  };
}

/**
 * Loads persisted settings without allowing malformed storage to break boot.
 * @param {Storage} [storage]
 * @returns {{theme: string, enableMarketingToolkit: boolean, cloudSyncProvider: string}}
 */
export function loadSettings(storage) {
  const targetStorage = getStorage(storage);
  if (!targetStorage) return { ...DEFAULT_SETTINGS };

  try {
    const raw = targetStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Persists a normalized settings object. Storage failures are intentionally
 * swallowed so private browsing and quota restrictions do not stop the app.
 * @param {object} newSettings
 * @param {Storage} [storage]
 * @returns {{theme: string, enableMarketingToolkit: boolean, cloudSyncProvider: string}}
 */
export function saveSettings(newSettings = {}, storage) {
  const nextSettings = normalizeSettings(newSettings);
  const targetStorage = getStorage(storage);

  if (targetStorage) {
    try {
      targetStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
    } catch {
      // Keep the in-memory value available even when storage is unavailable.
    }
  }

  return nextSettings;
}

export function isMarketingToolkitEnabled(settings = loadSettings()) {
  return settings.enableMarketingToolkit === true;
}
