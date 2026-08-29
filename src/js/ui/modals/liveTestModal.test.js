import { initLiveTestModal, openLiveTestModal } from './liveTestModal';
import * as healthCheckModule from '../../utils/healthCheck';

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
