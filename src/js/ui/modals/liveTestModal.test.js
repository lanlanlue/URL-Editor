import { initLiveTestModal, openLiveTestModal } from './liveTestModal';
import * as healthCheckModule from '../../utils/healthCheck';
import { flushHistory, getHistory } from '../../core/checkHistory';

const MODAL_HTML = `
      <dialog id="live-test-modal" class="live-test-modal">
        <div class="live-test-header">
          <div class="live-test-header__top">
            <span id="live-stat-total">共 0 個網址</span>
            <span id="live-stat-online">🟢 0 正常</span>
            <span id="live-stat-offline">🔴 0 異常</span>
            <button id="live-test-close-btn">✕</button>
          </div>
          <div class="live-test-controls">
            <div class="live-test-filters">
              <button id="live-filter-all" class="live-ctrl-btn active" data-filter="all">全部</button>
              <button id="live-filter-offline" class="live-ctrl-btn" data-filter="offline">🔴 僅顯示異常</button>
              <button id="live-filter-online" class="live-ctrl-btn" data-filter="online">🟢 僅顯示正常</button>
            </div>
            <div class="live-test-layout-btns">
              <select id="live-device-select">
                <option value="desktop">Desktop</option>
                <option value="tablet">Tablet</option>
                <option value="mobile">Mobile</option>
              </select>
              <button id="live-grid-auto" class="live-ctrl-btn active" data-cols="auto">Auto</button>
              <button id="live-grid-cols2" class="live-ctrl-btn" data-cols="2">2 Cols</button>
              <button id="live-grid-cols3" class="live-ctrl-btn" data-cols="3">3 Cols</button>
              <button id="live-grid-cols1" class="live-ctrl-btn" data-cols="1">1 Col</button>
            </div>
            <button id="live-reload-all-btn">🔄 Reload All</button>
            <button id="live-recheck-health-btn">📡 Recheck</button>
          </div>
        </div>
        <div class="live-test-body">
          <div id="live-test-grid" class="live-test-grid live-grid--auto"></div>
          <div id="live-test-empty-msg" class="live-test-empty hidden">No URLs</div>
        </div>
      </dialog>
    `;

