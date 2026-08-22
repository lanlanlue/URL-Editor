import { initDarkMode } from './core/darkMode.js';
import i18next, { updateContent } from './core/i18n.js';
import { createUrlCard } from './ui/components/urlCard.js';
import { initUrlEditor, loadUrlInEditor } from './ui/components/editor.js';
import {
  initMaintenanceModal,
  openMaintenanceModal,
} from './ui/modals/maintenanceModal.js';
import {
  initBatchImportModal,
  openBatchImportModal,
} from './ui/modals/batchImportModal.js';
import { initQrCodeModal, openQrCodeModal } from './ui/modals/qrCodeModal.js';
import { initPresetModal } from './ui/modals/presetModal.js';
import {
  initTagManagerModal,
  openTagManagerModal,
} from './ui/modals/tagManagerModal.js';
import { exportToCsvString, parseCsvString } from './utils/csvParser.js';
import { checkUrlHealth } from './utils/healthCheck.js';

import { findDuplicateUrls } from './core/urlParser.js';

// DOM references
const exportBtn = document.getElementById('export-json-btn');
const importInput = document.getElementById('import-json-file');
const importBtn = document.getElementById('import-json-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const importCsvInput = document.getElementById('import-csv-file');
const importCsvBtn = document.getElementById('import-csv-btn');
const openMaintenanceBtn = document.getElementById('open-maintenance-btn');
const openBatchImportBtn = document.getElementById('open-batch-import-btn');
const editorBatchImportBtn = document.getElementById('editor-batch-import-btn');
const openTagManagerBtn = document.getElementById('open-tag-manager-btn');

// View Mode DOM references
const viewModeCardsBtn = document.getElementById('view-mode-cards-btn');
const viewModeGroupedBtn = document.getElementById('view-mode-grouped-btn');
const accordionControls = document.getElementById('accordion-controls');
const accordionExpandAll = document.getElementById('accordion-expand-all');
const accordionCollapseAll = document.getElementById('accordion-collapse-all');

// Batch action bar DOM references
const batchActionBar = document.getElementById('batch-action-bar');
const batchSelectAllCheckbox = document.getElementById(
  'batch-select-all-checkbox'
);
const batchSelectAllText = document.getElementById('batch-select-all-text');
const batchSelectedCountBadge = document.getElementById(
  'batch-selected-count-badge'
);
const batchReplaceDomainBtn = document.getElementById(
  'batch-replace-domain-btn'
);
const batchAddTagBtn = document.getElementById('batch-add-tag-btn');
const batchExportBtn = document.getElementById('batch-export-btn');
const batchDeleteBtn = document.getElementById('batch-delete-btn');
const batchCheckHealthBtn = document.getElementById('batch-check-health-btn');

// --- 應用程式狀態管理 ---
let appState = {
  urls: [],
  activeTagFilter: null,
  searchTerm: '',
  selectedIds: new Set(),
  sortMode: 'created', // 'frequency' | 'recent' | 'created' | 'alpha'
  viewMode: 'cards', // 'cards' | 'grouped'
};
const URL_HISTORY_KEY = 'urlHistory';

function extractDomain(urlStr) {
  try {
    const urlObj = new URL(urlStr);
    return urlObj.hostname || urlObj.host || 'Other';
  } catch (e) {
    return 'Other';
  }
}

// 資料遷移：將舊格式的 localStorage 資料轉換為新的標籤格式
function migrateDataToV2() {
  const rawData = localStorage.getItem('urlHistory');
  if (!rawData) return;

  let data = JSON.parse(rawData);
  if (
    Array.isArray(data) &&
    data.length > 0 &&
    (typeof data[0] === 'string' || data[0].id === undefined)
  ) {
    console.log('偵測到舊版資料，正在進行遷移...');
    const now = Date.now();
    const newUrls = data.map((entry) => {
      const oldUrl = typeof entry === 'string' ? entry : entry.url;
      const oldLabel = typeof entry === 'string' ? '' : entry.label;
      return {
        id: self.crypto.randomUUID(),
        url: oldUrl,
        label: oldLabel || '',
        tags: [],
        usageCount: 0,
        lastUsed: now,
        createdAt: now,
        isPinned: false,
      };
    });
    localStorage.setItem(URL_HISTORY_KEY, JSON.stringify({ urls: newUrls }));
    console.log('資料遷移完成！');
  }
}

function migrateDataToV3() {
  const now = Date.now();
  let changed = false;
  appState.urls = appState.urls.map((entry) => {
    if (
      entry.usageCount === undefined ||
      entry.lastUsed === undefined ||
      entry.createdAt === undefined ||
      entry.isPinned === undefined
    ) {
      changed = true;
      return {
        usageCount: 0,
        lastUsed: now,
        createdAt: now,
        isPinned: false,
        ...entry,
      };
    }
    return entry;
  });
  if (changed) saveState();
}

function loadState() {
  const data = JSON.parse(localStorage.getItem(URL_HISTORY_KEY)) || {
    urls: [],
  };
  appState.urls = data.urls;
  appState.sortMode = data.sortMode || 'created';
  appState.viewMode = data.viewMode || 'cards';
}

function saveState() {
  localStorage.setItem(
    URL_HISTORY_KEY,
    JSON.stringify({
      urls: appState.urls,
      sortMode: appState.sortMode,
      viewMode: appState.viewMode,
    })
  );
}

function trackUrlUsage(id) {
  const urlEntry = appState.urls.find((u) => u.id === id);
  if (urlEntry) {
    urlEntry.usageCount = (urlEntry.usageCount || 0) + 1;
    urlEntry.lastUsed = Date.now();
    saveState();
    if (appState.sortMode === 'frequency' || appState.sortMode === 'recent') {
      renderUrlList();
    } else {
      const badge = document.querySelector(
        `[data-url-id="${id}"] .url-card__usage-badge`
      );
      if (badge) {
        badge.textContent = `🔥 ${urlEntry.usageCount}`;
        badge.style.display = '';
      }
    }
  }
}

function getSortedUrls(urls) {
  const pinned = urls.filter((u) => u.isPinned);
  const unpinned = urls.filter((u) => !u.isPinned);

  const sort = (arr) => {
    switch (appState.sortMode) {
      case 'frequency':
        return [...arr].sort(
          (a, b) => (b.usageCount || 0) - (a.usageCount || 0)
        );
      case 'recent':
        return [...arr].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
      case 'alpha':
        return [...arr].sort((a, b) => {
          const la = (a.label || a.url).toLowerCase();
          const lb = (b.label || b.url).toLowerCase();
          return la < lb ? -1 : la > lb ? 1 : 0;
        });
      case 'created':
      default:
        return [...arr].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
  };

  return [...sort(pinned), ...sort(unpinned)];
}

function saveUrlToHistory(url) {
  const existing = appState.urls.find((entry) => entry.url === url);

  if (!existing) {
    const now = Date.now();
    const newEntry = {
      id: self.crypto.randomUUID(),
      url,
      label: '',
      tags: [],
      usageCount: 0,
      lastUsed: now,
      createdAt: now,
      isPinned: false,
    };
    appState.urls.push(newEntry);
    saveState();
    renderUrlList();
  }
}

function updateCardProperty(id, property, value) {
  const urlIndex = appState.urls.findIndex((u) => u.id === id);
  if (urlIndex > -1) {
    appState.urls[urlIndex][property] = value;
    saveState();
    renderUrlList();
  }
}

function renderTagFilters() {
  const allTags = new Set(appState.urls.flatMap((url) => url.tags));
  const filtersContainer = document.getElementById('tag-filters');
  if (!filtersContainer) return;
  filtersContainer.innerHTML = '';

  const createFilterButton = (tag, text) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    if (appState.activeTagFilter === tag) {
      btn.classList.add('active');
    }
    btn.onclick = () => {
      appState.activeTagFilter = tag;
      renderUrlList();
    };
    filtersContainer.appendChild(btn);
  };

  createFilterButton(null, i18next.t('urlList.allTags'));
  allTags.forEach((tag) => createFilterButton(tag, tag));
}

function updateBatchActionBar(urlsToRender = []) {
  if (!batchActionBar) return;

  const count = appState.selectedIds.size;
  const renderedCount = urlsToRender.length;

  if (renderedCount > 0) {
    batchActionBar.classList.remove('hidden');
  } else {
    batchActionBar.classList.add('hidden');
    return;
  }

  if (batchSelectedCountBadge) {
    batchSelectedCountBadge.textContent = i18next.t(
      'urlList.batch.selectedCount',
      { count }
    );
  }

  if (batchSelectAllCheckbox) {
    const allRenderedSelected =
      renderedCount > 0 &&
      urlsToRender.every((u) => appState.selectedIds.has(u.id));
    const someRenderedSelected =
      !allRenderedSelected &&
      urlsToRender.some((u) => appState.selectedIds.has(u.id));

    batchSelectAllCheckbox.checked = allRenderedSelected;
    batchSelectAllCheckbox.indeterminate = someRenderedSelected;

    if (batchSelectAllText) {
      batchSelectAllText.textContent = allRenderedSelected
        ? i18next.t('urlList.batch.deselectAll')
        : i18next.t('urlList.batch.selectAll');
    }
  }

  const hasSelection = count > 0;
  if (batchReplaceDomainBtn) batchReplaceDomainBtn.disabled = !hasSelection;
  if (batchAddTagBtn) batchAddTagBtn.disabled = !hasSelection;
  if (batchExportBtn) batchExportBtn.disabled = !hasSelection;
  if (batchDeleteBtn) batchDeleteBtn.disabled = !hasSelection;
  if (batchCheckHealthBtn) batchCheckHealthBtn.disabled = !hasSelection;
}

function getFilteredUrls() {
  let urlsToRender = [...appState.urls];

  if (appState.activeTagFilter) {
    urlsToRender = urlsToRender.filter((u) =>
      u.tags.includes(appState.activeTagFilter)
    );
  }

  if (appState.searchTerm) {
    const lowerCaseSearch = appState.searchTerm.toLowerCase();
    urlsToRender = urlsToRender.filter((u) =>
      Object.values(u).join(' ').toLowerCase().includes(lowerCaseSearch)
    );
  }

  return getSortedUrls(urlsToRender);
}

// User-triggered single URL health check
async function runSingleHealthCheck(targetUrl, targetId) {
  const entry = appState.urls.find((u) => u.id === targetId);
  if (entry) {
    entry.healthStatus = 'checking';
    renderUrlList();

    const res = await checkUrlHealth(targetUrl);
    entry.healthStatus = res.status;
    renderUrlList();
  }
}

function createCardElement(entry, urlsToRender) {
  const isSelected = appState.selectedIds.has(entry.id);
  return createUrlCard(
    entry,
    {
      onUpdate: updateCardProperty,
      onLoad: (url, id) => {
        trackUrlUsage(id);
        loadUrlInEditor(url);
      },
      onCopy: (id) => {
        trackUrlUsage(id);
      },
      onOpen: (url, id) => {
        trackUrlUsage(id);
        window.open(url, '_blank', 'noopener,noreferrer');
      },
      onQrCode: (url, title) => {
        openQrCodeModal(url, title);
      },
      onCheckHealth: (url, id) => {
        runSingleHealthCheck(url, id);
      },
      onPin: (id, isPinned) => {
        updateCardProperty(id, 'isPinned', isPinned);
      },
      onDelete: (id) => {
        appState.urls = appState.urls.filter((urlEntry) => urlEntry.id !== id);
        appState.selectedIds.delete(id);
        saveState();
        renderUrlList();
      },
      onToggleSelect: (id, checked) => {
        if (checked) {
          appState.selectedIds.add(id);
        } else {
          appState.selectedIds.delete(id);
        }
        updateBatchActionBar(urlsToRender);
      },
    },
    isSelected
  );
}

// 渲染 URL 清單 (支援 📋 卡片模式與 📁 Domain 分組 Accordion)
function renderUrlList() {
  const container = document.getElementById('url-cards-container');
  const emptyMessage = document.getElementById('empty-list-message');
  if (!container || !emptyMessage) return;

  container.innerHTML = '';
  const urlsToRender = getFilteredUrls();

  const existingIds = new Set(appState.urls.map((u) => u.id));
  appState.selectedIds.forEach((id) => {
    if (!existingIds.has(id)) {
      appState.selectedIds.delete(id);
    }
  });

  if (urlsToRender.length > 0) {
    emptyMessage.classList.add('hidden');

    if (appState.viewMode === 'grouped') {
      // Group by domain
      const groups = new Map();
      urlsToRender.forEach((entry) => {
        const domain = extractDomain(entry.url);
        if (!groups.has(domain)) groups.set(domain, []);
        groups.get(domain).push(entry);
      });

      groups.forEach((groupUrls, domainName) => {
        const accordion = document.createElement('details');
        accordion.className = 'domain-accordion';
        accordion.open = true;

        const summary = document.createElement('summary');
        summary.className = 'domain-accordion__summary';

        const title = document.createElement('span');
        title.className = 'domain-accordion__title';
        title.textContent = `🌐 ${domainName}`;

        const badge = document.createElement('span');
        badge.className = 'badge badge--secondary';
        badge.textContent = `${groupUrls.length}`;

        summary.appendChild(title);
        summary.appendChild(badge);
        accordion.appendChild(summary);

        const groupBody = document.createElement('div');
        groupBody.className = 'domain-accordion__body';

        groupUrls.forEach((entry) => {
          groupBody.appendChild(createCardElement(entry, urlsToRender));
        });

        accordion.appendChild(groupBody);
        container.appendChild(accordion);
      });
    } else {
      // Regular Cards grid
      urlsToRender.forEach((entry) => {
        container.appendChild(createCardElement(entry, urlsToRender));
      });
    }
  } else {
    emptyMessage.classList.remove('hidden');
  }

  renderTagFilters();
  updateBatchActionBar(urlsToRender);
  updateViewModeUI();
}

function updateViewModeUI() {
  if (viewModeCardsBtn && viewModeGroupedBtn) {
    if (appState.viewMode === 'grouped') {
      viewModeGroupedBtn.classList.add('active');
      viewModeCardsBtn.classList.remove('active');
      if (accordionControls) accordionControls.classList.remove('hidden');
    } else {
      viewModeCardsBtn.classList.add('active');
      viewModeGroupedBtn.classList.remove('active');
      if (accordionControls) accordionControls.classList.add('hidden');
    }
  }
}

function exportUrlJson(
  urlsToExport = appState.urls,
  filename = 'url-editor-data.json'
) {
  const data = { urls: urlsToExport };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function importUrlJson(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const importedData = JSON.parse(e.target.result);
      if (importedData && Array.isArray(importedData.urls)) {
        appState.urls = importedData.urls;
        appState.selectedIds.clear();
        saveState();
        renderUrlList();
        alert(
          i18next.t('urlList.importSuccess', {
            count: importedData.urls.length,
          })
        );
      } else {
        throw new Error(i18next.t('urlList.importError'));
      }
    } catch (err) {
      alert(i18next.t('urlList.importError'));
    }
  };
  reader.readAsText(file);
}

