import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  saveSettings,
} from './settings';

describe('settings', () => {
  beforeEach(() => localStorage.clear());

  test('returns safe defaults when storage is empty or malformed', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{broken');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test('persists only supported setting values', () => {
    const settings = saveSettings({
      theme: 'light',
      enableMarketingToolkit: true,
      cloudSyncProvider: 'cloudflare',
      unexpected: 'ignored by the normalized shape',
    });

    expect(settings).toEqual({
      theme: 'light',
      enableMarketingToolkit: true,
      cloudSyncProvider: 'cloudflare',
    });
    expect(loadSettings()).toEqual(settings);
  });
});
