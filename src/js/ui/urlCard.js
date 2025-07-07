import i18next from '../i18n';

/**
 * Creates a URL card element.
 * @param {object} entry - The URL entry data.
 * @param {object} callbacks - An object containing callback functions.
 * @param {function} callbacks.onUpdate - Called when a property is updated.
 * @param {function} callbacks.onLoad - Called when the load button is clicked.
 * @param {function} callbacks.onDelete - Called when the delete button is clicked.
 * @returns {HTMLElement} The created card element.
 */
export function createUrlCard(entry, callbacks) {
  const { id, url, label = '', tags = [] } = entry;

  const card = document.createElement('div');
  card.classList.add('url-card');

  const labelInput = document.createElement('input');
  labelInput.placeholder = i18next.t('urlList.card.namePlaceholder');
  labelInput.value = label;
  labelInput.className = 'url-card__label';
  labelInput.addEventListener('change', () => {
    callbacks.onUpdate(id, 'label', labelInput.value);
  });

  const text = document.createElement('code');
  text.textContent = url;
  text.className = 'url-card__url-value';
  text.title = i18next.t('urlList.card.copyTooltip');
  text.addEventListener('click', () => {
    navigator.clipboard.writeText(url).then(() => {
      text.textContent = i18next.t('urlList.card.copied');
      setTimeout(() => {
        text.textContent = url;
      }, 1000);
    });
  });

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

  const loadBtn = document.createElement('button');
  loadBtn.textContent = i18next.t('urlList.card.load');
  loadBtn.className = 'url-card__button';
  loadBtn.addEventListener('click', () => callbacks.onLoad(url));

  const delBtn = document.createElement('button');
  delBtn.textContent = i18next.t('urlList.card.delete');
  delBtn.className = 'url-card__button url-card__button--delete';
  delBtn.addEventListener('click', () => callbacks.onDelete(id));

  const actions = document.createElement('div');
  actions.className = 'url-card__actions';
  actions.appendChild(loadBtn);
  actions.appendChild(delBtn);

  card.appendChild(labelInput);
  card.appendChild(text);
  card.appendChild(tagsInput);
  card.appendChild(actions);

  return card;
}