function exportUrlCsv(
  urlsToExport = appState.urls,
  filename = 'url-editor-data.csv'
) {
  const csvText = exportToCsvString(urlsToExport);
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function importUrlCsv(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsedItems = parseCsvString(e.target.result);
      if (parsedItems.length > 0) {
        const existingSet = new Set(appState.urls.map((u) => u.url));
        let count = 0;
        parsedItems.forEach((item) => {
          if (!existingSet.has(item.url)) {
            appState.urls.push({
              id: self.crypto?.randomUUID
                ? self.crypto.randomUUID()
                : `url-${Date.now()}-${Math.random()}`,
              url: item.url,
              label: item.label || '',
              tags: item.tags || [],
              usageCount: item.usageCount || 0,
              lastUsed: Date.now(),
              createdAt: Date.now(),
              isPinned: item.isPinned || false,
            });
            existingSet.add(item.url);
            count++;
          }
        });
        saveState();
        renderUrlList();
        alert(i18next.t('urlList.importSuccess', { count }));
      } else {
        alert(i18next.t('urlList.importError'));
      }
    } catch (err) {
      alert(i18next.t('urlList.importError'));
    }
  };
  reader.readAsText(file);
}

function cleanupDuplicateUrls() {
  const { duplicates } = findDuplicateUrls(appState.urls);
  if (duplicates.length === 0) return 0;

  const idsToRemove = new Set();
  duplicates.forEach((item) => {
    const removeList = item.ids.slice(0, item.ids.length - 1);
    removeList.forEach((id) => idsToRemove.add(id));
  });

  const removedCount = idsToRemove.size;
  appState.urls = appState.urls.filter((entry) => !idsToRemove.has(entry.id));
  idsToRemove.forEach((id) => appState.selectedIds.delete(id));
  saveState();
  renderUrlList();
  return removedCount;
}

