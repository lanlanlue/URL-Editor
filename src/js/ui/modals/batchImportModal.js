import i18next from '../../core/i18n';
import { parseBatchUrlText } from '../../core/urlParser';

let currentExistingUrls = [];
let currentBatchItems = [];
let batchImportCallbacks = {};

/**
 * Initializes the Batch Import Modal listeners and references.
 */
export function initBatchImportModal() {
  const dialog = document.getElementById('batch-import-modal');
  if (!dialog) return;

  const closeBtn = document.getElementById('batch-import-close-btn');
  const cancelBtn = document.getElementById('batch-import-cancel-btn');
  const submitBtn = document.getElementById('batch-import-submit-btn');

  const textarea = document.getElementById('batch-import-textarea');
  const autoNameCheckbox = document.getElementById('batch-import-autoname');
  const autoTagCheckbox = document.getElementById('batch-import-autotag');
  const skipExistingCheckbox = document.getElementById(
    'batch-import-skip-existing'
  );
  const commonTagInput = document.getElementById('batch-import-commontag');

  const handleClose = () => {
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
      dialog.classList.add('hidden');
    }
  };

  if (closeBtn) closeBtn.addEventListener('click', handleClose);
  if (cancelBtn) cancelBtn.addEventListener('click', handleClose);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      handleClose();
    }
  });

  // Re-parse when inputs change
  const triggerReparse = () => {
    reparseAndRender();
  };

  if (textarea) {
    textarea.addEventListener('input', triggerReparse);
    textarea.addEventListener('change', triggerReparse);
    textarea.addEventListener('paste', () => {
      setTimeout(triggerReparse, 20);
    });
  }

  if (autoNameCheckbox)
    autoNameCheckbox.addEventListener('change', triggerReparse);
  if (autoTagCheckbox)
    autoTagCheckbox.addEventListener('change', triggerReparse);
  if (skipExistingCheckbox)
    skipExistingCheckbox.addEventListener('change', triggerReparse);
  if (commonTagInput) commonTagInput.addEventListener('input', triggerReparse);

  // Submit button
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      const itemsToImport = currentBatchItems.filter((item) => item.selected);

      if (itemsToImport.length === 0) {
        alert(i18next.t('batchImport.noSelectedAlert'));
        return;
      }

      if (batchImportCallbacks.onImport) {
        batchImportCallbacks.onImport(itemsToImport);
      }

      alert(
        i18next.t('batchImport.successAlert', { count: itemsToImport.length })
      );
      handleClose();
    });
  }
}

function getOptions() {
  const autoNameCheckbox = document.getElementById('batch-import-autoname');
  const autoTagCheckbox = document.getElementById('batch-import-autotag');
  const skipExistingCheckbox = document.getElementById(
    'batch-import-skip-existing'
  );
  const commonTagInput = document.getElementById('batch-import-commontag');

  const commonTags = commonTagInput
    ? commonTagInput.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  return {
    autoName: autoNameCheckbox ? autoNameCheckbox.checked : true,
    autoTag: autoTagCheckbox ? autoTagCheckbox.checked : true,
    skipExisting: skipExistingCheckbox ? skipExistingCheckbox.checked : true,
    commonTags,
    existingUrls: currentExistingUrls,
  };
}

function reparseAndRender() {
  const textarea = document.getElementById('batch-import-textarea');
  const previewContainer = document.getElementById(
    'batch-import-preview-container'
  );
  const countBadge = document.getElementById('batch-import-count-badge');

  if (!textarea || !previewContainer) return;

  const rawText = textarea.value;
  const options = getOptions();

  const { items, stats } = parseBatchUrlText(rawText, options);

  // Auto-unselect existing items if skipExisting is checked
  currentBatchItems = items.map((item) => {
    if (options.skipExisting && item.isExisting) {
      return { ...item, selected: false };
    }
    return item;
  });

  if (countBadge) {
    countBadge.textContent = i18next.t('batchImport.previewTitle', {
      count: stats.uniqueFound,
    });
  }

  renderPreviewList();
  updateSubmitButton();
}

