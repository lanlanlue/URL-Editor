import i18next from '../../core/i18n';
import { checkManyUrls, checkUrlHealth } from '../../utils/healthCheck';
import { requestHostPermissions } from '../../core/extensionBridge';
import { normalizeAssertions } from '../../core/assertions';
import { buildResultsCsv, getHistory } from '../../core/checkHistory';
import { runEntryCheck } from '../../core/entryCheck';
import { createFaviconImg } from '../../utils/faviconService';

let currentUrls = [];
let healthResults = new Map(); // id -> { status: 'checking'|'online'|'offline', code, error }
let currentFilter = 'all'; // 'all' | 'offline' | 'online'
let currentCols = 'auto'; // 'auto' | '1' | '2' | '3'
let currentDevice = 'desktop'; // 'desktop' | 'tablet' | 'mobile'
let onEntryChange = () => {};
// id -> token object of the newest check for that entry. A result is applied
// only while its token is still the current one, so overlapping runs, single
// card rechecks and results arriving after close/reopen are ignored.
const checkTokens = new Map();
const RELOAD_BLANK_MS = 100;

function _claimCheck(id) {
  const token = {};
  checkTokens.set(id, token);
  return token;
}

function _isCurrentCheck(id, token) {
  return checkTokens.get(id) === token;
}

/** Invalidates every in-flight check (close, reopen). */
function _cancelChecks() {
  checkTokens.clear();
}

/**
 * Reloads an iframe from the source stored at creation (never from the live
 * `src`, which is about:blank while a previous reload is pending).
 */
function _reloadIframe(iframe) {
  const target = iframe.dataset.liveSrc;
  if (!target) return;
  clearTimeout(iframe._liveReloadTimer);
  iframe.src = 'about:blank';
  iframe._liveReloadTimer = setTimeout(() => {
    iframe._liveReloadTimer = null;
    if (iframe.isConnected) iframe.src = target;
  }, RELOAD_BLANK_MS);
}

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
    stopAndClear();
  };

  // Stop all running iframes to free memory and cancel in-flight checks.
  const stopAndClear = () => {
    _cancelChecks();
    const grid = document.getElementById('live-test-grid');
    if (grid) grid.innerHTML = '';
  };

  if (closeBtn) closeBtn.addEventListener('click', handleClose);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) handleClose();
  });

  dialog.addEventListener('cancel', stopAndClear);

  // Any other close path (programmatic dialog.close(), a skipped `cancel`)
  // still ends with an async `close` event. It may be delivered AFTER the
  // dialog was reopened for a new run (openLiveTestModal already cancelled the
  // old run and rebuilt the grid), so only act while the dialog is really
  // closed: a still-open dialog means a newer run owns the grid.
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    stopAndClear();
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
      recheckWithPermissions();
    });
  }

  // Export latest results as CSV
  const exportBtn = document.getElementById('live-export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportResults);
  }

  // Recheck Health Button
  if (recheckHealthBtn) {
    recheckHealthBtn.addEventListener('click', () => {
      recheckWithPermissions();
    });
  }
}

/**
 * Opens the Live Test Modal with the given URLs.
 * @param {object} params
 * @param {Array<object>} params.urls - Array of URL entry objects
 * @param {function} [params.onChange] - called after an entry's assertions change
 */