// 初始化所有功能
loadState();
migrateDataToV2();
migrateDataToV3();
initDarkMode();
initUrlEditor({
  onSave: saveUrlToHistory,
  onQrCode: (url, title) => openQrCodeModal(url, title),
});
initMaintenanceModal();
initBatchImportModal();
initQrCodeModal();
initPresetModal();
initTagManagerModal();

// 視圖切換按鈕事件
if (viewModeCardsBtn) {
  viewModeCardsBtn.addEventListener('click', () => {
    appState.viewMode = 'cards';
    saveState();
    renderUrlList();
  });
}

if (viewModeGroupedBtn) {
  viewModeGroupedBtn.addEventListener('click', () => {
    appState.viewMode = 'grouped';
    saveState();
    renderUrlList();
  });
}

if (accordionExpandAll) {
  accordionExpandAll.addEventListener('click', () => {
    document.querySelectorAll('.domain-accordion').forEach((acc) => {
      acc.open = true;
    });
  });
}

if (accordionCollapseAll) {
  accordionCollapseAll.addEventListener('click', () => {
    document.querySelectorAll('.domain-accordion').forEach((acc) => {
      acc.open = false;
    });
  });
}

// 標籤管理按鈕
if (openTagManagerBtn) {
  openTagManagerBtn.addEventListener('click', () => {
    openTagManagerModal({
      urls: appState.urls,
      onUpdateUrls: (updated) => {
        appState.urls = updated;
        saveState();
        renderUrlList();
      },
    });
  });
}