function updateSubmitButton() {
  const submitBtn = document.getElementById('batch-import-submit-btn');
  if (!submitBtn) return;

  const selectedCount = currentBatchItems.filter((i) => i.selected).length;
  submitBtn.textContent = i18next.t('batchImport.importBtn', {
    count: selectedCount,
  });
  submitBtn.disabled = selectedCount === 0;
}

function renderPreviewList() {
  const previewContainer = document.getElementById(
    'batch-import-preview-container'
  );
  if (!previewContainer) return;

  previewContainer.innerHTML = '';

  if (currentBatchItems.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'preview-empty-text';
    emptyMsg.textContent = i18next.t('batchImport.noUrlsFound');
    previewContainer.appendChild(emptyMsg);
    return;
  }

  const listEl = document.createElement('div');
  listEl.className = 'batch-import-items-list';

  currentBatchItems.forEach((item) => {
    const row = document.createElement('div');
    row.className = `batch-import-row ${item.selected ? 'is-selected' : ''} ${item.isExisting ? 'is-existing' : ''}`;

    const checkWrapper = document.createElement('div');
    checkWrapper.className = 'batch-import-row__check';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.selected;
    checkbox.addEventListener('change', () => {
      item.selected = checkbox.checked;
      if (item.selected) {
        row.classList.add('is-selected');
      } else {
        row.classList.remove('is-selected');
      }
      updateSubmitButton();
    });
    checkWrapper.appendChild(checkbox);

    const mainCol = document.createElement('div');
    mainCol.className = 'batch-import-row__main';

    const urlCode = document.createElement('code');
    urlCode.className = 'batch-import-url-code';
    urlCode.textContent = item.url;
    mainCol.appendChild(urlCode);

    if (item.isExisting) {
      const existingBadge = document.createElement('span');
      existingBadge.className = 'badge badge--warning';
      existingBadge.textContent = i18next.t('batchImport.badgeExisting');
      mainCol.appendChild(existingBadge);
    }

    const inputsRow = document.createElement('div');
    inputsRow.className = 'batch-import-row__inputs';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'batch-import-input-label';
    labelInput.placeholder = i18next.t('urlList.card.namePlaceholder');
    labelInput.value = item.label || '';
    labelInput.addEventListener('input', () => {
      item.label = labelInput.value.trim();
    });

    const tagsInput = document.createElement('input');
    tagsInput.type = 'text';
    tagsInput.className = 'batch-import-input-tags';
    tagsInput.placeholder = i18next.t('urlList.card.tagsPlaceholder');
    tagsInput.value = (item.tags || []).join(', ');
    tagsInput.addEventListener('input', () => {
      item.tags = tagsInput.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    });

    inputsRow.appendChild(labelInput);
    inputsRow.appendChild(tagsInput);
    mainCol.appendChild(inputsRow);

    row.appendChild(checkWrapper);
    row.appendChild(mainCol);
    listEl.appendChild(row);
  });

  previewContainer.appendChild(listEl);
}

/**
 * Opens the batch import modal.
 * @param {object} params
 * @param {Array<object>} params.existingUrls
 * @param {object} params.callbacks
 */
export function openBatchImportModal({ existingUrls = [], callbacks = {} }) {
  currentExistingUrls = existingUrls;
  currentBatchItems = [];
  batchImportCallbacks = callbacks;

  const dialog = document.getElementById('batch-import-modal');
  if (!dialog) return;

  const textarea = document.getElementById('batch-import-textarea');
  if (textarea) textarea.value = '';

  const commonTagInput = document.getElementById('batch-import-commontag');
  if (commonTagInput) commonTagInput.value = '';

  reparseAndRender();

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', 'true');
    dialog.classList.remove('hidden');
  }

  if (textarea) {
    textarea.focus();
  }
}
