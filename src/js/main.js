import { initDarkMode } from "./darkMode.js";
import i18next, { updateContent } from "./i18n.js";
import { createUrlCard } from "./ui/urlCard.js";
import { initUrlEditor, loadUrlInEditor } from "./editor.js";

// DOM references
const urlListSection = document.getElementById("url-list");
const exportBtn = document.getElementById("export-json-btn");
const importInput = document.getElementById("import-json-file");
const importBtn = document.getElementById("import-json-btn");

// --- 應用程式狀態管理 ---
let appState = {
  urls: [],
  activeTagFilter: null,
  searchTerm: '',
};
const URL_HISTORY_KEY = 'urlHistory';

// 資料遷移：將舊格式的 localStorage 資料轉換為新的標籤格式
function migrateDataToV2() {
  const rawData = localStorage.getItem("urlHistory");
  if (!rawData) return;

  let data = JSON.parse(rawData);
  // 檢查是否為舊格式 (陣列且第一個元素是字串或沒有 id)
  if (Array.isArray(data) && data.length > 0 && (typeof data[0] === 'string' || data[0].id === undefined)) {
    console.log("偵測到舊版資料，正在進行遷移...");
    const newUrls = data.map(entry => {
      const oldUrl = typeof entry === 'string' ? entry : entry.url;
      const oldLabel = typeof entry === 'string' ? '' : entry.label;
      return {
        id: self.crypto.randomUUID(), // 為每筆資料加上唯一 ID
        url: oldUrl,
        label: oldLabel || '',
        tags: [] // 新增空的標籤陣列
      };
    });
    localStorage.setItem(URL_HISTORY_KEY, JSON.stringify({ urls: newUrls }));
    console.log("資料遷移完成！");
  }
}

// 從 localStorage 載入狀態
function loadState() {
  const data = JSON.parse(localStorage.getItem(URL_HISTORY_KEY)) || { urls: [] };
  appState.urls = data.urls;
}

// 將狀態儲存到 localStorage
function saveState() {
  localStorage.setItem(
    URL_HISTORY_KEY,
    JSON.stringify({ urls: appState.urls })
  );
}

// 儲存 URL 到 localStorage（避免重複）
function saveUrlToHistory(url) {
  const existing = appState.urls.find((entry) => entry.url === url);

  if (!existing) {
    const newEntry = {
      id: self.crypto.randomUUID(),
      url,
      label: "",
      tags: []
    };
    appState.urls.push(newEntry);
    saveState();
    renderUrlList();
  }
}

// 更新卡片屬性 (通用函數)
function updateCardProperty(id, property, value) {
  const urlIndex = appState.urls.findIndex(u => u.id === id);
  if (urlIndex > -1) {
    appState.urls[urlIndex][property] = value;
    saveState();
    renderUrlList(); // 重新渲染以更新標籤過濾器
  }
}

// 渲染標籤過濾按鈕
function renderTagFilters() {
  const allTags = new Set(appState.urls.flatMap(url => url.tags));
  const filtersContainer = document.getElementById('tag-filters');
  filtersContainer.innerHTML = '';

  const createFilterButton = (tag, text) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.onclick = () => {
      appState.activeTagFilter = tag;
      renderUrlList();
    };
    filtersContainer.appendChild(btn);
  };

  createFilterButton(null, i18next.t('urlList.allTags'));
  allTags.forEach(tag => createFilterButton(tag, tag));
}

// 渲染 URL 清單
function renderUrlList() {
  const container =
    urlListSection.querySelector(".url-cards") || document.createElement("div");
  container.className = "url-cards";
  container.innerHTML = "";

  let urlsToRender = [...appState.urls];

  // 1. 應用標籤過濾
  if (appState.activeTagFilter) {
    urlsToRender = urlsToRender.filter(u => u.tags.includes(appState.activeTagFilter));
  }

  // 2. 應用搜尋過濾
  if (appState.searchTerm) {
    const lowerCaseSearch = appState.searchTerm.toLowerCase();
    urlsToRender = urlsToRender.filter(u =>
      Object.values(u).join(' ').toLowerCase().includes(lowerCaseSearch)
    );
  }

  urlsToRender.forEach((entry) => {
    const card = createUrlCard(entry, { // Pass callbacks to the card factory
      onUpdate: updateCardProperty,
      onLoad: loadUrlInEditor,
      onDelete: (id) => {
        appState.urls = appState.urls.filter((urlEntry) => urlEntry.id !== id);
        saveState();
        renderUrlList();
      },
    });
    container.appendChild(card);
  });

  if (!urlListSection.contains(container)) {
    urlListSection.appendChild(container);
  }

  renderTagFilters();
}

function exportUrlJson() {
  const data = { urls: appState.urls };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "url-editor-data.json";
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
        saveState(); // 儲存到 localStorage
        renderUrlList();
        alert(i18next.t('urlList.importSuccess', { count: importedData.urls.length }));
      } else { throw new Error(i18next.t('urlList.importError')); }
    } catch (err) {
      alert(i18next.t('urlList.importError'));
    }
  };
  reader.readAsText(file);
}

loadState(); // 頁面載入時，先從 localStorage 載入資料到記憶體
migrateDataToV2(); // 頁面載入時檢查並遷移資料
initDarkMode();
initUrlEditor({
  onSave: saveUrlToHistory,
});

// 匯入匯出按鈕初始化
exportBtn.addEventListener("click", exportUrlJson);

importInput.addEventListener("change", (e) =>
  importUrlJson(e.target.files[0])
);

importBtn.addEventListener("click", () => importInput.click());

// --- 搜尋 URL 清單功能 ---
const searchInput = document.getElementById('search-url');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    appState.searchTerm = e.target.value;
    renderUrlList();
  });
}

// 初始化 i18n 並更新內容
// Use the promise-based approach for initialization
i18next.init().then(() => {
  // 更新靜態內容和頁面屬性
  document.documentElement.lang = i18next.language;
  document.title = i18next.t('appTitle');
  updateContent();

  // 首次渲染列表
  renderUrlList();

  console.log('i18next initialized, rendering content...');

  const langSwitcher = document.getElementById('language-switcher');
  langSwitcher.value = i18next.language;

  // 語言切換器事件
  langSwitcher.addEventListener('change', (e) => {
    i18next.changeLanguage(e.target.value).then(() => { // Re-render list to update dynamic texts like buttons
      document.documentElement.lang = i18next.language;
      document.title = i18next.t('appTitle');
      updateContent();
      renderUrlList();
    });
  });
});

console.log("🚀 頁面初始化完成");
