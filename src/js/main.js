import { initDarkMode } from './core/darkMode.js';
import i18next, { updateContent } from './core/i18n.js';
import { createUrlCard, createUrlRow } from './ui/components/urlCard.js';
import {
  configureEditorStorage,
  initUrlEditor,
  loadUrlInEditor,
} from './ui/components/editor.js';
import {
  initMaintenanceModal,
  openMaintenanceModal,
} from './ui/modals/maintenanceModal.js';
import {
  initBatchImportModal,
  openBatchImportModal,
} from './ui/modals/batchImportModal.js';
import { initQrCodeModal, openQrCodeModal } from './ui/modals/qrCodeModal.js';
import {
  configurePresetStorage,
  getPersistedPresets,
  initPresetModal,
} from './ui/modals/presetModal.js';
import {
  initTagManagerModal,
  openTagManagerModal,
} from './ui/modals/tagManagerModal.js';
import {
  initLiveTestModal,
  openLiveTestModal,
} from './ui/modals/liveTestModal.js';
import { exportToCsvString, parseCsvString } from './utils/csvParser.js';
import { checkUrlHealth } from './utils/healthCheck.js';
import { initExtensionBridge } from './core/extensionBridge.js';
import { loadSettings } from './core/settings.js';
import {
  initSettingsModal,
  openSettingsModal,
} from './ui/modals/settingsModal.js';
import {
  initUrlDiffModal,
  openUrlDiffModal,
} from './ui/modals/urlDiffModal.js';
import {
  initRedirectModal,
  openRedirectModal,
} from './ui/modals/redirectModal.js';
import {
  initializeSecureStorage,
  saveSecureState,
} from './core/secureStorage.js';
import { createSyncMetadata, getDeviceId } from './core/syncMerge.js';
import { initGuestAds } from './core/guestAds.js';
import { loadCloudSyncModule } from './core/cloudFeatureLoader.js';
import { CLOUD_ENABLED } from './core/runtimeConfig.js';

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
const openSettingsBtn = document.getElementById('open-settings-btn');
const openUrlDiffBtn = document.getElementById('open-url-diff-btn');
const openRedirectBtn = document.getElementById('open-redirect-btn');
let openCloudSyncBtn = document.getElementById('open-cloud-sync-btn');
const openBatchStripperBtn = document.getElementById('open-batch-stripper-btn');
const openUtmBtn = document.getElementById('open-utm-btn');

// View Mode DOM references
const viewModeTableBtn = document.getElementById('view-mode-table-btn');
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
const batchLiveTestBtn = document.getElementById('batch-live-test-btn');

// --- 應用程式狀態管理 ---
let appState = {
  urls: [],
  presets: undefined,
  rebuildHistory: [],
  tombstones: [],
  syncMetadata: createSyncMetadata(getDeviceId()),
  activeTagFilter: null,
  searchTerm: '',
  selectedIds: new Set(),
  sortMode: 'created', // 'frequency' | 'recent' | 'created' | 'alpha'
  viewMode: 'cards', // 'cards' | 'grouped'
};
let appSettings = loadSettings();
let marketingToolkitModulesPromise = null;
let lastPersistedEntities = new Map();
let lastPersistedPresetIds = new Set();
let lastPersistedPresetSnapshots = new Map();
const syncDeviceId = getDeviceId();
let initCloudSyncModal = null;
let openCloudSyncModal = null;

