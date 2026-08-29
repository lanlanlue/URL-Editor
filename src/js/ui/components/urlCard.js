import i18next from '../../core/i18n';
import { createFaviconImg } from '../../utils/faviconService';

/**
 * Creates a URL card element (卡片模式).
 * @param {object} entry - The URL entry data.
 * @param {object} callbacks - Callback functions.
 * @param {boolean} [isSelected=false]
 * @returns {HTMLElement}
 */
export function createUrlCard(entry, callbacks, isSelected = false) {
  const {
    id,
    url,
    label = '',
    tags = [],
    usageCount = 0,
    isPinned = false,
    healthStatus = null,
  } = entry;

  const card = document.createElement('div');
  card.classList.add('url-card');
  card.dataset.urlId = id;
  if (isSelected) card.classList.add('url-card--selected');
  if (isPinned) card.classList.add('url-card--pinned');

  // --- Header row: checkbox | favicon | label input | health badge | usage badge | pin btn ---
  const header = document.createElement('div');
  header.className = 'url-card__header';

  // Checkbox
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'url-card__checkbox';
  checkbox.checked = isSelected;
  checkbox.title = i18next.t('urlList.card.selectCard');
  checkbox.setAttribute('aria-label', i18next.t('urlList.card.selectCard'));
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) {
      card.classList.add('url-card--selected');
    } else {
      card.classList.remove('url-card--selected');
    }
    if (callbacks.onToggleSelect) {
      callbacks.onToggleSelect(id, checkbox.checked);
    }
  });

  // Favicon with fallback
  const favicon = _createFaviconElement(url, 'url-card__favicon');

  // Label input
  const labelInput = document.createElement('input');
  labelInput.placeholder = i18next.t('urlList.card.namePlaceholder');
  labelInput.value = label;
  labelInput.className = 'url-card__label';
  labelInput.addEventListener('change', () => {
    callbacks.onUpdate(id, 'label', labelInput.value);
  });

  // Health badge
  const healthBadge = document.createElement('span');
  healthBadge.className = 'url-card__health-badge';
  _applyHealthBadge(healthBadge, healthStatus);

  // Usage badge
  const usageBadge = document.createElement('span');
  usageBadge.className = 'url-card__usage-badge';
  usageBadge.textContent = `🔥 ${usageCount}`;
  if (usageCount === 0) usageBadge.style.display = 'none';

  // Pin button
  const pinBtn = document.createElement('button');
  pinBtn.className = `url-card__pin-btn ${isPinned ? 'is-pinned' : ''}`;
  pinBtn.title = isPinned
    ? i18next.t('urlList.card.unpin')
    : i18next.t('urlList.card.pin');
  pinBtn.textContent = isPinned ? '⭐' : '☆';
  pinBtn.addEventListener('click', () => {
    const newPinned = !card.classList.contains('url-card--pinned');
    card.classList.toggle('url-card--pinned', newPinned);
    pinBtn.classList.toggle('is-pinned', newPinned);
    pinBtn.textContent = newPinned ? '⭐' : '☆';
    pinBtn.title = newPinned
      ? i18next.t('urlList.card.unpin')
      : i18next.t('urlList.card.pin');
    if (callbacks.onPin) callbacks.onPin(id, newPinned);
  });

  header.appendChild(checkbox);
  header.appendChild(favicon);
  header.appendChild(labelInput);
  header.appendChild(healthBadge);
  header.appendChild(usageBadge);
  header.appendChild(pinBtn);

  // URL display
  const text = document.createElement('code');
  text.textContent = url;
  text.className = 'url-card__url-value';
  text.title = i18next.t('urlList.card.copyTooltip');
  text.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      text.textContent = i18next.t('urlList.card.copied');
      if (callbacks.onCopy) callbacks.onCopy(id);
      setTimeout(() => {
        text.textContent = url;
      }, 1000);
    });
  });

  // Tags input
  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.placeholder = i18next.t('urlList.card.tagsPlaceholder');
  tagsInput.className = 'url-card__tags';
  tagsInput.value = tags.join(', ');
  tagsInput.addEventListener('change', () => {
    const newTags = tagsInput.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    callbacks.onUpdate(id, 'tags', newTags);
  });

  // Action buttons
  const loadBtn = _makeCardBtn(
    i18next.t('urlList.card.load'),
    'url-card__button url-card__button--load',
    () => {
      if (callbacks.onLoad) callbacks.onLoad(url, id);
    }
  );

  const openBtn = _makeCardBtn(
    i18next.t('urlList.card.open'),
    'url-card__button url-card__button--open',
    () => {
      if (callbacks.onOpen) callbacks.onOpen(url, id);
    }
  );
  openBtn.title = i18next.t('urlList.card.openTooltip');

  const healthBtn = _makeCardBtn(
    i18next.t('healthCheck.btn'),
    'url-card__button url-card__button--health',
    () => {
      if (callbacks.onCheckHealth) callbacks.onCheckHealth(url, id);
    }
  );
  healthBtn.title = i18next.t('healthCheck.btnTooltip');

  const qrBtn = _makeCardBtn(
    i18next.t('qrcode.btn'),
    'url-card__button url-card__button--qr',
    () => {
      if (callbacks.onQrCode) callbacks.onQrCode(url, label || url);
    }
  );
  qrBtn.title = i18next.t('qrcode.btnTooltip');

  const delBtn = _makeCardBtn(
    i18next.t('urlList.card.delete'),
    'url-card__button url-card__button--delete',
    () => {
      callbacks.onDelete(id);
    }
  );

  const actions = document.createElement('div');
  actions.className = 'url-card__actions';
  [loadBtn, openBtn, healthBtn, qrBtn, delBtn].forEach((b) =>
    actions.appendChild(b)
  );

  card.appendChild(header);
  card.appendChild(text);
  card.appendChild(tagsInput);
  card.appendChild(actions);

  return card;
}