describe('liveTestModal', () => {
  let mockUrls;

  beforeEach(() => {
    document.body.innerHTML = `
      <dialog id="live-test-modal" class="live-test-modal">
        <div class="live-test-header">
          <div class="live-test-header__top">
            <span id="live-stat-total">共 0 個網址</span>
            <span id="live-stat-online">🟢 0 正常</span>
            <span id="live-stat-offline">🔴 0 異常</span>
            <button id="live-test-close-btn">✕</button>
          </div>
          <div class="live-test-controls">
            <div class="live-test-filters">
              <button id="live-filter-all" class="live-ctrl-btn active" data-filter="all">全部</button>
              <button id="live-filter-offline" class="live-ctrl-btn" data-filter="offline">🔴 僅顯示異常</button>
              <button id="live-filter-online" class="live-ctrl-btn" data-filter="online">🟢 僅顯示正常</button>
            </div>
            <div class="live-test-layout-btns">
              <select id="live-device-select">
                <option value="desktop">Desktop</option>
                <option value="tablet">Tablet</option>
                <option value="mobile">Mobile</option>
              </select>
              <button id="live-grid-auto" class="live-ctrl-btn active" data-cols="auto">Auto</button>
              <button id="live-grid-cols2" class="live-ctrl-btn" data-cols="2">2 Cols</button>
              <button id="live-grid-cols3" class="live-ctrl-btn" data-cols="3">3 Cols</button>
              <button id="live-grid-cols1" class="live-ctrl-btn" data-cols="1">1 Col</button>
            </div>
            <button id="live-reload-all-btn">🔄 Reload All</button>
            <button id="live-recheck-health-btn">📡 Recheck</button>
          </div>
        </div>
        <div class="live-test-body">
          <div id="live-test-grid" class="live-test-grid live-grid--auto"></div>
          <div id="live-test-empty-msg" class="live-test-empty hidden">No URLs</div>
        </div>
      </dialog>
    `;

    mockUrls = [
      {
        id: 'url-1',
        url: 'https://example.com/page1',
        label: 'Example 1',
        healthStatus: 'online',
      },
      {
        id: 'url-2',
        url: 'https://broken-url-xyz.invalid',
        label: 'Broken Site',
        healthStatus: 'offline',
      },
    ];

    jest
      .spyOn(healthCheckModule, 'checkUrlHealth')
      .mockImplementation(async (url) => {
        if (url.includes('broken')) {
          return { status: 'offline', error: 'Failed' };
        }
        return { status: 'online', code: 200 };
      });

    initLiveTestModal();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('should open modal and render iframe cards for all selected URLs', async () => {
    openLiveTestModal({ urls: mockUrls });

    const grid = document.getElementById('live-test-grid');
    const cards = grid.querySelectorAll('.live-test-card');

    expect(cards.length).toBe(2);

    const iframes = grid.querySelectorAll('iframe.live-test-iframe');
    expect(iframes.length).toBe(2);
    expect(iframes[0].src).toBe('https://example.com/page1');
    expect(iframes[1].src).toBe('https://broken-url-xyz.invalid/');
  });

  test('should highlight offline URL card with offline class and alert banner', async () => {
    openLiveTestModal({ urls: mockUrls });

    // Wait for health check promises to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    const brokenCard = document.querySelector(
      '[data-url-id="url-2"].live-test-card'
    );
    expect(brokenCard).not.toBeNull();
    expect(brokenCard.classList.contains('live-test-card--offline')).toBe(true);

    const alertBanner = brokenCard.querySelector('.live-card-alert');
    expect(alertBanner).not.toBeNull();

    const offlineBadge = brokenCard.querySelector('.live-badge--offline');
    expect(offlineBadge).not.toBeNull();
  });

  test('should filter cards by offline/online status', async () => {
    openLiveTestModal({ urls: mockUrls });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const filterOfflineBtn = document.getElementById('live-filter-offline');
    filterOfflineBtn.click();

    let grid = document.getElementById('live-test-grid');
    let cards = grid.querySelectorAll('.live-test-card');
    expect(cards.length).toBe(1);
    expect(cards[0].dataset.urlId).toBe('url-2');

    const filterOnlineBtn = document.getElementById('live-filter-online');
    filterOnlineBtn.click();

    cards = grid.querySelectorAll('.live-test-card');
    expect(cards.length).toBe(1);
    expect(cards[0].dataset.urlId).toBe('url-1');

    const filterAllBtn = document.getElementById('live-filter-all');
    filterAllBtn.click();

    cards = grid.querySelectorAll('.live-test-card');
    expect(cards.length).toBe(2);
  });

  test('should change grid columns when clicking layout buttons', () => {
    openLiveTestModal({ urls: mockUrls });

    const grid = document.getElementById('live-test-grid');
    const cols2Btn = document.getElementById('live-grid-cols2');
    const cols1Btn = document.getElementById('live-grid-cols1');

    cols2Btn.click();
    expect(grid.classList.contains('live-grid--cols-2')).toBe(true);

    cols1Btn.click();
    expect(grid.classList.contains('live-grid--cols-1')).toBe(true);
  });

  test('should show empty message when opened with empty list', () => {
    openLiveTestModal({ urls: [] });

    const emptyMsg = document.getElementById('live-test-empty-msg');
    expect(emptyMsg.classList.contains('hidden')).toBe(false);
  });
});

describe('liveTestModal races and caching', () => {
  const flushAsync = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };

  // Each checkUrlHealth call returns a promise the test settles by hand.
  function deferredChecks() {
    const calls = [];
    jest.spyOn(healthCheckModule, 'checkUrlHealth').mockImplementation(
      (url) =>
        new Promise((resolve) => {
          calls.push({ url, resolve });
        })
    );
    return calls;
  }

  const makeUrls = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: `r${i}`,
      url: `https://site${i}.example.com/`,
      label: `Site ${i}`,
    }));

  beforeEach(() => {
    document.body.innerHTML = MODAL_HTML;
    initLiveTestModal();
    document.getElementById('live-filter-all').click();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('two quick reload clicks keep the original iframe source', () => {
    jest.useFakeTimers();
    deferredChecks();
    openLiveTestModal({ urls: makeUrls(1) });
    const iframe = document.querySelector('iframe.live-test-iframe');
    const original = iframe.src;
    const reloadBtn = document.querySelectorAll('.live-card-btn')[1];

    reloadBtn.click();
    expect(iframe.src).toBe('about:blank');
    reloadBtn.click();
    jest.advanceTimersByTime(500);
    expect(iframe.src).toBe(original);
  });

  test('a recheck supersedes the previous run: stale results are ignored and queued checks skipped', async () => {
    const calls = deferredChecks();
    openLiveTestModal({ urls: makeUrls(8) });
    await flushAsync();
    expect(calls).toHaveLength(6); // run 1, concurrency cap
    const firstRun = calls.splice(0, 6);

    document.getElementById('live-recheck-health-btn').click();
    await flushAsync();
    const secondRun = calls.splice(0, 6);
    expect(secondRun).toHaveLength(6);

    // Fresh run reports online for the first site, then the old run lands late.
    secondRun[0].resolve({ status: 'online', code: 200 });
    await flushAsync();
    firstRun[0].resolve({ status: 'offline', error: 'late and stale' });
    await flushAsync();
    const badge = document.getElementById('live-badge-r0');
    expect(badge.className).toContain('live-badge--online');

    // Old workers must not start the two entries still queued in run 1.
    firstRun.slice(1).forEach((c) => c.resolve({ status: 'online' }));
    secondRun.slice(1).forEach((c) => c.resolve({ status: 'online' }));
    await flushAsync();
    // Run 2 starts all 8 entries; run 1 only the 6 it had already started.
    // calls now holds the late starts of both runs (2 from run 2, 0 from run 1).
    const started = 6 + 6 + calls.length;
    expect(started).toBe(14);
  });

  test('closing the modal cancels the run: late results do not rebuild the grid', async () => {
    const calls = deferredChecks();
    document.getElementById('live-filter-offline').click();
    openLiveTestModal({ urls: makeUrls(2) });
    await flushAsync();
    document.getElementById('live-test-close-btn').click();
    const grid = document.getElementById('live-test-grid');
    expect(grid.children).toHaveLength(0);

    calls.forEach((c) => c.resolve({ status: 'offline', error: 'x' }));
    await flushAsync();
    expect(grid.querySelectorAll('.live-test-card')).toHaveLength(0);
  });

  test('re-rendering after a filter click restores badge details and embed-blocked notice', async () => {
    jest.spyOn(healthCheckModule, 'checkUrlHealth').mockResolvedValue({
      status: 'online',
      code: 200,
      timeMs: 42,
      embeddable: false,
    });
    openLiveTestModal({ urls: makeUrls(2) });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(document.querySelectorAll('.live-embed-blocked')).toHaveLength(2);

    document.getElementById('live-filter-online').click();
    expect(document.querySelectorAll('.live-test-card')).toHaveLength(2);
    expect(document.querySelectorAll('.live-embed-blocked')).toHaveLength(2);
    expect(
      document
        .getElementById('live-badge-r0')
        .querySelector('.live-badge__text').textContent
    ).toContain('200');
  });

  test('entry.healthStatus is ignored: everything starts as checking', async () => {
    deferredChecks();
    openLiveTestModal({
      urls: [
        { id: 'h1', url: 'https://h.example.com/', healthStatus: 'offline' },
      ],
    });
    await flushAsync();
    expect(document.getElementById('live-badge-h1').className).toContain(
      'live-badge--checking'
    );
    expect(document.getElementById('live-stat-offline').textContent).toContain(
      '0'
    );
    document.getElementById('live-filter-offline').click();
    expect(document.querySelectorAll('.live-test-card')).toHaveLength(0);
  });
});

