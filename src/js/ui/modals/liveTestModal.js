import i18next from '../../core/i18n';
import { checkUrlHealth } from '../../utils/healthCheck';
import { createFaviconImg } from '../../utils/faviconService';

let currentUrls = [];
let healthResults = new Map(); // id -> { status: 'checking'|'online'|'offline', code, error }
let currentFilter = 'all'; // 'all' | 'offline' | 'online'
let currentCols = 'auto'; // 'auto' | '1' | '2' | '3'
let currentDevice = 'desktop'; // 'desktop' | 'tablet' | 'mobile'

/**
 * Initializes the Live Test Modal listeners and controls.
 */
export function initLiveTestModal() {
  const dialog = document.getElementById('live-test-modal');
  if (!dialog) return;

  const closeBtn = document.getElementById('live-test-close-btn');
  const reloadAllBtn = document.getElementById('live-reload-all-btn');
  const recheckHealthBtn = document.getElementById('live-recheck-health-btn');
  const deviceSelect = document.getElementById('live-device-select');

  // Close handlers
  const handleClose = () => {
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
      dialog.classList.add('hidden');
    }
    // Stop all running iframes to free memory
    const grid = document.getElementById('live-test-grid');
    if (grid) grid.innerHTML = '';
  };

  if (closeBtn) closeBtn.addEventListener('click', handleClose);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) handleClose();
  });

  dialog.addEventListener('cancel', () => {
    const grid = document.getElementById('live-test-grid');
    if (grid) grid.innerHTML = '';
  });

  // Filter Buttons
  const filterBtns = dialog.querySelectorAll(
    '.live-test-filters .live-ctrl-btn'
  );
  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter || 'all';
      renderGrid();
    });
  });

  // Grid Layout Buttons
  const gridBtns = dialog.querySelectorAll(
    '.live-test-layout-btns .live-ctrl-btn'
  );
  gridBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      gridBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentCols = btn.dataset.cols || 'auto';
      updateGridLayout();
    });
  });

  // Device Width Selector
  if (deviceSelect) {
    deviceSelect.addEventListener('change', () => {
      currentDevice = deviceSelect.value || 'desktop';
      updateDeviceFrames();
    });
  }

  // Reload All Iframes
  if (reloadAllBtn) {
    reloadAllBtn.addEventListener('click', () => {
      reloadAllIframes();
      checkAllHealth();
    });
  }

  // Recheck Health Button
  if (recheckHealthBtn) {
    recheckHealthBtn.addEventListener('click', () => {
      checkAllHealth();
    });
  }
}

/**
 * Opens the Live Test Modal with the given URLs.
 * @param {object} params
 * @param {Array<object>} params.urls - Array of URL entry objects
 */
export function openLiveTestModal({ urls = [] }) {
  currentUrls = Array.isArray(urls) ? urls : [];
  healthResults.clear();

  // Populate initial health status from entry data if available
  currentUrls.forEach((entry) => {
    healthResults.set(entry.id, {
      status: entry.healthStatus || 'checking',
      code: null,
      error: null,
    });
  });

  const dialog = document.getElementById('live-test-modal');
  if (!dialog) return;

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', 'true');
    dialog.classList.remove('hidden');
  }

  renderGrid();
  checkAllHealth();
}

/**
 * Renders the preview cards grid according to current filter and state.
 */
function renderGrid() {
  const grid = document.getElementById('live-test-grid');
  const emptyMsg = document.getElementById('live-test-empty-msg');
  if (!grid) return;

  updateGridLayout();
  updateStatsCounters();

  if (currentUrls.length === 0) {
    grid.innerHTML = '';
    if (emptyMsg) emptyMsg.classList.remove('hidden');
    return;
  }

  if (emptyMsg) emptyMsg.classList.add('hidden');

  const filteredUrls = currentUrls.filter((entry) => {
    const result = healthResults.get(entry.id) || {};
    const status = result.status || entry.healthStatus;
    if (currentFilter === 'offline') return status === 'offline';
    if (currentFilter === 'online') return status === 'online';
    return true;
  });

  grid.innerHTML = '';

  if (filteredUrls.length === 0) {
    const noMatch = document.createElement('div');
    noMatch.className = 'live-test-empty';
    noMatch.textContent =
      currentFilter === 'offline'
        ? '🎉 太棒了！沒有任何連線異常的 URL。'
        : '沒有符合篩選條件的項目。';
    grid.appendChild(noMatch);
    return;
  }

  filteredUrls.forEach((entry) => {
    grid.appendChild(_createLiveTestCard(entry));
  });
}