/**
 * Creates a URL table row element (表格模式 — 高密度橫向行列).
 * @param {object} entry - The URL entry data.
 * @param {object} callbacks - Callback functions (same interface as createUrlCard).
 * @param {boolean} [isSelected=false]
 * @returns {HTMLTableRowElement}
 */
export function createUrlRow(entry, callbacks, isSelected = false) {
  const {
    id,
    url,
    label = '',
    tags = [],
    usageCount = 0,
    isPinned = false,
    healthStatus = null,
  } = entry;

  const tr = document.createElement('tr');
  tr.className = 'url-table__row';
  tr.dataset.urlId = id;
  if (isSelected) tr.classList.add('url-table__row--selected');
  if (isPinned) tr.classList.add('url-table__row--pinned');

  // ── Col 1: Checkbox ──────────────────────────────────────
  const tdCheck = document.createElement('td');
  tdCheck.className = 'url-table__col-check';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = isSelected;
  checkbox.title = i18next.t('urlList.card.selectCard');
  checkbox.setAttribute('aria-label', i18next.t('urlList.card.selectCard'));
  checkbox.addEventListener('change', () => {
    tr.classList.toggle('url-table__row--selected', checkbox.checked);
    if (callbacks.onToggleSelect)
      callbacks.onToggleSelect(id, checkbox.checked);
  });
  tdCheck.appendChild(checkbox);

  // ── Col 2: Favicon ───────────────────────────────────────
  const tdFav = document.createElement('td');
  tdFav.className = 'url-table__col-favicon';
  tdFav.appendChild(_createFaviconElement(url, 'url-table__favicon'));

  // ── Col 3: Label ─────────────────────────────────────────
  const tdLabel = document.createElement('td');
  tdLabel.className = 'url-table__col-label';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'url-table__label-input';
  labelInput.value = label;
  labelInput.placeholder = i18next.t('urlList.card.namePlaceholder');
  labelInput.addEventListener('change', () => {
    callbacks.onUpdate(id, 'label', labelInput.value);
  });
  tdLabel.appendChild(labelInput);

  // ── Col 4: URL ───────────────────────────────────────────
  const tdUrl = document.createElement('td');
  tdUrl.className = 'url-table__col-url';
  const urlCode = document.createElement('code');
  urlCode.className = 'url-table__url-code';
  urlCode.textContent = url;
  urlCode.title = i18next.t('urlList.card.copyTooltip');
  urlCode.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      urlCode.classList.add('copied');
      const original = urlCode.textContent;
      urlCode.textContent = i18next.t('urlList.card.copied');
      if (callbacks.onCopy) callbacks.onCopy(id);
      setTimeout(() => {
        urlCode.textContent = original;
        urlCode.classList.remove('copied');
      }, 1200);
    });
  });
  tdUrl.appendChild(urlCode);

  // ── Col 5: Tags ──────────────────────────────────────────
  const tdTags = document.createElement('td');
  tdTags.className = 'url-table__col-tags';
  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.className = 'url-table__tags-input';
  tagsInput.value = tags.join(', ');
  tagsInput.placeholder = i18next.t('urlList.card.tagsPlaceholder');
  tagsInput.addEventListener('change', () => {
    const newTags = tagsInput.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    callbacks.onUpdate(id, 'tags', newTags);
  });
  tdTags.appendChild(tagsInput);

  // ── Col 6: Health ────────────────────────────────────────
  const tdHealth = document.createElement('td');
  tdHealth.className = 'url-table__col-health';
  const healthEl = _buildHealthEl(healthStatus);
  tdHealth.appendChild(healthEl);

  // ── Col 7: Usage ─────────────────────────────────────────
  const tdUsage = document.createElement('td');
  tdUsage.className = 'url-table__col-usage';
  if (usageCount > 0) {
    const usageEl = document.createElement('span');
    usageEl.className = 'url-table__usage';
    usageEl.textContent = `🔥 ${usageCount}`;
    usageEl.title = `${i18next.t('urlList.table.usage', { defaultValue: '使用次數' })}: ${usageCount}`;
    tdUsage.appendChild(usageEl);
  }

  // ── Col 8: Actions ───────────────────────────────────────
  const tdActions = document.createElement('td');
  tdActions.className = 'url-table__col-actions';
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'url-table__actions';

  const loadBtn = _makeRowBtn(
    '↩',
    'url-table__action-btn url-table__action-btn--load',
    i18next.t('urlList.card.load'),
    () => {
      if (callbacks.onLoad) callbacks.onLoad(url, id);
    }
  );

  const openBtn = _makeRowBtn(
    '↗',
    'url-table__action-btn',
    i18next.t('urlList.card.open'),
    () => {
      if (callbacks.onOpen) callbacks.onOpen(url, id);
    }
  );

  const healthBtn = _makeRowBtn(
    '📡',
    'url-table__action-btn',
    i18next.t('healthCheck.btn'),
    () => {
      if (callbacks.onCheckHealth) callbacks.onCheckHealth(url, id);
    }
  );

  const qrBtn = _makeRowBtn(
    '⊡',
    'url-table__action-btn',
    i18next.t('qrcode.btn'),
    () => {
      if (callbacks.onQrCode) callbacks.onQrCode(url, label || url);
    }
  );

  const delBtn = _makeRowBtn(
    '✕',
    'url-table__action-btn url-table__action-btn--delete',
    i18next.t('urlList.card.delete'),
    () => {
      callbacks.onDelete(id);
    }
  );

  [loadBtn, openBtn, healthBtn, qrBtn, delBtn].forEach((b) =>
    actionsDiv.appendChild(b)
  );
  tdActions.appendChild(actionsDiv);

  // ── Assemble row ─────────────────────────────────────────
  [
    tdCheck,
    tdFav,
    tdLabel,
    tdUrl,
    tdTags,
    tdHealth,
    tdUsage,
    tdActions,
  ].forEach((td) => tr.appendChild(td));

  return tr;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _makeCardBtn(text, className, handler) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.className = className;
  btn.addEventListener('click', handler);
  return btn;
}

