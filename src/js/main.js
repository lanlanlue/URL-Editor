import { initDarkMode } from './darkMode.js';
import i18next, { updateContent } from './i18n.js';
import { createUrlCard } from './ui/urlCard.js';
import { initUrlEditor, loadUrlInEditor } from './editor.js';
import {
  initMaintenanceModal,
  openMaintenanceModal,
} from './ui/maintenanceModal.js';
import {
  initBatchImportModal,
  openBatchImportModal,
} from './ui/batchImportModal.js';
import { findDuplicateUrls } from './urlParser.js';

// DOM references
const exportBtn = document.getElementById('export-json-btn');
const importInput = document.getElementById('import-json-file');
const importBtn = document.getElementById('import-json-btn');
const openMaintenanceBtn = document.getElementById('open-maintenance-btn');
const openBatchImportBtn = document.getElementById('open-batch-import-btn');
const editorBatchImportBtn = document.getElementById('editor-batch-import-btn');

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

// --- 應用程式狀態管理 ---
let appState = {
  urls: [],
  activeTagFilter: null,
  searchTerm: '',
  selectedIds: new Set(),
  sortMode: 'created', // 'frequency' | 'recent' | 'created' | 'alpha'
};
const URL_HISTORY_KEY = 'urlHistory';

// 資料遷移：將舊格式的 localStorage 資料轉換為新的標籤格式
function migrateDataToV2() {
  const rawData = localStorage.getItem('urlHistory');
  if (!rawData) return;

  let data = JSON.parse(rawData);
  // 檢查是否為舊格式 (陣列且第一個元素是字串或沒有 id)
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

// 為缺少新欄位的已儲存資料補齊 (v3 遷移)
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

// 從 localStorage 載入狀態
function loadState() {
  const data = JSON.parse(localStorage.getItem(URL_HISTORY_KEY)) || {
    urls: [],
  };
  appState.urls = data.urls;
  appState.sortMode = data.sortMode || 'created';
}

// 將狀態儲存到 localStorage
function saveState() {
  localStorage.setItem(
    URL_HISTORY_KEY,
    JSON.stringify({ urls: appState.urls, sortMode: appState.sortMode })
  );
}

// 追蹤 URL 使用 (load / copy / open)
function trackUrlUsage(id) {
  const urlEntry = appState.urls.find((u) => u.id === id);
  if (urlEntry) {
    urlEntry.usageCount = (urlEntry.usageCount || 0) + 1;
    urlEntry.lastUsed = Date.now();
    saveState();
    // Re-render only if sort depends on usage
    if (
      appState.sortMode === 'frequency' ||
      appState.sortMode === 'recent'
    ) {
      renderUrlList();
    } else {
      // Just update the badge in-place via data attribute
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

// 排序 URLs
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
        return [...arr].sort(
          (a, b) => (b.lastUsed || 0) - (a.lastUsed || 0)
        );
      case 'alpha':
        return [...arr].sort((a, b) => {
          const la = (a.label || a.url).toLowerCase();
          const lb = (b.label || b.url).toLowerCase();
          return la < lb ? -1 : la > lb ? 1 : 0;
        });
      case 'created':
      default:
        return [...arr].sort(
          (a, b) => (b.createdAt || 0) - (a.createdAt || 0)
        );
    }
  };

  return [...sort(pinned), ...sort(unpinned)];
}

// 儲存 URL 到 localStorage（避免重複）
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

// 更新卡片屬性 (通用函數)
function updateCardProperty(id, property, value) {
  const urlIndex = appState.urls.findIndex((u) => u.id === id);
  if (urlIndex > -1) {
    appState.urls[urlIndex][property] = value;
    saveState();
    renderUrlList(); // 重新渲染以更新標籤過濾器
  }
}

// 渲染標籤過濾按鈕
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

// 更新批次操作列介面
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

  // Disable/enable batch action buttons based on selection count
  const hasSelection = count > 0;
  if (batchReplaceDomainBtn) batchReplaceDomainBtn.disabled = !hasSelection;
  if (batchAddTagBtn) batchAddTagBtn.disabled = !hasSelection;
  if (batchExportBtn) batchExportBtn.disabled = !hasSelection;
  if (batchDeleteBtn) batchDeleteBtn.disabled = !hasSelection;
}

// 取得目前過濾後的 URLs
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

// 渲染 URL 清單
function renderUrlList() {
  const container = document.getElementById('url-cards-container');
  const emptyMessage = document.getElementById('empty-list-message');
  if (!container || !emptyMessage) return;

  container.innerHTML = '';
  const urlsToRender = getFilteredUrls();

  // 清除已不存在於 urls 中的 selectedIds
  const existingIds = new Set(appState.urls.map((u) => u.id));
  appState.selectedIds.forEach((id) => {
    if (!existingIds.has(id)) {
      appState.selectedIds.delete(id);
    }
  });

  if (urlsToRender.length > 0) {
    emptyMessage.classList.add('hidden');
    urlsToRender.forEach((entry) => {
      const isSelected = appState.selectedIds.has(entry.id);
      const card = createUrlCard(
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
          onPin: (id, isPinned) => {
            updateCardProperty(id, 'isPinned', isPinned);
          },
          onDelete: (id) => {
            appState.urls = appState.urls.filter(
              (urlEntry) => urlEntry.id !== id
            );
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
      container.appendChild(card);
    });
  } else {
    emptyMessage.classList.remove('hidden');
  }

  renderTagFilters();
  updateBatchActionBar(urlsToRender);
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
        appState.urls = importedData.urls; // 直接更新記憶體狀態
        appState.selectedIds.clear();
        saveState(); // 儲存到 localStorage
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

// 批次清理重複 URL
function cleanupDuplicateUrls() {
  const { duplicates } = findDuplicateUrls(appState.urls);
  if (duplicates.length === 0) return 0;

  const idsToRemove = new Set();
  duplicates.forEach((item) => {
    // 保留最後一筆，移除前面重複的 ID
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
loadState(); // 頁面載入時，先從 localStorage 載入資料到記憶體
migrateDataToV2(); // 頁面載入時檢查並遷移資料 (v2: id/tags)
migrateDataToV3(); // 頁面載入時補齊 usage / pin 欄位 (v3)
initDarkMode();
initUrlEditor({
  onSave: saveUrlToHistory,
});
initMaintenanceModal();
initBatchImportModal();

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

// 匯入匯出按鈕初始化
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

// 維護工具彈窗按鈕
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

// 批次全選 / 取消全選
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

// 批次替換 Domain 按鈕（由工具列開啟彈窗並鎖定 selected 範圍）
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

// 批次新增標籤
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

// 批次匯出選取項目
if (batchExportBtn) {
  batchExportBtn.addEventListener('click', () => {
    if (appState.selectedIds.size === 0) return;
    const selectedEntries = appState.urls.filter((entry) =>
      appState.selectedIds.has(entry.id)
    );
    exportUrlJson(selectedEntries, 'selected-urls.json');
  });
}

// 批次刪除選取項目
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

// --- 搜尋 URL 清單功能 ---
const searchInput = document.getElementById('search-url');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    appState.searchTerm = e.target.value;
    renderUrlList();
  });
}

// 初始化 i18n 並更新內容
i18next.init().then(() => {
  // 更新靜態內容和頁面屬性
  document.documentElement.lang = i18next.language;
  document.title = i18next.t('appTitle');
  updateContent();

  // 首次渲染列表
  renderUrlList();

  console.log('i18next initialized, rendering content...');

  const langSwitcher = document.getElementById('language-switcher');
  if (langSwitcher) {
    langSwitcher.value = i18next.language;

    // 語言切換器事件
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