function createEntryId(candidate = '') {
  if (
    typeof candidate === 'string' &&
    /^[A-Za-z0-9_-]{1,100}$/.test(candidate)
  ) {
    return candidate;
  }
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `url-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUrlEntries(entries = []) {
  if (!Array.isArray(entries)) return [];
  const now = Date.now();
  return entries
    .map((entry) => {
      const rawUrl = typeof entry === 'string' ? entry : entry?.url;
      if (
        typeof rawUrl !== 'string' ||
        !rawUrl.trim() ||
        rawUrl.length > 20000
      ) {
        return null;
      }
      try {
        new URL(rawUrl.trim());
      } catch {
        return null;
      }
      const source = typeof entry === 'object' && entry ? entry : {};
      return {
        ...source,
        id: createEntryId(source.id),
        url: rawUrl.trim(),
        label:
          typeof source.label === 'string' ? source.label.slice(0, 500) : '',
        tags: Array.isArray(source.tags)
          ? source.tags
              .filter((tag) => typeof tag === 'string')
              .map((tag) => tag.trim().slice(0, 100))
              .filter(Boolean)
          : [],
        usageCount: Number.isFinite(source.usageCount)
          ? Math.max(0, source.usageCount)
          : 0,
        lastUsed: Number.isFinite(source.lastUsed) ? source.lastUsed : now,
        createdAt: Number.isFinite(source.createdAt) ? source.createdAt : now,
        isPinned: source.isPinned === true,
      };
    })
    .filter(Boolean);
}

function applyMarketingToolkitVisibility(enabled) {
  document.querySelectorAll('[data-marketing-toolkit]').forEach((element) => {
    element.classList.toggle('hidden', !enabled);
    element.hidden = !enabled;
    element.setAttribute('aria-hidden', String(!enabled));
  });
}

function ensureMarketingToolkitModules() {
  if (!marketingToolkitModulesPromise) {
    marketingToolkitModulesPromise = Promise.all([
      import('./ui/modals/batchStripperModal.js'),
      import('./ui/modals/utmModal.js'),
    ]).then(([stripper, utm]) => {
      stripper.initBatchStripperModal();
      utm.initUtmModal();
      return { stripper, utm };
    });
  }
  return marketingToolkitModulesPromise;
}

function handleSettingsChange(nextSettings) {
  appSettings = nextSettings;
  applyMarketingToolkitVisibility(appSettings.enableMarketingToolkit);
  if (appSettings.enableMarketingToolkit) ensureMarketingToolkitModules();
}

function extractDomain(urlStr) {
  try {
    const urlObj = new URL(urlStr);
    return urlObj.hostname || urlObj.host || 'Other';
  } catch (e) {
    return 'Other';
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

function applyLoadedState(data) {
  let nextData = data || { urls: [] };
  if (Array.isArray(nextData)) nextData = { urls: nextData };
  appState.urls = normalizeUrlEntries(nextData.urls);
  appState.sortMode = nextData.sortMode || 'created';
  appState.viewMode = nextData.viewMode || 'cards';
  appState.presets = Array.isArray(nextData.presets)
    ? nextData.presets
    : undefined;
  appState.rebuildHistory = Array.isArray(nextData.rebuildHistory)
    ? nextData.rebuildHistory
    : [];
  appState.tombstones = Array.isArray(nextData.tombstones)
    ? nextData.tombstones
    : [];
  appState.syncMetadata =
    nextData.syncMetadata || createSyncMetadata(syncDeviceId);
  lastPersistedEntities = new Map(
    appState.urls.map((entry) => [entry.id, JSON.stringify(entry)])
  );
  lastPersistedPresetIds = new Set(
    Array.isArray(appState.presets)
      ? appState.presets.map((preset) => preset.id)
      : []
  );
  lastPersistedPresetSnapshots = new Map(
    (Array.isArray(appState.presets) ? appState.presets : []).map((preset) => [
      preset.id,
      {
        signature: JSON.stringify({
          ...preset,
          syncUpdatedAt: undefined,
          syncDeviceId: undefined,
        }),
        entity: preset,
      },
    ])
  );
}

function loadState() {
  const initialized = initializeSecureStorage();
  if (initialized && typeof initialized.then === 'function') {
    return initialized.then(applyLoadedState);
  }
  applyLoadedState(initialized);
  return null;
}

function stampChangedEntities() {
  const now = Date.now();
  appState.urls = appState.urls.map((entry) => {
    const previous = lastPersistedEntities.get(entry.id);
    const current = JSON.stringify(entry);
    if (!previous || previous !== current) {
      return {
        ...entry,
        syncUpdatedAt: now,
        syncDeviceId,
      };
    }
    return entry;
  });
  appState.syncMetadata = createSyncMetadata(syncDeviceId, now);
  lastPersistedEntities = new Map(
    appState.urls.map((entry) => [entry.id, JSON.stringify(entry)])
  );
}

function markDeletedEntries(ids = []) {
  const now = Date.now();
  const known = new Map(appState.tombstones.map((item) => [item.id, item]));
  ids.filter(Boolean).forEach((id) => {
    known.set(id, {
      id,
      deletedAt: now,
      syncUpdatedAt: now,
      syncDeviceId,
    });
  });
  appState.tombstones = [...known.values()];
}

function saveState() {
  stampChangedEntities();
  const now = Date.now();
  const rawPresets = getPersistedPresets();
  const presets = rawPresets.map((preset) => {
    const signature = JSON.stringify({
      ...preset,
      syncUpdatedAt: undefined,
      syncDeviceId: undefined,
    });
    const previous = lastPersistedPresetSnapshots.get(preset.id);
    if (!previous || previous.signature !== signature) {
      return { ...preset, syncUpdatedAt: now, syncDeviceId };
    }
    return {
      ...preset,
      syncUpdatedAt: previous.entity.syncUpdatedAt,
      syncDeviceId: previous.entity.syncDeviceId,
    };
  });
  const state = {
    schemaVersion: 1,
    urls: appState.urls,
    presets,
    rebuildHistory: appState.rebuildHistory,
    tombstones: appState.tombstones,
    sortMode: appState.sortMode,
    viewMode: appState.viewMode,
    syncMetadata: appState.syncMetadata,
  };
  appState.presets = state.presets;
  lastPersistedPresetSnapshots = new Map(
    state.presets.map((preset) => [
      preset.id,
      {
        signature: JSON.stringify({
          ...preset,
          syncUpdatedAt: undefined,
          syncDeviceId: undefined,
        }),
        entity: preset,
      },
    ])
  );
  const currentPresetIds = new Set(
    state.presets.map((preset) => preset.id).filter(Boolean)
  );
  markDeletedEntries(
    [...lastPersistedPresetIds]
      .filter((id) => !currentPresetIds.has(id))
      .map((id) => `preset:${id}`)
  );
  lastPersistedPresetIds = currentPresetIds;
  state.tombstones = appState.tombstones;
  void saveSecureState(state).catch((error) => {
    console.error('Failed to persist encrypted application state.', error);
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('url-editor-data-change', { detail: state })
    );
  }
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
      const tableUsage = document.querySelector(
        `[data-url-id="${id}"] .url-table__usage`
      );
      if (tableUsage) {
        tableUsage.textContent = `🔥 ${urlEntry.usageCount}`;
      } else {
        const tdUsage = document.querySelector(
          `[data-url-id="${id}"] .url-table__col-usage`
        );
        if (tdUsage) {
          const usageEl = document.createElement('span');
          usageEl.className = 'url-table__usage';
          usageEl.textContent = `🔥 ${urlEntry.usageCount}`;
          tdUsage.appendChild(usageEl);
        }
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
      id: createEntryId(),
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
  if (batchLiveTestBtn) batchLiveTestBtn.disabled = !hasSelection;
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

// 建立共用 callbacks 物件（卡片與表格行列共用）
function _makeCallbacks(urlsToRender) {
  return {
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
      markDeletedEntries([id]);
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
      // 更新統計
      const statSelected = document.getElementById('stat-selected');
      if (statSelected) statSelected.textContent = appState.selectedIds.size;
    },
  };
}

function createCardElement(entry, urlsToRender) {
  const isSelected = appState.selectedIds.has(entry.id);
  return createUrlCard(entry, _makeCallbacks(urlsToRender), isSelected);
}

// 更新 workspace count badge 與 sidebar 統計欄
function _updateStatBadges(urlsToRender) {
  const countBadge = document.getElementById('workspace-count-badge');
  if (countBadge) {
    countBadge.textContent = `${urlsToRender.length} 筆`;
  }
  const statTotal = document.getElementById('stat-total');
  if (statTotal) statTotal.textContent = appState.urls.length;
  const statFiltered = document.getElementById('stat-filtered');
  if (statFiltered) statFiltered.textContent = urlsToRender.length;
  const statSelected = document.getElementById('stat-selected');
  if (statSelected) statSelected.textContent = appState.selectedIds.size;
}

// 渲染 URL 清單（支援 表格 / 卡片 / Domain 分組 三種視圖）
function renderUrlList() {
  const container = document.getElementById('url-cards-container');
  const emptyMessage = document.getElementById('empty-list-message');
  if (!container || !emptyMessage) return;

  container.innerHTML = '';
  const urlsToRender = getFilteredUrls();

  // 清理已刪除條目的選取狀態
  const existingIds = new Set(appState.urls.map((u) => u.id));
  appState.selectedIds.forEach((id) => {
    if (!existingIds.has(id)) appState.selectedIds.delete(id);
  });

  // 更新統計 Badge
  _updateStatBadges(urlsToRender);

  if (urlsToRender.length === 0) {
    emptyMessage.classList.remove('hidden');
    renderTagFilters();
    updateBatchActionBar(urlsToRender);
    updateViewModeUI();
    return;
  }

  emptyMessage.classList.add('hidden');

  if (appState.viewMode === 'table') {
    // ── 表格模式 ──────────────────────────────────────────
    container.className = 'view--table';

    const wrapper = document.createElement('div');
    wrapper.className = 'url-table-wrapper';

    const table = document.createElement('table');
    table.className = 'url-table';

    // 表頭
    const thead = document.createElement('thead');
    thead.className = 'url-table__head';
    thead.innerHTML = `
      <tr>
        <th class="col-check url-table__col-check"></th>
        <th class="col-pin url-table__col-pin"></th>
        <th class="col-favicon url-table__col-favicon"></th>
        <th class="col-label url-table__col-label">${i18next.t('urlList.table.name', { defaultValue: '名稱' })}</th>
        <th class="col-url url-table__col-url">${i18next.t('urlList.table.url', { defaultValue: 'URL' })}</th>
        <th class="col-tags url-table__col-tags">${i18next.t('urlList.table.tags', { defaultValue: '標籤' })}</th>
        <th class="col-health url-table__col-health">${i18next.t('urlList.table.health', { defaultValue: '狀態' })}</th>
        <th class="col-usage url-table__col-usage">${i18next.t('urlList.table.usage', { defaultValue: '使用次數' })}</th>
        <th class="col-actions url-table__col-actions">${i18next.t('urlList.table.actions', { defaultValue: '操作' })}</th>
      </tr>`;
    table.appendChild(thead);

    // 表身
    const tbody = document.createElement('tbody');
    urlsToRender.forEach((entry) => {
      const isSelected = appState.selectedIds.has(entry.id);
      tbody.appendChild(
        createUrlRow(entry, _makeCallbacks(urlsToRender), isSelected)
      );
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    container.appendChild(wrapper);
  } else if (appState.viewMode === 'grouped') {
    // ── Domain 分組模式 ────────────────────────────────────
    container.className = 'view--grouped';

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

      const titleSpan = document.createElement('span');
      titleSpan.className = 'domain-accordion__title';
      titleSpan.textContent = `🌐 ${domainName}`;

      const badge = document.createElement('span');
      badge.className = 'badge badge--secondary';
      badge.textContent = `${groupUrls.length}`;

      summary.appendChild(titleSpan);
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
    // ── 卡片模式 ──────────────────────────────────────────
    container.className = 'view--cards';
    urlsToRender.forEach((entry) => {
      container.appendChild(createCardElement(entry, urlsToRender));
    });
  }

  renderTagFilters();
  updateBatchActionBar(urlsToRender);
  updateViewModeUI();
}

function updateViewModeUI() {
  [viewModeTableBtn, viewModeCardsBtn, viewModeGroupedBtn].forEach((btn) => {
    if (btn) btn.classList.remove('active');
  });

  if (appState.viewMode === 'table' && viewModeTableBtn) {
    viewModeTableBtn.classList.add('active');
    if (accordionControls) accordionControls.classList.add('hidden');
  } else if (appState.viewMode === 'grouped' && viewModeGroupedBtn) {
    viewModeGroupedBtn.classList.add('active');
    if (accordionControls) accordionControls.classList.remove('hidden');
  } else if (viewModeCardsBtn) {
    viewModeCardsBtn.classList.add('active');
    if (accordionControls) accordionControls.classList.add('hidden');
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
        appState.urls = normalizeUrlEntries(importedData.urls);
        appState.selectedIds.clear();
        saveState();
        renderUrlList();
        alert(
          i18next.t('urlList.importSuccess', {
            count: appState.urls.length,
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
            const [entry] = normalizeUrlEntries([
              {
                id: createEntryId(),
                url: item.url,
                label: item.label || '',
                tags: item.tags || [],
                usageCount: item.usageCount || 0,
                lastUsed: Date.now(),
                createdAt: Date.now(),
                isPinned: item.isPinned || false,
              },
            ]);
            if (!entry) return;
            appState.urls.push(entry);
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
  markDeletedEntries([...idsToRemove]);
  appState.urls = appState.urls.filter((entry) => !idsToRemove.has(entry.id));
  idsToRemove.forEach((id) => appState.selectedIds.delete(id));
  saveState();
  renderUrlList();
  return removedCount;
}

// 初始化介面與字體大小縮放
function initUiScale() {
  const scaleSelect = document.getElementById('ui-scale-select');
  const savedScale = localStorage.getItem('uiScale') || 'normal';

  const applyScale = (scale) => {
    document.documentElement.classList.remove(
      'scale-compact',
      'scale-normal',
      'scale-medium',
      'scale-large',
      'scale-xlarge'
    );
    document.documentElement.classList.add(`scale-${scale}`);
    localStorage.setItem('uiScale', scale);
    if (scaleSelect) scaleSelect.value = scale;
  };

  applyScale(savedScale);

  if (scaleSelect) {
    scaleSelect.addEventListener('change', (e) => {
      applyScale(e.target.value);
    });
  }
}

// 初始化左右面板拖曳調整寬度 (Panel Resizer)
function initPanelResizer() {
  const resizer = document.getElementById('panel-resizer');
  const sidebar = document.querySelector('.sidebar');
  const appBody = document.querySelector('.app-body');
  if (!resizer || !sidebar || !appBody) return;

  const savedWidth = localStorage.getItem('sidebarWidth');
  if (savedWidth && window.innerWidth > 768) {
    sidebar.style.flex = `0 0 ${savedWidth}px`;
  }

  let isDragging = false;

  const startDragging = () => {
    if (window.innerWidth <= 768) return;
    isDragging = true;
    resizer.classList.add('is-dragging');
    document.body.classList.add('is-resizing');
  };

  const onDrag = (e) => {
    if (!isDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const bodyRect = appBody.getBoundingClientRect();
    let newWidth = clientX - bodyRect.left;

    // 限制在安全範圍：最小 320px，最大為總寬度扣除 320px
    const minW = 320;
    const maxW = Math.max(minW, bodyRect.width - 320);
    newWidth = Math.max(minW, Math.min(newWidth, maxW));

    sidebar.style.flex = `0 0 ${newWidth}px`;
  };

  const stopDragging = () => {
    if (!isDragging) return;
    isDragging = false;
    resizer.classList.remove('is-dragging');
    document.body.classList.remove('is-resizing');

    const finalWidth = sidebar.getBoundingClientRect().width;
    localStorage.setItem('sidebarWidth', Math.round(finalWidth));
  };

  resizer.addEventListener('mousedown', startDragging);
  resizer.addEventListener('touchstart', startDragging, { passive: true });

  window.addEventListener('mousemove', onDrag);
  window.addEventListener('touchmove', onDrag, { passive: true });

  window.addEventListener('mouseup', stopDragging);
  window.addEventListener('touchend', stopDragging);
}

function restoreCloudData(data) {
  if (!data || !Array.isArray(data.urls)) return;
  appState.urls = normalizeUrlEntries(data.urls);
  if (Array.isArray(data.presets)) appState.presets = data.presets;
  if (Array.isArray(data.rebuildHistory)) {
    appState.rebuildHistory = data.rebuildHistory;
  }
  if (Array.isArray(data.tombstones)) appState.tombstones = data.tombstones;
  appState.selectedIds.clear();
  if (['created', 'frequency', 'recent', 'alpha'].includes(data.sortMode)) {
    appState.sortMode = data.sortMode;
  }
  if (['cards', 'table', 'grouped'].includes(data.viewMode)) {
    appState.viewMode = data.viewMode;
  }
  saveState();
  renderUrlList();
}

function getCurrentState() {
  return {
    schemaVersion: 1,
    urls: appState.urls,
    presets: getPersistedPresets(),
    rebuildHistory: appState.rebuildHistory,
    tombstones: appState.tombstones,
    sortMode: appState.sortMode,
    viewMode: appState.viewMode,
    syncMetadata: appState.syncMetadata,
  };
}

// 初始化所有功能
async function bootstrap() {
  const stateLoading = loadState();
  if (stateLoading) await stateLoading;
  if (CLOUD_ENABLED) {
    const cloudSync = await loadCloudSyncModule();
    initCloudSyncModal = cloudSync.initCloudSyncModal;
    openCloudSyncModal = cloudSync.openCloudSyncModal;
  } else {
    openCloudSyncBtn?.remove();
    document.getElementById('cloud-sync-modal')?.remove();
    document.querySelector('[for="cloud-sync-provider"]')?.remove();
    document.getElementById('cloud-sync-provider')?.remove();
  }
  configurePresetStorage({
    get: () => appState.presets,
    set: (presets) => {
      appState.presets = presets;
      saveState();
    },
  });
  configureEditorStorage({
    get: () => appState.rebuildHistory,
    set: (history) => {
      appState.rebuildHistory = history;
      saveState();
    },
  });
  // Persist a freshly encrypted record before removing any legacy plaintext.
  saveState();
  migrateDataToV3();
  initSettingsModal({
    settings: appSettings,
    onSettingsChange: handleSettingsChange,
  });
  applyMarketingToolkitVisibility(appSettings.enableMarketingToolkit);
  initDarkMode({ defaultTheme: appSettings.theme });
  initUiScale();
  initPanelResizer();
  initUrlEditor({
    onSave: saveUrlToHistory,
    onQrCode: (url, title) => openQrCodeModal(url, title),
  });
  initMaintenanceModal();
  initBatchImportModal();
  initQrCodeModal();
  initPresetModal();
  initTagManagerModal();
  initLiveTestModal();
  initUrlDiffModal();
  initRedirectModal();
  if (initCloudSyncModal) {
    initCloudSyncModal({
      getData: getCurrentState,
      onRestore: restoreCloudData,
    });
    openCloudSyncBtn = document.getElementById('open-cloud-sync-btn');
  }
  void initGuestAds();
  if (appSettings.enableMarketingToolkit) ensureMarketingToolkitModules();
  initExtensionBridge({
    onUrl: (url) => {
      const input = document.getElementById('url-main-input');
      if (input) input.value = url;
      document.getElementById('parse-btn')?.click();
    },
  });

  // 視圖切換按鈕事件
  if (viewModeTableBtn) {
    viewModeTableBtn.addEventListener('click', () => {
      appState.viewMode = 'table';
      saveState();
      renderUrlList();
    });
  }

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

  if (openSettingsBtn) {
    openSettingsBtn.addEventListener('click', () =>
      openSettingsModal(appSettings)
    );
  }

  if (openUrlDiffBtn) {
    openUrlDiffBtn.addEventListener('click', () => {
      const editorValue =
        document.getElementById('url-main-input')?.value || '';
      const rebuiltValue =
        document.getElementById('rebuilt-url')?.textContent || '';
      openUrlDiffModal(editorValue, rebuiltValue);
    });
  }

  if (openRedirectBtn) {
    openRedirectBtn.addEventListener('click', () => openRedirectModal());
  }

  if (openCloudSyncBtn) {
    openCloudSyncBtn.addEventListener('click', () => {
      openCloudSyncModal({
        data: getCurrentState(),
        onRestore: restoreCloudData,
      });
    });
  }

  if (openBatchStripperBtn) {
    openBatchStripperBtn.addEventListener('click', () => {
      if (!appSettings.enableMarketingToolkit) return;
      ensureMarketingToolkitModules().then(({ stripper }) => {
        stripper.openBatchStripperModal();
      });
    });
  }

  if (openUtmBtn) {
    openUtmBtn.addEventListener('click', () => {
      if (!appSettings.enableMarketingToolkit) return;
      ensureMarketingToolkitModules().then(({ utm }) => {
        utm.openUtmModal(
          document.getElementById('url-main-input')?.value || ''
        );
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
              const [entry] = normalizeUrlEntries([
                {
                  id: item.id || createEntryId(),
                  url: item.url,
                  label: item.label || '',
                  tags: item.tags || [],
                },
              ]);
              if (!entry) return;
              appState.urls.push(entry);
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

  // 底部重複操作按鈕
  const openBatchImportBtnBottom = document.getElementById(
    'open-batch-import-btn-bottom'
  );
  if (openBatchImportBtnBottom) {
    openBatchImportBtnBottom.addEventListener('click', handleBatchImportAction);
  }

  const openMaintenanceBtnBottom = document.getElementById(
    'open-maintenance-btn-bottom'
  );
  if (openMaintenanceBtnBottom) {
    openMaintenanceBtnBottom.addEventListener('click', () => {
      if (openMaintenanceBtn) openMaintenanceBtn.click();
    });
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

  if (exportCsvBtn)
    exportCsvBtn.addEventListener('click', () => exportUrlCsv());

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
            markDeletedEntries(
              appState.urls
                .map((entry) => entry.id)
                .filter((id) => !updatedUrls.some((entry) => entry.id === id))
            );
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

  if (batchLiveTestBtn) {
    batchLiveTestBtn.addEventListener('click', () => {
      if (appState.selectedIds.size === 0) return;
      const selected = appState.urls.filter((u) =>
        appState.selectedIds.has(u.id)
      );
      openLiveTestModal({ urls: selected });
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
            markDeletedEntries(
              appState.urls
                .map((entry) => entry.id)
                .filter((id) => !updatedUrls.some((entry) => entry.id === id))
            );
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

      markDeletedEntries([...appState.selectedIds]);
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

  // 側邊欄摺疊按鈕事件
  document.querySelectorAll('.sidebar-collapse-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      if (targetId) {
        const targetBody = document.getElementById(targetId);
        if (targetBody) {
          const isCollapsed = targetBody.classList.toggle('collapsed');
          btn.textContent = isCollapsed ? '▸' : '▾';
        }
      }
    });
  });

  // 全域快捷鍵 ⌘K / Ctrl+K 聚焦搜尋框，Esc 取消聚焦
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
    } else if (e.key === 'Escape') {
      if (searchInput && document.activeElement === searchInput) {
        searchInput.blur();
      }
    }
  });

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
}

void bootstrap().catch((error) => {
  console.error('URL Editor initialization failed.', error);
});