/**
 * Creates an individual iframe preview card for a URL entry.
 * @param {object} entry
 * @returns {HTMLElement}
 */
function _createLiveTestCard(entry) {
  const { id, url, label = '' } = entry;
  const result = healthResults.get(id) || { status: 'checking' };
  const status = result.status;

  const card = document.createElement('div');
  card.className = `live-test-card ${
    status === 'offline'
      ? 'live-test-card--offline'
      : status === 'online'
        ? 'live-test-card--online'
        : ''
  }`;
  card.dataset.urlId = id;

  // ── Header Row ──────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'live-test-card__header';

  // Info: Favicon + Title + URL
  const info = document.createElement('div');
  info.className = 'live-test-card__info';

  const favicon = _createFavicon(url);
  const titleBox = document.createElement('div');
  titleBox.className = 'live-test-card__title-box';

  const labelEl = document.createElement('span');
  labelEl.className = 'live-test-card__label';
  labelEl.textContent = label || _extractDomainOrPath(url);

  const urlEl = document.createElement('code');
  urlEl.className = 'live-test-card__url';
  urlEl.textContent = url;
  urlEl.title = i18next.t('liveTest.actions.copyUrl', {
    defaultValue: '點擊複製網址',
  });
  urlEl.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      const orig = urlEl.textContent;
      urlEl.textContent = '✅ 已複製！';
      setTimeout(() => {
        urlEl.textContent = orig;
      }, 1200);
    });
  });

  titleBox.appendChild(labelEl);
  titleBox.appendChild(urlEl);

  info.appendChild(favicon);
  info.appendChild(titleBox);

  // Actions & Badge
  const actions = document.createElement('div');
  actions.className = 'live-test-card__actions';

  // Status Badge
  const badge = document.createElement('span');
  badge.className = `live-badge live-badge--${status}`;
  badge.id = `live-badge-${id}`;
  const dot = document.createElement('span');
  dot.className = 'live-badge__dot';
  const badgeText = document.createElement('span');
  badgeText.className = 'live-badge__text';
  badgeText.textContent = _getStatusText(status);

  badge.appendChild(dot);
  badge.appendChild(badgeText);

  // Reload button
  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'live-card-btn';
  reloadBtn.textContent = '🔄';
  reloadBtn.title = i18next.t('liveTest.actions.reloadIframe', {
    defaultValue: '重新載入此頁面',
  });
  reloadBtn.addEventListener('click', () => {
    _reloadSingleCard(card, entry);
  });

  // Open in new tab button
  const openBtn = document.createElement('button');
  openBtn.className = 'live-card-btn';
  openBtn.textContent = '↗';
  openBtn.title = i18next.t('liveTest.actions.openNewTab', {
    defaultValue: '在新分頁開啟',
  });
  openBtn.addEventListener('click', () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  actions.appendChild(badge);
  actions.appendChild(reloadBtn);
  actions.appendChild(openBtn);

  header.appendChild(info);
  header.appendChild(actions);
  card.appendChild(header);

  // ── Offline Warning Alert (if offline) ────────────────────────
  if (status === 'offline') {
    const alertBanner = document.createElement('div');
    alertBanner.className = 'live-card-alert';
    alertBanner.id = `live-alert-${id}`;
    alertBanner.innerHTML = `
      <span>⚠️ ${i18next.t('liveTest.status.offlineWarn', { defaultValue: '無法連線至此網站！請確認網址或伺服器狀態。' })}</span>
    `;
    card.appendChild(alertBanner);
  }

  // ── Iframe Container & Frame ────────────────────────────────
  const iframeWrapper = document.createElement('div');
  iframeWrapper.className = 'live-test-iframe-wrapper';

  const frameHolder = document.createElement('div');
  frameHolder.className = `device-frame--${currentDevice}`;
  frameHolder.id = `device-frame-${id}`;
  frameHolder.style.width = '100%';
  frameHolder.style.height = '100%';

  const iframe = document.createElement('iframe');
  iframe.className = 'live-test-iframe';
  iframe.title = label || url;
  iframe.setAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-forms allow-popups allow-downloads'
  );
  iframe.loading = 'lazy';

  let formattedUrl = url.trim();
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = 'https://' + formattedUrl;
  }
  iframe.src = formattedUrl;

  frameHolder.appendChild(iframe);
  iframeWrapper.appendChild(frameHolder);

  card.appendChild(iframeWrapper);

  return card;
}

