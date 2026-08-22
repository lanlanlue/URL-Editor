import i18next from '../../core/i18n';
import {
  extractDomainsFromUrls,
  batchProcessUrls,
  findDuplicateUrls,
} from '../../core/urlParser';

let currentScope = 'all'; // 'all' | 'filtered' | 'selected'
let currentTab = 'domain'; // 'domain' | 'findReplace' | 'cleanup'
let modalUrls = [];
let modalFilteredIds = null;
let modalSelectedIds = new Set();
let modalCallbacks = {};

/**
 * Initializes the Maintenance Modal listeners and references.
 */
export function initMaintenanceModal() {
  const dialog = document.getElementById('maintenance-modal');
  if (!dialog) return;

  const closeBtn = document.getElementById('modal-close-btn');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const applyBtn = document.getElementById('modal-apply-btn');

  const tabDomainBtn = document.getElementById('tab-btn-domain');
  const tabFindBtn = document.getElementById('tab-btn-find');
  const tabCleanupBtn = document.getElementById('tab-btn-cleanup');

  const existingDomainSelect = document.getElementById(
    'modal-existing-domains'
  );
  const oldDomainInput = document.getElementById('modal-old-domain');
  const newDomainInput = document.getElementById('modal-new-domain');

  const findTextInput = document.getElementById('modal-find-text');
  const replaceTextInput = document.getElementById('modal-replace-text');
  const targetFieldSelect = document.getElementById(
    'modal-target-field-select'
  );
  const matchCaseCheckbox = document.getElementById('modal-match-case');

  const scopeRadios = document.querySelectorAll('input[name="modal-scope"]');
  const cleanupBtn = document.getElementById('modal-cleanup-btn');

  // Close handlers
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

  // Close on backdrop click
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      handleClose();
    }
  });

  // Tab switching
  const switchTab = (tabName) => {
    currentTab = tabName;
    const tabPanels = {
      domain: document.getElementById('tab-panel-domain'),
      findReplace: document.getElementById('tab-panel-find'),
      cleanup: document.getElementById('tab-panel-cleanup'),
    };
    const tabButtons = {
      domain: tabDomainBtn,
      findReplace: tabFindBtn,
      cleanup: tabCleanupBtn,
    };

    Object.keys(tabPanels).forEach((k) => {
      if (tabPanels[k]) {
        if (k === tabName) {
          tabPanels[k].classList.remove('hidden');
        } else {
          tabPanels[k].classList.add('hidden');
        }
      }
      if (tabButtons[k]) {
        if (k === tabName) {
          tabButtons[k].classList.add('active');
        } else {
          tabButtons[k].classList.remove('active');
        }
      }
    });

    const footer = document.querySelector('.modal-footer');
    if (footer) {
      if (tabName === 'cleanup') {
        if (applyBtn) applyBtn.classList.add('hidden');
      } else {
        if (applyBtn) applyBtn.classList.remove('hidden');
      }
    }

    updatePreview();
  };

  if (tabDomainBtn)
    tabDomainBtn.addEventListener('click', () => switchTab('domain'));
  if (tabFindBtn)
    tabFindBtn.addEventListener('click', () => switchTab('findReplace'));
  if (tabCleanupBtn)
    tabCleanupBtn.addEventListener('click', () => switchTab('cleanup'));

  // Scope change
  scopeRadios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        currentScope = e.target.value;
        updatePreview();
      }
    });
  });

  // Existing domain dropdown change
  if (existingDomainSelect) {
    existingDomainSelect.addEventListener('change', () => {
      const val = existingDomainSelect.value;
      if (val === '__custom__') {
        oldDomainInput.value = '';
        oldDomainInput.focus();
      } else if (val) {
        oldDomainInput.value = val;
      }
      updatePreview();
    });
  }

  // Real-time preview triggers
  [
    oldDomainInput,
    newDomainInput,
    findTextInput,
    replaceTextInput,
    matchCaseCheckbox,
  ].forEach((el) => {
    if (el) el.addEventListener('input', updatePreview);
  });

  if (targetFieldSelect) {
    targetFieldSelect.addEventListener('change', updatePreview);
  }

  // Apply button
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      const processOptions = getProcessOptions();
      const result = batchProcessUrls(modalUrls, processOptions);

      if (result.affectedCount === 0) {
        alert(i18next.t('maintenance.noTargetAlert'));
        return;
      }

      if (modalCallbacks.onBatchUpdate) {
        modalCallbacks.onBatchUpdate(result.updatedUrls);
      }

      alert(
        i18next.t('maintenance.successAlert', { count: result.affectedCount })
      );
      handleClose();
    });
  }

  // Cleanup button
  if (cleanupBtn) {
    cleanupBtn.addEventListener('click', () => {
      if (modalCallbacks.onCleanupDuplicates) {
        const cleanedCount = modalCallbacks.onCleanupDuplicates();
        alert(
          i18next.t('maintenance.cleanup.removeSuccess', {
            count: cleanedCount || 0,
          })
        );
        handleClose();
      }
    });
  }
}

