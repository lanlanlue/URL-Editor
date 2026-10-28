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
  // Mirrors secureStorage: the unreadable state is tracked there (per scope)
  // and cleared by an explicit recovery.
  let unreadable = Boolean(initialState?.unreadable);
  mocks.markStorageRecovered = jest.fn(() => {
    unreadable = false;
  });
  jest.doMock('./core/secureStorage.js', () => ({
    initializeSecureStorage: jest.fn(() => Promise.resolve(initialState)),
    saveSecureState: mocks.saveSecureState,
    isStorageUnreadable: () => unreadable,
    markStorageRecovered: mocks.markStorageRecovered,
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

  test('ordinary edits while unreadable are skipped but visibly reported', async () => {
    const { saveSecureState } = await loadMain({
      initialState: unreadableState,
    });
    const urlInput = document.getElementById('url-main-input');
    fireEvent.change(urlInput, { target: { value: 'https://new.example/' } });
    fireEvent.click(document.getElementById('parse-btn'));
    fireEvent.click(document.getElementById('save-url-btn'));
    expect(saveSecureState).not.toHaveBeenCalled();
    const notice = document.querySelector('[data-storage-unreadable-notice]');
    expect(notice).toBeTruthy();
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toMatch(/not (being )?saved/i);
  });

  test('B21: the notice is styled by a class and has no inline style', async () => {
    await loadMain({ initialState: unreadableState });
    fireEvent.click(document.getElementById('save-url-btn'));
    const notice = document.querySelector('[data-storage-unreadable-notice]');
    expect(notice).toBeTruthy();
    expect(notice.classList.contains('storage-unreadable-notice')).toBe(true);
    expect(notice.hasAttribute('style')).toBe(false);
    expect(notice.getAttribute('role')).toBe('alert');
  });

  test('a restore without confirmedRecovery never clears the unreadable flag', async () => {
    const { saveSecureState, cloudOptions, markStorageRecovered } =
      await loadMain({ initialState: unreadableState });
    // Indistinguishable from genuinely empty remote data: must not recover.
    cloudOptions.onRestore({ urls: [] });
    cloudOptions.onRestore({
      urls: [{ id: 'r1', url: 'https://remote.example/' }],
    });
    expect(markStorageRecovered).not.toHaveBeenCalled();
    expect(saveSecureState).not.toHaveBeenCalled();
    expect(
      document.querySelector('[data-storage-unreadable-notice]')
    ).toBeTruthy();
  });

  test('a restore with confirmedRecovery recovers: clears the flag, persists, hides the notice', async () => {
    const { saveSecureState, cloudOptions, markStorageRecovered } =
      await loadMain({ initialState: unreadableState });
    cloudOptions.onRestore(
      { urls: [{ id: 'r1', url: 'https://remote.example/' }] },
      { confirmedRecovery: true }
    );
    expect(markStorageRecovered).toHaveBeenCalled();
    expect(saveSecureState).toHaveBeenCalled();
    expect(lastSavedState(saveSecureState).urls[0].id).toBe('r1');
    expect(
      document.querySelector('[data-storage-unreadable-notice]')
    ).toBeNull();
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

describe('B5: health status is runtime-only', () => {
  const state = {
    schemaVersion: 1,
    urls: [{ id: 'a', url: 'https://a.example/', label: 'A' }],
  };

  test('healthStatus is never persisted while a check is running or after it', async () => {
    let finish;
    const checkUrlHealth = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { saveSecureState, cloudOptions } = await loadMain({
      initialState: state,
      checkUrlHealth,
    });
    saveSecureState.mockClear();

    fireEvent.click(document.querySelector('.url-card__button--health'));
    await waitFor(() => checkUrlHealth.mock.calls.length > 0, 'check start');
    expect(document.querySelector('.health--checking')).toBeTruthy();

    // Any save while the check runs must not carry the transient status.
    fireEvent.click(document.querySelector('.url-card__pin-btn'));
    let saved = lastSavedState(saveSecureState);
    expect(saved.urls[0].healthStatus).toBeUndefined();
    expect(cloudOptions.getData().urls[0].healthStatus).toBeUndefined();

    finish({ status: 'online', code: 200, mode: 'extension' });
    await flush();
    await flush();
    fireEvent.click(document.querySelector('.url-card__pin-btn'));
    saved = lastSavedState(saveSecureState);
    expect(saved.urls[0].healthStatus).toBeUndefined();
    // ...but the finished result is still shown in the UI.
    expect(document.querySelector('.health--online')).toBeTruthy();
  });

  const checkOnline = () =>
    jest.fn(() =>
      Promise.resolve({ status: 'online', code: 200, mode: 'extension' })
    );

  test('B20: deleting an entry drops its runtime health status', async () => {
    const checkUrlHealth = checkOnline();
    const { cloudOptions } = await loadMain({
      initialState: state,
      checkUrlHealth,
    });
    fireEvent.click(document.querySelector('.url-card__button--health'));
    await waitFor(() => document.querySelector('.health--online'), 'online');

    fireEvent.click(document.querySelector('.url-card__button--delete'));
    expect(document.querySelector('.url-card__button--health')).toBeNull();

    // The same id coming back (e.g. a sync restore) must not show a stale badge.
    cloudOptions.onRestore(state);
    await flush();
    expect(document.querySelector('.url-card__button--health')).toBeTruthy();
    expect(document.querySelector('.health--online')).toBeNull();
  });

  test('B20: replacing the whole list (restore/import) drops stale health status', async () => {
    const checkUrlHealth = checkOnline();
    const { cloudOptions } = await loadMain({
      initialState: state,
      checkUrlHealth,
    });
    fireEvent.click(document.querySelector('.url-card__button--health'));
    await waitFor(() => document.querySelector('.health--online'), 'online');

    cloudOptions.onRestore({ urls: [] });
    await flush();
    cloudOptions.onRestore(state);
    await flush();
    expect(document.querySelector('.url-card__button--health')).toBeTruthy();
    expect(document.querySelector('.health--online')).toBeNull();
  });

  test('B20: a check finishing after its entry was deleted leaves no status behind', async () => {
    let finish;
    const checkUrlHealth = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { cloudOptions } = await loadMain({
      initialState: state,
      checkUrlHealth,
    });
    fireEvent.click(document.querySelector('.url-card__button--health'));
    await waitFor(() => checkUrlHealth.mock.calls.length > 0, 'check start');
    fireEvent.click(document.querySelector('.url-card__button--delete'));
    finish({ status: 'online', code: 200, mode: 'extension' });
    await flush();
    await flush();
    cloudOptions.onRestore(state);
    await flush();
    expect(document.querySelector('.health--online')).toBeNull();
  });

  test('a completed check does not trigger a save', async () => {
    const checkUrlHealth = jest.fn(() =>
      Promise.resolve({ status: 'online', code: 200, mode: 'extension' })
    );
    const { saveSecureState } = await loadMain({
      initialState: state,
      checkUrlHealth,
    });
    saveSecureState.mockClear();

    fireEvent.click(document.querySelector('.url-card__button--health'));
    await waitFor(() => checkUrlHealth.mock.calls.length > 0, 'check');
    await flush();
    await flush();
    expect(document.querySelector('.health--online')).toBeTruthy();
    expect(saveSecureState).not.toHaveBeenCalled();
  });

  test('persisted healthStatus from older data is stripped on load', async () => {
    const { saveSecureState } = await loadMain({
      initialState: {
        schemaVersion: 1,
        urls: [
          { id: 'a', url: 'https://a.example/', healthStatus: 'checking' },
        ],
      },
    });
    expect(
      lastSavedState(saveSecureState).urls[0].healthStatus
    ).toBeUndefined();
    expect(document.querySelector('.health--checking')).toBeNull();
  });

  test('a throwing check does not leave the entry stuck on checking', async () => {
    const checkUrlHealth = jest.fn(() => Promise.reject(new Error('boom')));
    await loadMain({ initialState: state, checkUrlHealth });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    fireEvent.click(document.querySelector('.url-card__button--health'));
    await waitFor(() => checkUrlHealth.mock.calls.length > 0, 'check');
    await flush();
    await flush();
    errorSpy.mockRestore();
    expect(document.querySelector('.health--checking')).toBeNull();
  });
});
