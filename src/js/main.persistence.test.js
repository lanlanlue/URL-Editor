import fs from 'fs';
import path from 'path';
import { fireEvent } from '@testing-library/dom';

/**
 * Persistence-focused tests for main.js bootstrap, cloud restore and runtime
 * health state. The secure storage, cloud loader and check history are
 * replaced so the tests can observe exactly what main.js asks to persist.
 */

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate, message) {
  for (let i = 0; i < 200; i += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error(`Timed out waiting for: ${message}`);
}

async function loadMain({ initialState, checkUrlHealth } = {}) {
  jest.resetModules();
  const mocks = {
    saveSecureState: jest.fn(() => Promise.resolve()),
    pruneHistory: jest.fn(),
    cloudOptions: null,
  };

  jest.doMock('./core/darkMode.js', () => ({ initDarkMode: jest.fn() }));
  jest.doMock('./core/secureStorage.js', () => ({
    initializeSecureStorage: jest.fn(() => Promise.resolve(initialState)),
    saveSecureState: mocks.saveSecureState,
  }));
  jest.doMock('./core/runtimeConfig.js', () => ({
    ...jest.requireActual('./core/runtimeConfig.js'),
    CLOUD_ENABLED: true,
  }));
  jest.doMock('./core/cloudFeatureLoader.js', () => ({
    loadCloudSyncModule: () =>
      Promise.resolve({
        initCloudSyncModal: (options) => {
          mocks.cloudOptions = options;
        },
        openCloudSyncModal: jest.fn(),
      }),
  }));
  jest.doMock('./core/checkHistory.js', () => ({
    ...jest.requireActual('./core/checkHistory.js'),
    pruneHistory: mocks.pruneHistory,
  }));
  if (checkUrlHealth) {
    jest.doMock('./utils/healthCheck.js', () => ({
      ...jest.requireActual('./utils/healthCheck.js'),
      checkUrlHealth,
    }));
  }

  document.body.innerHTML = fs.readFileSync(
    path.resolve(__dirname, '../../src/index.html'),
    'utf8'
  );
  const alertSpy = jest.fn();
  window.alert = alertSpy;
  await import('./main.js');
  await waitFor(() => mocks.cloudOptions, 'bootstrap to reach cloud sync init');
  await flush();
  return { ...mocks, alertSpy };
}

const lastSavedState = (saveSecureState) =>
  saveSecureState.mock.calls[saveSecureState.mock.calls.length - 1][0];

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  jest.dontMock('./utils/healthCheck.js');
});

describe('B1: unreadable encrypted record', () => {
  const unreadableState = {
    schemaVersion: 1,
    urls: [],
    presets: undefined,
    rebuildHistory: [],
    tombstones: [],
    unreadable: true,
  };

  test('bootstrap neither overwrites the record nor prunes check history', async () => {
    const { saveSecureState, pruneHistory, alertSpy } = await loadMain({
      initialState: unreadableState,
    });
    expect(saveSecureState).not.toHaveBeenCalled();
    expect(pruneHistory).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  test('later edits in the session do not overwrite the unreadable record', async () => {
    const { saveSecureState, cloudOptions } = await loadMain({
      initialState: unreadableState,
    });
    cloudOptions.onRestore({
      urls: [{ id: 'r1', url: 'https://remote.example/' }],
    });
    expect(saveSecureState).not.toHaveBeenCalled();
  });

  test('a readable store still persists on bootstrap and prunes history', async () => {
    const { saveSecureState, pruneHistory } = await loadMain({
      initialState: {
        schemaVersion: 1,
        urls: [{ id: 'a', url: 'https://a.example/' }],
      },
    });
    expect(saveSecureState).toHaveBeenCalled();
    expect(pruneHistory).toHaveBeenCalledWith(['a']);
  });
});

describe('B2: restoreCloudData keeps remote sync stamps', () => {
  test('remote entries are not re-stamped as local edits', async () => {
    const { saveSecureState, cloudOptions } = await loadMain({
      initialState: {
        schemaVersion: 1,
        urls: [{ id: 'local', url: 'https://local.example/' }],
      },
    });
    saveSecureState.mockClear();

    cloudOptions.onRestore({
      urls: [
        {
          id: 'remote',
          url: 'https://remote.example/',
          syncUpdatedAt: 1111,
          syncDeviceId: 'other-device',
        },
      ],
      tombstones: [
        {
          id: 'gone',
          deletedAt: 5,
          syncUpdatedAt: 2222,
          syncDeviceId: 'other-device',
        },
      ],
      presets: [
        {
          id: 'p1',
          name: 'P',
          syncUpdatedAt: 3333,
          syncDeviceId: 'other-device',
        },
      ],
    });

    const saved = lastSavedState(saveSecureState);
    const remote = saved.urls.find((entry) => entry.id === 'remote');
    expect(remote.syncUpdatedAt).toBe(1111);
    expect(remote.syncDeviceId).toBe('other-device');
    expect(saved.tombstones[0]).toMatchObject({
      id: 'gone',
      syncUpdatedAt: 2222,
    });
    const preset = saved.presets.find((item) => item.id === 'p1');
    expect(preset.syncUpdatedAt).toBe(3333);
    expect(preset.syncDeviceId).toBe('other-device');
  });

  test('a later local edit of a restored entry is still stamped locally', async () => {
    const { saveSecureState, cloudOptions } = await loadMain({
      initialState: { schemaVersion: 1, urls: [] },
    });
    cloudOptions.onRestore({
      urls: [
        {
          id: 'remote',
          url: 'https://remote.example/',
          label: 'Old',
          syncUpdatedAt: 1111,
          syncDeviceId: 'other-device',
        },
      ],
    });
    saveSecureState.mockClear();

    const input = document.querySelector('.url-card__label');
    expect(input).toBeTruthy();
    input.value = 'Edited';
    fireEvent.change(input);

    const saved = lastSavedState(saveSecureState);
    const remote = saved.urls.find((entry) => entry.id === 'remote');
    expect(remote.label).toBe('Edited');
    expect(remote.syncUpdatedAt).toBeGreaterThan(1111);
    expect(remote.syncDeviceId).not.toBe('other-device');
  });
});