function getActiveFilterSet() {
  if (currentScope === 'selected') {
    return modalSelectedIds;
  }
  if (currentScope === 'filtered') {
    return modalFilteredIds;
  }
  return null; // 'all'
}

function getProcessOptions() {
  const oldDomainInput = document.getElementById('modal-old-domain');
  const newDomainInput = document.getElementById('modal-new-domain');
  const findTextInput = document.getElementById('modal-find-text');
  const replaceTextInput = document.getElementById('modal-replace-text');
  const targetFieldSelect = document.getElementById(
    'modal-target-field-select'
  );
  const matchCaseCheckbox = document.getElementById('modal-match-case');

  const filterIds = getActiveFilterSet();

  if (currentTab === 'domain') {
    return {
      type: 'domain',
      oldDomain: oldDomainInput ? oldDomainInput.value.trim() : '',
      newDomain: newDomainInput ? newDomainInput.value.trim() : '',
      filterIds,
    };
  } else if (currentTab === 'findReplace') {
    return {
      type: 'text',
      findText: findTextInput ? findTextInput.value : '',
      replaceText: replaceTextInput ? replaceTextInput.value : '',
      targetField: targetFieldSelect ? targetFieldSelect.value : 'all',
      matchCase: matchCaseCheckbox ? matchCaseCheckbox.checked : false,
      filterIds,
    };
  }
  return { type: 'none' };
}

function updatePreview() {
  const previewSection = document.getElementById('modal-preview-section');
  const previewListEl = document.getElementById('modal-preview-list');
  const previewCountEl = document.getElementById('modal-preview-count');
  const cleanupDuplicatesList = document.getElementById(
    'modal-duplicates-list'
  );
  const cleanupDuplicatesMsg = document.getElementById('modal-duplicates-msg');
  const cleanupBtn = document.getElementById('modal-cleanup-btn');

  if (currentTab === 'cleanup') {
    if (previewSection) previewSection.classList.add('hidden');
    const { duplicates, totalDuplicates } = findDuplicateUrls(modalUrls);
    if (cleanupDuplicatesMsg) {
      if (totalDuplicates > 0) {
        cleanupDuplicatesMsg.textContent = i18next.t(
          'maintenance.cleanup.duplicatesFound',
          { count: totalDuplicates }
        );
        if (cleanupBtn) cleanupBtn.disabled = false;
      } else {
        cleanupDuplicatesMsg.textContent = i18next.t(
          'maintenance.cleanup.noDuplicates'
        );
        if (cleanupBtn) cleanupBtn.disabled = true;
      }
    }
    if (cleanupDuplicatesList) {
      cleanupDuplicatesList.innerHTML = '';
      duplicates.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'duplicate-item';
        li.innerHTML = `<code>${escapeHtml(item.url)}</code> <span class="badge">×${item.count}</span>`;
        cleanupDuplicatesList.appendChild(li);
      });
    }
    return;
  }

  if (previewSection) previewSection.classList.remove('hidden');

  const options = getProcessOptions();
  const { affectedCount, previewList } = batchProcessUrls(modalUrls, options);

  if (previewCountEl) {
    previewCountEl.textContent = i18next.t('maintenance.preview.title', {
      count: affectedCount,
    });
  }

  if (previewListEl) {
    previewListEl.innerHTML = '';
    const changedItems = previewList.filter((item) => item.changed);

    if (changedItems.length === 0) {
      const emptyP = document.createElement('p');
      emptyP.className = 'preview-empty-text';
      emptyP.textContent = i18next.t('maintenance.preview.noChanges');
      previewListEl.appendChild(emptyP);
    } else {
      changedItems.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'preview-diff-row';

        let labelHtml = '';
        if (item.oldLabel !== item.newLabel) {
          labelHtml = `
            <div class="diff-line">
              <span class="diff-tag">${i18next.t('maintenance.preview.original')}</span> <del>${escapeHtml(item.oldLabel || '(無名稱)')}</del>
            </div>
            <div class="diff-line">
              <span class="diff-tag">${i18next.t('maintenance.preview.modified')}</span> <ins>${escapeHtml(item.newLabel || '(無名稱)')}</ins>
            </div>
          `;
        } else if (item.newLabel) {
          labelHtml = `<div class="preview-item-label">🏷️ ${escapeHtml(item.newLabel)}</div>`;
        }

        let urlHtml = '';
        if (item.oldUrl !== item.newUrl) {
          urlHtml = `
            <div class="diff-line">
              <span class="diff-tag">${i18next.t('maintenance.preview.original')}</span> <del><code>${escapeHtml(item.oldUrl)}</code></del>
            </div>
            <div class="diff-line">
              <span class="diff-tag">${i18next.t('maintenance.preview.modified')}</span> <ins><code>${escapeHtml(item.newUrl)}</code></ins>
            </div>
          `;
        }

        row.innerHTML = `${labelHtml}${urlHtml}`;
        previewListEl.appendChild(row);
      });
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Opens the maintenance modal with updated context data.
 * @param {object} params
 * @param {Array<object>} params.urls - Full URL entries list
 * @param {Array<string>|Set<string>} [params.filteredIds] - Currently filtered URL IDs
 * @param {Array<string>|Set<string>} [params.selectedIds] - Currently selected URL IDs
 * @param {string} [params.initialTab='domain'] - 'domain' | 'findReplace' | 'cleanup'
 * @param {object} params.callbacks - Callbacks for apply and delete
 */