// 排序選單
const sortSelect = document.getElementById('sort-select');
if (sortSelect) {
  sortSelect.value = appState.sortMode;
  sortSelect.addEventListener('change', (e) => {
    appState.sortMode = e.target.value;
    saveState();
    renderUrlList();
  });
}

// 批次貼上匯入處理
const handleBatchImportAction = () => {
  openBatchImportModal({
    existingUrls: appState.urls,
    callbacks: {
      onImport: (newItems) => {
        const existingSet = new Set(appState.urls.map((u) => u.url));
        newItems.forEach((item) => {
          if (!existingSet.has(item.url)) {
            appState.urls.push({
              id:
                item.id ||
                (self.crypto?.randomUUID
                  ? self.crypto.randomUUID()
                  : `url-${Date.now()}`),
              url: item.url,
              label: item.label || '',
              tags: item.tags || [],
            });
            existingSet.add(item.url);
          }
        });
        saveState();
        renderUrlList();
      },
    },
  });
};

if (openBatchImportBtn) {
  openBatchImportBtn.addEventListener('click', handleBatchImportAction);
}

if (editorBatchImportBtn) {
  editorBatchImportBtn.addEventListener('click', handleBatchImportAction);
}

if (exportBtn) exportBtn.addEventListener('click', () => exportUrlJson());

