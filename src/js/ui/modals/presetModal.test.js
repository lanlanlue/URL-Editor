import { getSavedPresets, savePresets } from './presetModal';

describe('presetModal', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('should return default presets when localStorage is empty and persist them', () => {
    const presets = getSavedPresets();
    expect(presets.length).toBeGreaterThan(0);
    expect(presets[0].name).toBe('QA 環境');

    const storedRaw = localStorage.getItem('paramPresets');
    expect(storedRaw).toBeTruthy();
  });

  test('should save and load custom presets from localStorage', () => {
    const customPresets = [
      { id: 'custom-1', name: 'Test Env', params: [['env', 'test']] },
    ];
    savePresets(customPresets);

    const loaded = getSavedPresets();
    expect(loaded.length).toBe(1);
    expect(loaded[0].name).toBe('Test Env');
  });

  test('should allow editing any preset including default ones', () => {
    const presets = getSavedPresets();
    presets[0].name = 'Modified QA Env';
    presets[0].params = [['env', 'qa-stage']];
    savePresets(presets);

    const updated = getSavedPresets();
    expect(updated[0].name).toBe('Modified QA Env');
    expect(updated[0].params).toEqual([['env', 'qa-stage']]);
  });

  test('should allow deleting any preset including default ones', () => {
    const presets = getSavedPresets();
    const initialCount = presets.length;
    const filtered = presets.filter((p) => p.id !== 'default-qa');

    savePresets(filtered);

    const updated = getSavedPresets();
    expect(updated.length).toBe(initialCount - 1);
    expect(updated.find((p) => p.id === 'default-qa')).toBeUndefined();
  });
});