/**
 * Reloads a single card's iframe and re-runs its connectivity check.
 */
async function _reloadSingleCard(card, entry) {
  const { id, url } = entry;
  const iframe = card.querySelector('iframe');
  if (iframe) {
    const currentSrc = iframe.src;
    iframe.src = 'about:blank';
    setTimeout(() => {
      iframe.src = currentSrc;
    }, 100);
  }

  // Update badge to checking
  _updateCardStatus(id, 'checking');
  const res = await checkUrlHealth(url);
  healthResults.set(id, res);
  _updateCardStatus(id, res.status);
  updateStatsCounters();
}

/**
 * Reloads all rendered iframes in the grid.
 */
function reloadAllIframes() {
  const iframes = document.querySelectorAll('.live-test-iframe');
  iframes.forEach((iframe) => {
    const src = iframe.src;
    iframe.src = 'about:blank';
    setTimeout(() => {
      iframe.src = src;
    }, 100);
  });
}

/**
 * Runs connectivity check for all URLs in parallel and updates badges in real time.
 */
async function checkAllHealth() {
  currentUrls.forEach((entry) => {
    healthResults.set(entry.id, { status: 'checking' });
    _updateCardStatus(entry.id, 'checking');
  });

  updateStatsCounters();

  // Run all health checks concurrently
  await Promise.allSettled(
    currentUrls.map(async (entry) => {
      try {
        const res = await checkUrlHealth(entry.url);
        healthResults.set(entry.id, res);
        _updateCardStatus(entry.id, res.status);
      } catch (err) {
        healthResults.set(entry.id, { status: 'offline', error: err.message });
        _updateCardStatus(entry.id, 'offline');
      }
      updateStatsCounters();
    })
  );

  // If in filtered mode, re-render to reflect new offline/online statuses
  if (currentFilter !== 'all') {
    renderGrid();
  }
}

/**
 * Live-updates a single card's badge and border without re-mounting the whole iframe.
 */
function _updateCardStatus(id, status) {
  const card = document.querySelector(`[data-url-id="${id}"].live-test-card`);
  const badge = document.getElementById(`live-badge-${id}`);
  if (!badge) return;

  badge.className = `live-badge live-badge--${status}`;
  const textSpan = badge.querySelector('.live-badge__text');
  if (textSpan) textSpan.textContent = _getStatusText(status);

  if (card) {
    card.classList.remove('live-test-card--offline', 'live-test-card--online');
    if (status === 'offline') {
      card.classList.add('live-test-card--offline');
      if (!card.querySelector('.live-card-alert')) {
        const alertBanner = document.createElement('div');
        alertBanner.className = 'live-card-alert';
        alertBanner.id = `live-alert-${id}`;
        alertBanner.innerHTML = `
          <span>⚠️ ${i18next.t('liveTest.status.offlineWarn', { defaultValue: '無法連線至此網站！請確認網址或伺服器狀態。' })}</span>
        `;
        const header = card.querySelector('.live-test-card__header');
        if (header && header.nextSibling) {
          card.insertBefore(alertBanner, header.nextSibling);
        } else {
          card.appendChild(alertBanner);
        }
      }
    } else if (status === 'online') {
      card.classList.add('live-test-card--online');
      const alertBanner = card.querySelector('.live-card-alert');
      if (alertBanner) alertBanner.remove();
    } else {
      const alertBanner = card.querySelector('.live-card-alert');
      if (alertBanner) alertBanner.remove();
    }
  }
}