if (importInput) {
  importInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      importUrlJson(e.target.files[0]);
    }
  });
}

if (importBtn && importInput) {
  importBtn.addEventListener('click', () => importInput.click());
}

if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => exportUrlCsv());

if (importCsvInput) {
  importCsvInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      importUrlCsv(e.target.files[0]);
    }
  });
}

if (importCsvBtn && importCsvInput) {
  importCsvBtn.addEventListener('click', () => importCsvInput.click());
}

if (openMaintenanceBtn) {
  openMaintenanceBtn.addEventListener('click', () => {
    const filtered = getFilteredUrls();
    openMaintenanceModal({
      urls: appState.urls,
      filteredIds: new Set(filtered.map((u) => u.id)),
      selectedIds: appState.selectedIds,
      initialTab: 'domain',
      callbacks: {
        onBatchUpdate: (updatedUrls) => {
          appState.urls = updatedUrls;
          saveState();
          renderUrlList();
        },
        onCleanupDuplicates: cleanupDuplicateUrls,
      },
    });
  });
}

if (batchSelectAllCheckbox) {
  batchSelectAllCheckbox.addEventListener('change', (e) => {
    const rendered = getFilteredUrls();
    if (e.target.checked) {
      rendered.forEach((u) => appState.selectedIds.add(u.id));
    } else {
      rendered.forEach((u) => appState.selectedIds.delete(u.id));
    }
    renderUrlList();
  });
}