export function openMaintenanceModal({
  urls = [],
  filteredIds = null,
  selectedIds = new Set(),
  initialTab = 'domain',
  callbacks = {},
}) {
  modalUrls = urls;
  modalFilteredIds = filteredIds ? new Set(filteredIds) : null;
  modalSelectedIds =
    selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  modalCallbacks = callbacks;

  const dialog = document.getElementById('maintenance-modal');
  if (!dialog) return;

  // Populate domains dropdown
  const domainSelect = document.getElementById('modal-existing-domains');
  const oldDomainInput = document.getElementById('modal-old-domain');
  const newDomainInput = document.getElementById('modal-new-domain');

  if (domainSelect) {
    domainSelect.innerHTML = '';
    const domains = extractDomainsFromUrls(urls);

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = `-- ${i18next.t('maintenance.domain.selectOldDomain')} --`;
    domainSelect.appendChild(defaultOpt);

    domains.forEach(({ domain, count }) => {
      const opt = document.createElement('option');
      opt.value = domain;
      opt.textContent = `${domain} (${count})`;
      domainSelect.appendChild(opt);
    });

    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = i18next.t('maintenance.domain.customDomainOption');
    domainSelect.appendChild(customOpt);

    if (domains.length > 0) {
      domainSelect.value = domains[0].domain;
      if (oldDomainInput) oldDomainInput.value = domains[0].domain;
    } else {
      if (oldDomainInput) oldDomainInput.value = '';
    }
  }

  if (newDomainInput) newDomainInput.value = '';

  // Configure scopes
  const scopeAllLabel = document.getElementById('modal-scope-all-label');
  const scopeFilteredLabel = document.getElementById(
    'modal-scope-filtered-label'
  );
  const scopeSelectedLabel = document.getElementById(
    'modal-scope-selected-label'
  );
  const scopeRadioFiltered = document.getElementById('modal-scope-filtered');
  const scopeRadioSelected = document.getElementById('modal-scope-selected');
  const scopeRadioAll = document.getElementById('modal-scope-all');

  const allCount = urls.length;
  const filteredCount = modalFilteredIds ? modalFilteredIds.size : allCount;
  const selectedCount = modalSelectedIds.size;

  if (scopeAllLabel) {
    scopeAllLabel.textContent = i18next.t('maintenance.scope.all', {
      count: allCount,
    });
  }
  if (scopeFilteredLabel) {
    scopeFilteredLabel.textContent = i18next.t('maintenance.scope.filtered', {
      count: filteredCount,
    });
  }
  if (scopeSelectedLabel) {
    scopeSelectedLabel.textContent = i18next.t('maintenance.scope.selected', {
      count: selectedCount,
    });
  }

  if (scopeRadioFiltered) {
    scopeRadioFiltered.disabled =
      !modalFilteredIds || modalFilteredIds.size === allCount;
  }
  if (scopeRadioSelected) {
    scopeRadioSelected.disabled = selectedCount === 0;
  }

  // Default scope selection: if items are selected, default to selected; else all
  if (selectedCount > 0 && scopeRadioSelected) {
    scopeRadioSelected.checked = true;
    currentScope = 'selected';
  } else {
    if (scopeRadioAll) scopeRadioAll.checked = true;
    currentScope = 'all';
  }

  // Open modal
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', 'true');
    dialog.classList.remove('hidden');
  }

  // Switch to initial tab
  const tabBtn =
    initialTab === 'findReplace'
      ? document.getElementById('tab-btn-find')
      : initialTab === 'cleanup'
        ? document.getElementById('tab-btn-cleanup')
        : document.getElementById('tab-btn-domain');
  if (tabBtn) tabBtn.click();
}