/**
 * Updates grid column class on the container.
 */
function updateGridLayout() {
  const grid = document.getElementById('live-test-grid');
  if (!grid) return;

  grid.classList.remove(
    'live-grid--auto',
    'live-grid--cols-1',
    'live-grid--cols-2',
    'live-grid--cols-3'
  );

  if (currentCols === '1') {
    grid.classList.add('live-grid--cols-1');
  } else if (currentCols === '2') {
    grid.classList.add('live-grid--cols-2');
  } else if (currentCols === '3') {
    grid.classList.add('live-grid--cols-3');
  } else {
    grid.classList.add('live-grid--auto');
  }
}

/**
 * Updates device emulation widths on all frame holders.
 */
function updateDeviceFrames() {
  const frames = document.querySelectorAll('[id^="device-frame-"]');
  frames.forEach((frame) => {
    frame.className = `device-frame--${currentDevice}`;
  });
}

/**
 * Updates statistics counters and filter tab counts in the modal header.
 */
function updateStatsCounters() {
  const totalPill = document.getElementById('live-stat-total');
  const onlinePill = document.getElementById('live-stat-online');
  const offlinePill = document.getElementById('live-stat-offline');

  let onlineCount = 0;
  let offlineCount = 0;

  currentUrls.forEach((entry) => {
    const res = healthResults.get(entry.id) || {};
    const status = res.status || entry.healthStatus;
    if (status === 'online') onlineCount++;
    else if (status === 'offline') offlineCount++;
  });

  const total = currentUrls.length;

  if (totalPill) {
    totalPill.textContent = i18next.t('liveTest.stats.total', {
      count: total,
      defaultValue: `共 ${total} 個網址`,
    });
  }
  if (onlinePill) {
    onlinePill.textContent = i18next.t('liveTest.stats.online', {
      count: onlineCount,
      defaultValue: `🟢 ${onlineCount} 正常`,
    });
  }
  if (offlinePill) {
    offlinePill.textContent = i18next.t('liveTest.stats.offline', {
      count: offlineCount,
      defaultValue: `🔴 ${offlineCount} 異常`,
    });
  }

  // Update filter buttons
  const btnAll = document.getElementById('live-filter-all');
  const btnOffline = document.getElementById('live-filter-offline');
  const btnOnline = document.getElementById('live-filter-online');

  if (btnAll) {
    btnAll.textContent = i18next.t('liveTest.filter.all', {
      count: total,
      defaultValue: `全部 (${total})`,
    });
  }
  if (btnOffline) {
    btnOffline.textContent = i18next.t('liveTest.filter.offline', {
      count: offlineCount,
      defaultValue: `🔴 僅顯示異常 (${offlineCount})`,
    });
  }
  if (btnOnline) {
    btnOnline.textContent = i18next.t('liveTest.filter.online', {
      count: onlineCount,
      defaultValue: `🟢 僅顯示正常 (${onlineCount})`,
    });
  }
}

function _getStatusText(status) {
  if (status === 'online') {
    return i18next.t('liveTest.status.online', { defaultValue: '🟢 線上正常' });
  }
  if (status === 'offline') {
    return i18next.t('liveTest.status.offline', {
      defaultValue: '🔴 連線異常',
    });
  }
  return i18next.t('liveTest.status.checking', {
    defaultValue: '⏳ 檢測中...',
  });
}

function _extractDomainOrPath(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname : '');
  } catch (e) {
    return url;
  }
}

/**
 * Creates a favicon <img> for a live-test card.
 * Delegates to the shared offline-aware faviconService.
 * @param {string} url - Full URL of the site.
 * @returns {HTMLImageElement}
 */
function _createFavicon(url) {
  return createFaviconImg(url, 'live-test-card__favicon');
}