if (batchCheckHealthBtn) {
  batchCheckHealthBtn.addEventListener('click', () => {
    if (appState.selectedIds.size === 0) return;
    const selected = appState.urls.filter((u) =>
      appState.selectedIds.has(u.id)
    );
    selected.forEach((entry) => {
      runSingleHealthCheck(entry.url, entry.id);
    });
  });
}

if (batchReplaceDomainBtn) {
  batchReplaceDomainBtn.addEventListener('click', () => {
    if (appState.selectedIds.size === 0) return;
    const filtered = getFilteredUrls();
    openMaintenanceModal({
      urls: appState.urls,
      filteredIds: new Set(filtered.map((u) => u.id)),
      selectedIds: appState.selectedIds,
      initialTab: 'domain',
      callbacks: {
        onBatchUpdate: (updatedUrls) => {
          appState.urls = updatedUrls;
          saveState();
          renderUrlList();
        },
        onCleanupDuplicates: cleanupDuplicateUrls,
      },
    });
  });
}

if (batchAddTagBtn) {
  batchAddTagBtn.addEventListener('click', () => {
    if (appState.selectedIds.size === 0) return;
    const newTag = prompt(i18next.t('urlList.batch.promptAddTag'));
    if (!newTag || !newTag.trim()) return;

    const cleanTag = newTag.trim();
    appState.urls = appState.urls.map((entry) => {
      if (appState.selectedIds.has(entry.id)) {
        const existingTags = Array.isArray(entry.tags) ? entry.tags : [];
        if (!existingTags.includes(cleanTag)) {
          return { ...entry, tags: [...existingTags, cleanTag] };
        }
      }
      return entry;
    });

    saveState();
    renderUrlList();
  });
}

if (batchExportBtn) {
  batchExportBtn.addEventListener('click', () => {
    if (appState.selectedIds.size === 0) return;
    const selectedEntries = appState.urls.filter((entry) =>
      appState.selectedIds.has(entry.id)
    );
    exportUrlJson(selectedEntries, 'selected-urls.json');
  });
}

if (batchDeleteBtn) {
  batchDeleteBtn.addEventListener('click', () => {
    const count = appState.selectedIds.size;
    if (count === 0) return;

    const confirmed = confirm(
      i18next.t('urlList.batch.confirmDelete', { count })
    );
    if (!confirmed) return;

    appState.urls = appState.urls.filter(
      (entry) => !appState.selectedIds.has(entry.id)
    );
    appState.selectedIds.clear();
    saveState();
    renderUrlList();
  });
}

const searchInput = document.getElementById('search-url');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    appState.searchTerm = e.target.value;
    renderUrlList();
  });
}

i18next.init().then(() => {
  document.documentElement.lang = i18next.language;
  document.title = i18next.t('appTitle');
  updateContent();

  renderUrlList();

  console.log('i18next initialized, rendering content...');

  const langSwitcher = document.getElementById('language-switcher');
  if (langSwitcher) {
    langSwitcher.value = i18next.language;

    langSwitcher.addEventListener('change', (e) => {
      i18next.changeLanguage(e.target.value).then(() => {
        document.documentElement.lang = i18next.language;
        document.title = i18next.t('appTitle');
        updateContent();
        renderUrlList();
      });
    });
  }
});

console.log('🚀 頁面初始化完成');