export function openLiveTestModal({ urls = [], onChange } = {}) {
  currentUrls = Array.isArray(urls) ? urls : [];
  onEntryChange = typeof onChange === 'function' ? onChange : () => {};
  healthResults.clear();
  _cancelChecks();

  // Health status is runtime-only; every entry starts as 'checking'.
  currentUrls.forEach((entry) => {
    healthResults.set(entry.id, {
      status: 'checking',
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
    const status = result.status;
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
        ? i18next.t('liveTest.empty.noOffline', {
            defaultValue: '🎉 太棒了！沒有任何連線異常的 URL。',
          })
        : i18next.t('liveTest.empty.noMatch', {
            defaultValue: '沒有符合篩選條件的項目。',
          });
    grid.appendChild(noMatch);
    return;
  }

  filteredUrls.forEach((entry) => {
    grid.appendChild(_createLiveTestCard(entry));
  });

  // Cards are rebuilt: restore badge details, history tags, grant buttons and
  // embedding-blocked notices from the cached results.
  filteredUrls.forEach((entry) => {
    const cached = healthResults.get(entry.id);
    if (cached && cached.status && cached.status !== 'checking') {
      _applyResultDetails(entry, cached);
    }
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
      urlEl.textContent = i18next.t('liveTest.actions.copied', {
        defaultValue: '✅ 已複製！',
      });
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

  const assertBtn = document.createElement('button');
  assertBtn.className = 'live-card-btn';
  assertBtn.textContent = normalizeAssertions(entry.assertions) ? '🎯' : '⚙';
  assertBtn.id = `live-assert-btn-${id}`;
  assertBtn.title = i18next.t('liveTest.assert.title', {
    defaultValue: '測試斷言',
  });
  assertBtn.addEventListener('click', () => {
    const panel = card.querySelector('.live-assert-panel');
    if (panel) panel.remove();
    else header.after(_createAssertionPanel(entry, card, assertBtn));
  });

  actions.appendChild(badge);
  actions.appendChild(assertBtn);
  actions.appendChild(reloadBtn);
  actions.appendChild(openBtn);

  header.appendChild(info);
  header.appendChild(actions);
  card.appendChild(header);

  const historyEl = document.createElement('div');
  historyEl.className = 'live-card-history';
  historyEl.id = `live-history-${id}`;
  card.appendChild(historyEl);
  _renderHistory(id);

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
  iframe.dataset.liveSrc = formattedUrl;
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
  const { id } = entry;
  const iframe = card.querySelector('iframe');
  if (iframe) _reloadIframe(iframe);

  // Update badge to checking
  const token = _claimCheck(id);
  _updateCardStatus(id, 'checking');
  let res;
  try {
    res = await runEntryCheck(entry, (u, t, o) => checkUrlHealth(u, t, o), {
      isCurrent: () => _isCurrentCheck(id, token),
    });
  } catch (err) {
    // Never leave the card on 'checking' when the check itself rejects.
    res = { status: 'offline', error: err?.message || String(err) };
  }
  if (!_isCurrentCheck(id, token)) return;
  healthResults.set(id, res);
  _updateCardStatus(id, res.status);
  _applyResultDetails(entry, res);
  updateStatsCounters();
}

/**
 * Reloads all rendered iframes in the grid.
 */
function reloadAllIframes() {
  const iframes = document.querySelectorAll('.live-test-iframe');
  iframes.forEach(_reloadIframe);
}

/**
 * Called from a click handler. In the extension, asks once for host access to
 * every origin that could only be checked in limited mode, then rechecks.
 */
async function recheckWithPermissions() {
  const missing = currentUrls.filter(
    (entry) => healthResults.get(entry.id)?.needsPermission
  );
  // Must run before any await so the click's user gesture is still valid.
  const pending = missing.length
    ? requestHostPermissions(missing.map((entry) => entry.url))
    : null;
  if (pending) await pending;
  await checkAllHealth();
}

/**
 * Runs connectivity checks (capped concurrency) and updates cards live.
 */
async function checkAllHealth() {
  const entries = currentUrls;
  const tokens = new Map();
  entries.forEach((entry) => {
    tokens.set(entry.id, _claimCheck(entry.id));
    healthResults.set(entry.id, { status: 'checking' });
    _updateCardStatus(entry.id, 'checking');
  });

  updateStatsCounters();

  await checkManyUrls(entries, {
    run: (entry) => {
      // Superseded or cancelled: don't start (or record) another request.
      if (!_isCurrentCheck(entry.id, tokens.get(entry.id))) {
        return Promise.resolve({ status: 'checking', stale: true });
      }
      return runEntryCheck(
        entry,
        (url, timeoutMs, options) => checkUrlHealth(url, timeoutMs, options),
        { isCurrent: () => _isCurrentCheck(entry.id, tokens.get(entry.id)) }
      );
    },
    onResult: (entry, res) => {
      if (!_isCurrentCheck(entry.id, tokens.get(entry.id))) return;
      healthResults.set(entry.id, res);
      _updateCardStatus(entry.id, res.status);
      _applyResultDetails(entry, res);
      updateStatsCounters();
    },
  });

  // If in filtered mode, re-render to reflect new offline/online statuses
  const stillCurrent = entries.some((entry) =>
    _isCurrentCheck(entry.id, tokens.get(entry.id))
  );
  if (stillCurrent && currentFilter !== 'all') {
    renderGrid();
  }
}

/**
 * Adds status code / timing to the badge, a grant-access button when the
 * extension could give exact results, and a notice when embedding is blocked.
 */
function _applyResultDetails(entry, res) {
  const { id, url } = entry;
  const card = document.querySelector(`[data-url-id="${id}"].live-test-card`);
  const badge = document.getElementById(`live-badge-${id}`);
  if (!card || !badge || res.status === 'checking') return;

  const textSpan = badge.querySelector('.live-badge__text');
  const parts = [_getStatusText(res.status)];
  if (res.code) parts.push(String(res.code));
  if (res.timeMs != null) parts.push(`${res.timeMs}ms`);
  if (textSpan) textSpan.textContent = parts.join(' · ');
  if (res.assertion?.passed && textSpan) textSpan.textContent += ' ✓';
  if (res.mode === 'limited') {
    badge.title = i18next.t('liveTest.status.limitedHint', {
      defaultValue: '僅能確認主機有回應，無法取得 HTTP 狀態碼。',
    });
  } else if (res.mode === 'server') {
    badge.title = i18next.t('liveTest.status.serverHint', {
      defaultValue: '由伺服器檢測（無法連到內網網址）。',
    });
  } else {
    badge.title = res.error || '';
  }

  const banner = card.querySelector(
    '.live-card-alert:not(.live-embed-blocked) span'
  );
  if (banner && res.error && res.mode !== 'limited') {
    banner.textContent = `⚠️ ${res.error}`;
  }
  _renderHistory(id, res);

  const actions = card.querySelector('.live-test-card__actions');
  const grantId = `live-grant-${id}`;
  const oldGrant = document.getElementById(grantId);
  if (oldGrant) oldGrant.remove();
  if (res.needsPermission && actions) {
    const grantBtn = document.createElement('button');
    grantBtn.className = 'live-card-btn';
    grantBtn.id = grantId;
    grantBtn.textContent = '🔑';
    grantBtn.title = i18next.t('liveTest.actions.grantAccess', {
      defaultValue: '授權此網域以取得真實 HTTP 狀態',
    });
    grantBtn.addEventListener('click', async () => {
      if (await requestHostPermissions([url])) {
        _reloadSingleCard(card, entry);
      }
    });
    actions.insertBefore(grantBtn, actions.firstChild.nextSibling);
  }

  if (res.embeddable === false) _showEmbedBlocked(card, url);
}

function _showEmbedBlocked(card, url) {
  const wrapper = card.querySelector('.live-test-iframe-wrapper');
  if (!wrapper || wrapper.querySelector('.live-embed-blocked')) return;
  wrapper.innerHTML = '';
  const notice = document.createElement('div');
  notice.className = 'live-embed-blocked live-card-alert';
  const msg = document.createElement('span');
  msg.textContent = i18next.t('liveTest.status.xframeWarn', {
    defaultValue:
      '🔒 此網站禁止內嵌 (X-Frame-Options / CSP)，但連線正常。請在新分頁開啟。',
  });
  const openBtn = document.createElement('button');
  openBtn.className = 'live-card-btn';
  openBtn.textContent = '↗';
  openBtn.addEventListener('click', () =>
    window.open(url, '_blank', 'noopener,noreferrer')
  );
  notice.appendChild(msg);
  notice.appendChild(openBtn);
  wrapper.appendChild(notice);
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
    const status = res.status;
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

function _renderHistory(id, latest) {
  const el = document.getElementById(`live-history-${id}`);
  if (!el) return;
  el.innerHTML = '';
  const records = getHistory(id)
    .filter((record) => record && typeof record === 'object')
    .slice(-10);
  if (!records.length) return;

  const dots = document.createElement('span');
  dots.className = 'live-history-dots';
  records.forEach((record) => {
    const dot = document.createElement('span');
    dot.className = `live-history-dot live-history-dot--${record.ok ? 'ok' : 'fail'}`;
    dot.title = [
      new Date(record.t).toLocaleString(),
      record.code,
      record.ms != null ? `${record.ms}ms` : '',
      record.err,
    ]
      .filter(Boolean)
      .join(' · ');
    dots.appendChild(dot);
  });
  el.appendChild(dots);

  if (latest?.regression || latest?.recovered) {
    const tag = document.createElement('span');
    tag.className = `live-history-tag live-history-tag--${latest.regression ? 'fail' : 'ok'}`;
    tag.textContent = latest.regression
      ? i18next.t('liveTest.history.regression', {
          defaultValue: '⬇ 上次正常，本次異常',
        })
      : i18next.t('liveTest.history.recovered', {
          defaultValue: '⬆ 上次異常，本次已恢復',
        });
    el.appendChild(tag);
  }
}

/**
 * Inline editor for an entry's assertions. Saving mutates the entry and
 * notifies the owner (which persists and syncs it).
 */
function _createAssertionPanel(entry, card, assertBtn) {
  const current = normalizeAssertions(entry.assertions) || {};
  const panel = document.createElement('form');
  panel.className = 'live-assert-panel';

  const field = (labelKey, labelDefault, type, value, placeholder) => {
    const label = document.createElement('label');
    label.className = 'live-assert-field';
    const text = document.createElement('span');
    text.textContent = i18next.t(labelKey, { defaultValue: labelDefault });
    const input = document.createElement('input');
    input.type = type;
    input.value = value ?? '';
    if (placeholder) input.placeholder = placeholder;
    if (type === 'number') input.min = '1';
    label.appendChild(text);
    label.appendChild(input);
    panel.appendChild(label);
    return input;
  };

  const statusInput = field(
    'liveTest.assert.expectedStatus',
    '預期狀態碼',
    'text',
    current.expectedStatus,
    '200 / 2xx / 200,301 / 200-299'
  );
  const keywordInput = field(
    'liveTest.assert.keyword',
    '必須包含文字',
    'text',
    current.keyword,
    ''
  );
  const timeInput = field(
    'liveTest.assert.maxTime',
    '最大回應時間 (ms)',
    'number',
    current.maxTimeMs,
    '1500'
  );

  const hint = document.createElement('small');
  hint.className = 'live-assert-hint';
  hint.textContent = i18next.t('liveTest.assert.hint', {
    defaultValue:
      '狀態碼與內文檢查需要擴充功能授權或登入後的伺服器檢測；一般網頁的有限模式會略過。',
  });
  panel.appendChild(hint);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'live-ctrl-btn';
  saveBtn.textContent = i18next.t('liveTest.assert.save', {
    defaultValue: '儲存並重新檢測',
  });
  panel.appendChild(saveBtn);

  panel.addEventListener('submit', (event) => {
    event.preventDefault();
    const next = normalizeAssertions({
      expectedStatus: statusInput.value,
      keyword: keywordInput.value,
      maxTimeMs: timeInput.value,
    });
    if (next) entry.assertions = next;
    else delete entry.assertions;
    onEntryChange(entry);
    assertBtn.textContent = next ? '🎯' : '⚙';
    panel.remove();
    _reloadSingleCard(card, entry);
  });
  return panel;
}

function exportResults() {
  if (!currentUrls.length) return;
  const csv = buildResultsCsv(currentUrls, healthResults);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `url-check-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
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
