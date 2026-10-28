import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  isMarketingToolkitEnabled,
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

describe('settings fallbacks and storage failures', () => {
  beforeEach(() => localStorage.clear());

  const failingStorage = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('quota');
    },
  };

  test('loadSettings falls back to defaults when storage throws', () => {
    expect(loadSettings(failingStorage)).toEqual(DEFAULT_SETTINGS);
  });

  test('loadSettings returns a fresh copy, not the frozen defaults', () => {
    const loaded = loadSettings();
    expect(loaded).not.toBe(DEFAULT_SETTINGS);
    loaded.theme = 'light';
    expect(loadSettings().theme).toBe('dark');
  });

  test('loadSettings uses an injected storage', () => {
    const store = new Map([
      [SETTINGS_STORAGE_KEY, JSON.stringify({ theme: 'light' })],
    ]);
    const storage = { getItem: (k) => store.get(k) ?? null };
    expect(loadSettings(storage)).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'light',
    });
  });

  test.each([
    ['null JSON', 'null'],
    ['array JSON', '[1,2]'],
    ['string JSON', '"dark"'],
    ['number JSON', '5'],
  ])('loadSettings normalises %s to defaults', (_label, raw) => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, raw);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test('loadSettings replaces each invalid field independently', () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        theme: 'neon',
        enableMarketingToolkit: 'true',
        cloudSyncProvider: 'webdav',
      })
    );
    expect(loadSettings()).toEqual({
      theme: 'dark',
      enableMarketingToolkit: false,
      cloudSyncProvider: 'webdav',
    });
  });

  test('saveSettings returns normalised values even if storage throws', () => {
    expect(
      saveSettings(
        { theme: 'light', cloudSyncProvider: 'bogus' },
        failingStorage
      )
    ).toEqual({
      theme: 'light',
      enableMarketingToolkit: false,
      cloudSyncProvider: 'none',
    });
  });

  test('saveSettings tolerates null, non-object and missing arguments', () => {
    expect(saveSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings()).toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY))).toEqual(
      DEFAULT_SETTINGS
    );
  });

  test('saveSettings writes through an injected storage', () => {
    const setItem = jest.fn();
    saveSettings({ theme: 'light' }, { setItem });
    expect(setItem).toHaveBeenCalledWith(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_SETTINGS, theme: 'light' })
    );
  });

  test('isMarketingToolkitEnabled requires a strict true', () => {
    expect(isMarketingToolkitEnabled({ enableMarketingToolkit: true })).toBe(
      true
    );
    expect(isMarketingToolkitEnabled({ enableMarketingToolkit: 1 })).toBe(
      false
    );
    expect(isMarketingToolkitEnabled({})).toBe(false);
  });

  test('isMarketingToolkitEnabled defaults to the persisted settings', () => {
    expect(isMarketingToolkitEnabled()).toBe(false);
    saveSettings({ enableMarketingToolkit: true });
    expect(isMarketingToolkitEnabled()).toBe(true);
  });
});

describe('settings without localStorage', () => {
  test('load and save use defaults when localStorage is undefined', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'localStorage'
    );
    // jsdom defines localStorage on window; shadow it via the global binding.
    const originalLocal = global.localStorage;
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        value: undefined,
        configurable: true,
        writable: true,
      });
      expect(typeof localStorage).toBe('undefined');
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
      expect(saveSettings({ theme: 'light' }).theme).toBe('light');
    } finally {
      if (descriptor)
        Object.defineProperty(globalThis, 'localStorage', descriptor);
      else global.localStorage = originalLocal;
    }
  });
});