describe('liveTestModal rework (G2)', () => {
  const flushAsync = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  function deferredChecks() {
    const calls = [];
    jest.spyOn(healthCheckModule, 'checkUrlHealth').mockImplementation(
      (url) =>
        new Promise((resolve, reject) => {
          calls.push({ url, resolve, reject });
        })
    );
    return calls;
  }
  const makeUrls = (n, prefix = 'g') =>
    Array.from({ length: n }, (_, i) => ({
      id: `${prefix}${i}`,
      url: `https://${prefix}${i}.example.com/`,
      label: `Site ${i}`,
    }));
  const cardCount = () => document.querySelectorAll('.live-test-card').length;

  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = MODAL_HTML;
    initLiveTestModal();
    document.getElementById('live-filter-all').click();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('a late async close event does not wipe a run reopened right after closing', async () => {
    deferredChecks();
    const dialog = document.getElementById('live-test-modal');
    openLiveTestModal({ urls: makeUrls(1) });
    document.getElementById('live-test-close-btn').click();
    openLiveTestModal({ urls: makeUrls(2) });
    dialog.dispatchEvent(new Event('close')); // browsers fire it asynchronously
    await flushAsync();
    expect(cardCount()).toBe(2);
  });

  // jsdom has no dialog.close(); emulate the browser: drop `open`, then fire
  // `close` asynchronously (a queued task), without any `cancel` event.
  function installAsyncClose(dialog) {
    dialog.close = () => {
      dialog.removeAttribute('open');
      setTimeout(() => dialog.dispatchEvent(new Event('close')), 0);
    };
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  test('programmatic dialog.close() cancels the run and clears the grid', async () => {
    const calls = deferredChecks();
    const dialog = document.getElementById('live-test-modal');
    installAsyncClose(dialog);
    const urls = makeUrls(2, 'pc');
    openLiveTestModal({ urls });
    await flushAsync();
    expect(cardCount()).toBe(2);
    dialog.close();
    await tick(); // the close event has fired
    expect(cardCount()).toBe(0);
    calls.forEach((c) => c.resolve({ status: 'online', code: 200 }));
    await flushAsync();
    flushHistory();
    expect(cardCount()).toBe(0);
    urls.forEach((u) => expect(getHistory(u.id)).toEqual([]));
  });

  test('programmatic close then immediate reopen keeps the new run', async () => {
    const calls = deferredChecks();
    const dialog = document.getElementById('live-test-modal');
    installAsyncClose(dialog);
    openLiveTestModal({ urls: makeUrls(1, 'ro') });
    dialog.close();
    openLiveTestModal({ urls: makeUrls(2, 'rn') });
    await tick(); // the async close event of the FIRST close lands now
    expect(cardCount()).toBe(2);
    calls
      .filter((c) => c.url.includes('rn'))
      .forEach((c) => c.resolve({ status: 'online', code: 200 }));
    await flushAsync();
    flushHistory();
    expect(cardCount()).toBe(2);
    expect(getHistory('rn0')).toHaveLength(1);
    expect(getHistory('rn1')).toHaveLength(1);
  });

  test('superseded runs record no history; the current run records once', async () => {
    const calls = deferredChecks();
    const urls = makeUrls(2);
    openLiveTestModal({ urls });
    openLiveTestModal({ urls });
    document.getElementById('live-recheck-health-btn').click();
    await flushAsync();
    expect(calls).toHaveLength(6); // 3 runs x 2 entries, all in flight
    calls.forEach((c) => c.resolve({ status: 'online', code: 200 }));
    await flushAsync();
    flushHistory();
    urls.forEach((u) => expect(getHistory(u.id)).toHaveLength(1));
  });

  test('opening a new list cancels the previous run for ids no longer shown', async () => {
    const calls = deferredChecks();
    openLiveTestModal({ urls: makeUrls(1, 'old') });
    openLiveTestModal({ urls: makeUrls(1, 'new') });
    await flushAsync();
    const oldCall = calls.find((c) => c.url.includes('old0'));
    oldCall.resolve({ status: 'online', code: 200 });
    await flushAsync();
    flushHistory();
    expect(getHistory('old0')).toEqual([]);
  });

  test('entry.healthStatus never seeds the first render', () => {
    deferredChecks();
    document.getElementById('live-filter-online').click();
    openLiveTestModal({
      urls: [
        { id: 'p1', url: 'https://p.example.com/', healthStatus: 'online' },
      ],
    });
    // A persisted-looking healthStatus must not make the card appear as online.
    expect(cardCount()).toBe(0);
  });

  test('a rejected single-card check does not leave the card on checking', async () => {
    const calls = deferredChecks();
    openLiveTestModal({ urls: makeUrls(1) });
    await flushAsync();
    calls.forEach((c) => c.resolve({ status: 'online', code: 200 }));
    await flushAsync();
    document.querySelectorAll('.live-card-btn')[1].click(); // reload card
    await flushAsync();
    calls[calls.length - 1].reject(new Error('network down'));
    await flushAsync();
    const badge = document.getElementById('live-badge-g0');
    expect(badge.className).toContain('live-badge--offline');
    expect(badge.className).not.toContain('checking');
  });
});