function _makeRowBtn(icon, className, title, handler) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = icon;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.addEventListener('click', handler);
  return btn;
}

function _applyHealthBadge(el, healthStatus) {
  if (healthStatus === 'checking') {
    el.className = 'url-card__health-badge health--checking';
    el.textContent = i18next.t('healthCheck.checking');
  } else if (healthStatus === 'online') {
    el.className = 'url-card__health-badge health--online';
    el.textContent = i18next.t('healthCheck.online');
  } else if (healthStatus === 'offline') {
    el.className = 'url-card__health-badge health--offline';
    el.textContent = i18next.t('healthCheck.offline');
  } else {
    el.style.display = 'none';
  }
}

function _buildHealthEl(healthStatus) {
  const wrapper = document.createElement('span');

  if (!healthStatus) return wrapper;

  wrapper.className = `url-table__health url-table__health--${healthStatus}`;

  const dot = document.createElement('span');
  dot.className = 'url-table__health-dot';
  wrapper.appendChild(dot);

  const label = document.createElement('span');
  if (healthStatus === 'online')
    label.textContent = i18next.t('healthCheck.online');
  if (healthStatus === 'offline')
    label.textContent = i18next.t('healthCheck.offline');
  if (healthStatus === 'checking')
    label.textContent = i18next.t('healthCheck.checking');
  wrapper.appendChild(label);

  return wrapper;
}

/**
 * Thin wrapper kept for local readability – delegates to the shared,
 * offline-aware faviconService.
 * @param {string} url       - Full URL of the site.
 * @param {string} className - CSS class for the <img>.
 * @returns {HTMLImageElement}
 */
function _createFaviconElement(url, className) {
  return createFaviconImg(url, className);
}
