import i18next from '../i18n';

/**
 * Creates a URL card element.
 * @param {object} entry - The URL entry data.
 * @param {object} callbacks - An object containing callback functions.
 * @param {function} callbacks.onUpdate - Called when a property is updated.
 * @param {function} callbacks.onLoad - Called when the load button is clicked.
 * @param {function} callbacks.onDelete - Called when the delete button is clicked.
 * @param {function} [callbacks.onCopy] - Called when URL is copied.
 * @param {function} [callbacks.onOpen] - Called when open-in-tab button is clicked.
 * @param {function} [callbacks.onPin] - Called when pin button is toggled.
 * @param {function} [callbacks.onCheckHealth] - Called when health check button is clicked.
 * @param {function} [callbacks.onToggleSelect] - Called when checkbox selection changes.
 * @param {boolean} [isSelected=false] - Whether the card is currently selected.
 * @returns {HTMLElement} The created card element.
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

  // --- Header row: checkbox | label input | usage badge | health badge | pin btn ---
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

  // Label input
  const labelInput = document.createElement('input');
  labelInput.placeholder = i18next.t('urlList.card.namePlaceholder');
  labelInput.value = label;
  labelInput.className = 'url-card__label';
  labelInput.addEventListener('change', () => {
    callbacks.onUpdate(id, 'label', labelInput.value);
  });

  // Health status badge
  const healthBadge = document.createElement('span');
  healthBadge.className = 'url-card__health-badge';
  if (healthStatus === 'checking') {
    healthBadge.className += ' health--checking';
    healthBadge.textContent = i18next.t('healthCheck.checking');
  } else if (healthStatus === 'online') {
    healthBadge.className += ' health--online';
    healthBadge.textContent = i18next.t('healthCheck.online');
  } else if (healthStatus === 'offline') {
    healthBadge.className += ' health--offline';
    healthBadge.textContent = i18next.t('healthCheck.offline');
  } else {
    healthBadge.style.display = 'none';
  }

  // Usage count badge
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
  header.appendChild(labelInput);
  header.appendChild(healthBadge);
  header.appendChild(usageBadge);
  header.appendChild(pinBtn);

  // --- URL display with copy on click ---
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

  // --- Tags input ---
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

  // --- Action buttons ---
  const loadBtn = document.createElement('button');
  loadBtn.textContent = i18next.t('urlList.card.load');
  loadBtn.className = 'url-card__button';
  loadBtn.addEventListener('click', () => {
    if (callbacks.onLoad) callbacks.onLoad(url, id);
  });

  const openBtn = document.createElement('button');
  openBtn.textContent = i18next.t('urlList.card.open');
  openBtn.className = 'url-card__button url-card__button--open';
  openBtn.title = i18next.t('urlList.card.openTooltip');
  openBtn.addEventListener('click', () => {
    if (callbacks.onOpen) callbacks.onOpen(url, id);
  });

  const healthBtn = document.createElement('button');
  healthBtn.textContent = i18next.t('healthCheck.btn');
  healthBtn.className = 'url-card__button url-card__button--health';
  healthBtn.title = i18next.t('healthCheck.btnTooltip');
  healthBtn.addEventListener('click', () => {
    if (callbacks.onCheckHealth) callbacks.onCheckHealth(url, id);
  });

  const qrBtn = document.createElement('button');
  qrBtn.textContent = i18next.t('qrcode.btn');
  qrBtn.className = 'url-card__button url-card__button--qr';
  qrBtn.title = i18next.t('qrcode.btnTooltip');
  qrBtn.addEventListener('click', () => {
    if (callbacks.onQrCode) callbacks.onQrCode(url, label || url);
  });

  const delBtn = document.createElement('button');
  delBtn.textContent = i18next.t('urlList.card.delete');
  delBtn.className = 'url-card__button url-card__button--delete';
  delBtn.addEventListener('click', () => callbacks.onDelete(id));

  const actions = document.createElement('div');
  actions.className = 'url-card__actions';
  actions.appendChild(loadBtn);
  actions.appendChild(openBtn);
  actions.appendChild(healthBtn);
  actions.appendChild(qrBtn);
  actions.appendChild(delBtn);

  card.appendChild(header);
  card.appendChild(text);
  card.appendChild(tagsInput);
  card.appendChild(actions);

  return card;
}
