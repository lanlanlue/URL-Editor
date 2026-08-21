import i18next from '../i18n';

let currentUrls = [];
let updateCallback = null;

export function initTagManagerModal() {
  const dialog = document.getElementById('tag-manager-modal');
  if (!dialog) return;

  const closeBtn = document.getElementById('tag-manager-close-btn');

  const handleClose = () => {
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
      dialog.classList.add('hidden');
    }
  };

  if (closeBtn) closeBtn.addEventListener('click', handleClose);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) handleClose();
  });
}

function renderTagsList() {
  const container = document.getElementById('tag-manager-list-container');
  if (!container) return;

  container.innerHTML = '';

  // Count usage of each tag
  const tagCounts = new Map();
  currentUrls.forEach((entry) => {
    if (Array.isArray(entry.tags)) {
      entry.tags.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      });
    }
  });

  if (tagCounts.size === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'panel-desc';
    emptyMsg.textContent = i18next.t('tagManager.emptyTags');
    container.appendChild(emptyMsg);
    return;
  }

  tagCounts.forEach((count, tagName) => {
    const row = document.createElement('div');
    row.className = 'tag-manager-row';

    const info = document.createElement('div');
    info.className = 'tag-manager-info';

    const badge = document.createElement('span');
    badge.className = 'badge badge--tag';
    badge.textContent = `🏷️ ${tagName}`;

    const countSpan = document.createElement('span');
    countSpan.className = 'tag-manager-count';
    countSpan.textContent = i18next.t('tagManager.countText', { count });

    info.appendChild(badge);
    info.appendChild(countSpan);

    const actions = document.createElement('div');
    actions.className = 'tag-manager-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'btn-secondary btn-sm';
    renameBtn.textContent = i18next.t('tagManager.renameBtn');
    renameBtn.addEventListener('click', () => {
      const newName = prompt(
        i18next.t('tagManager.renamePrompt', { tag: tagName }),
        tagName
      );
      if (!newName || !newName.trim() || newName.trim() === tagName) return;

      const cleanNew = newName.trim();
      const updated = currentUrls.map((entry) => {
        if (Array.isArray(entry.tags) && entry.tags.includes(tagName)) {
          const newTags = entry.tags
            .map((t) => (t === tagName ? cleanNew : t))
            .filter((t, idx, self) => self.indexOf(t) === idx);
          return { ...entry, tags: newTags };
        }
        return entry;
      });

      currentUrls = updated;
      if (updateCallback) updateCallback(currentUrls);
      renderTagsList();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-delete btn-sm';
    deleteBtn.textContent = i18next.t('tagManager.deleteBtn');
    deleteBtn.addEventListener('click', () => {
      const confirmed = confirm(
        i18next.t('tagManager.deleteConfirm', { tag: tagName, count })
      );
      if (!confirmed) return;

      const updated = currentUrls.map((entry) => {
        if (Array.isArray(entry.tags) && entry.tags.includes(tagName)) {
          return {
            ...entry,
            tags: entry.tags.filter((t) => t !== tagName),
          };
        }
        return entry;
      });

      currentUrls = updated;
      if (updateCallback) updateCallback(currentUrls);
      renderTagsList();
    });

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(info);
    row.appendChild(actions);
    container.appendChild(row);
  });
}

/**
 * Opens the Tag Manager Dialog Modal.
 * @param {object} params
 * @param {Array<object>} params.urls
 * @param {function(Array<object>): void} params.onUpdateUrls
 */
export function openTagManagerModal({ urls, onUpdateUrls }) {
  currentUrls = urls;
  updateCallback = onUpdateUrls;

  const dialog = document.getElementById('tag-manager-modal');
  if (!dialog) return;

  renderTagsList();

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', 'true');
    dialog.classList.remove('hidden');
  }
}
