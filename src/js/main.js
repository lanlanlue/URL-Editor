import { initDarkMode } from "./darkMode.js";
import i18next, { updateContent } from "./i18n.js";
import { validateUrl, parseUrl } from "./urlParser.js";

// DOM references
const urlInput = document.getElementById("url");
const parseBtn = document.getElementById("parse-btn");
const errorText = document.getElementById("url-error");
const output = document.getElementById("parsed-output");
const domainInput = document.getElementById("domain");
const pathInput = document.getElementById("path");
const paramsContainer = document.getElementById("params-container");
const rebuiltUrlEl = document.getElementById("rebuilt-url");
const warningEl = document.getElementById("param-warning");
const addParamBtn = document.getElementById("add-param-btn");
const rebuildUrlBtn = document.getElementById("rebuild-url-btn");
const urlListSection = document.getElementById("url-list");
const saveUrlBtn = document.getElementById("save-url-btn");

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

// 生成 URL 卡片
function createUrlCard(entry) {
  const { id, url, label = "", tags = [] } = entry;

  const card = document.createElement("div");
  card.classList.add("url-card");

  const labelInput = document.createElement("input");
  labelInput.placeholder = i18next.t('urlList.card.namePlaceholder');
  labelInput.value = label;
  labelInput.className = "url-label";
  labelInput.addEventListener("change", () => {
    updateCardProperty(id, 'label', labelInput.value);
  });

  const text = document.createElement("code");
  text.textContent = url;
  text.className = "url-value"; // 加上 class 以套用正確的換行與樣式
  text.title = i18next.t('urlList.card.copyTooltip');
  text.addEventListener("click", () => {
    navigator.clipboard.writeText(url).then(() => {
      text.textContent = i18next.t('urlList.card.copied');
      setTimeout(() => {
        text.textContent = url;
      }, 1000);
    });
  });

  const tagsInput = document.createElement("input");
  tagsInput.type = "text";
  tagsInput.placeholder = i18next.t('urlList.card.tagsPlaceholder');
  tagsInput.className = "url-tags";
  tagsInput.value = tags.join(", ");
  tagsInput.addEventListener("change", () => {
    const newTags = tagsInput.value.split(',').map(t => t.trim()).filter(Boolean);
    updateCardProperty(id, 'tags', newTags);
  });

  const loadBtn = document.createElement("button");
  loadBtn.textContent = i18next.t('urlList.card.load');
  loadBtn.className = "load-btn";
  loadBtn.addEventListener("click", () => {
    urlInput.value = url;
    parseBtn.click();
  });

  const delBtn = document.createElement("button");
  delBtn.textContent = i18next.t('urlList.card.delete');
  delBtn.className = "delete-btn";
  delBtn.addEventListener("click", () => {
    appState.urls = appState.urls.filter((entry) => entry.id !== id);
    saveState();
    renderUrlList(); // 重新渲染
  });

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.appendChild(loadBtn);
  actions.appendChild(delBtn);

  card.appendChild(labelInput);
  card.appendChild(text);
  card.appendChild(tagsInput);
  card.appendChild(actions);

  return card;
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
    const card = createUrlCard(entry);
    container.appendChild(card);
  });

  if (!urlListSection.contains(container)) {
    urlListSection.appendChild(container);
  }

  renderTagFilters();
}

// 建立參數列
function createParamRow(key = "", value = "") {
  const row = document.createElement("div");
  row.classList.add("param-row");

  const keyInput = document.createElement("input");
  keyInput.value = key;
  keyInput.placeholder = i18next.t('editor.paramKeyPlaceholder');

  const valInput = document.createElement("input");
  valInput.value = value;
  valInput.placeholder = i18next.t('editor.paramValuePlaceholder');

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "❌";
  deleteBtn.title = i18next.t('editor.deleteParamTooltip');
  deleteBtn.addEventListener("click", () => {
    row.remove();
    rebuildUrl({ updateInput: true });
  });

  keyInput.addEventListener("input", () => rebuildUrl({ updateInput: true }));
  valInput.addEventListener("input", () => rebuildUrl({ updateInput: true }));

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(deleteBtn);

  return row;
}

// 重新組合 URL
function rebuildUrl({ updateOutput = true, updateInput = false } = {}) {
  let domain = domainInput.value.trim();
  let path = pathInput.value.trim();

  // 補上 path 開頭的 "/"
  if (path && !path.startsWith("/")) path = "/" + path;

  // 自動補上協議（避免 new URL() 出錯）
  if (!/^https?:\/\//.test(domain)) {
    domain = "https://" + domain;
  }

  let baseUrl;
  try {
    baseUrl = new URL(domain + path);
  } catch (err) {
    console.log(err);
    return;
  }

  const rows = paramsContainer.querySelectorAll(".param-row");

  const paramMap = new Map();
  const seenKeys = new Set();
  const duplicateKeys = new Set();

  rows.forEach((row) => {
    const key = row.children[0].value.trim();
    const value = row.children[1].value.trim();
    if (key !== "") {
      if (seenKeys.has(key)) duplicateKeys.add(key);
      seenKeys.add(key);
      paramMap.set(key, value);
    }
  });

  const searchParams = new URLSearchParams();
  for (const [key, value] of paramMap.entries()) {
    searchParams.append(key, value);
  }

  baseUrl.search = searchParams.toString();

  let finalUrl = baseUrl.toString();

  // 如果沒有參數且原始 path 只有 "/"，則移除結尾多餘的斜線，讓行為更符合直覺
  if (path === '/' && !searchParams.toString() && finalUrl.endsWith('/')) {
    finalUrl = finalUrl.slice(0, -1);
  }

  if (updateOutput) {
    rebuiltUrlEl.textContent = finalUrl;
  }

  if (updateInput) {
    urlInput.value = finalUrl;
  }

  if (duplicateKeys.size > 0) {
    warningEl.textContent = i18next.t('editor.duplicateWarning', {
      keys: [...duplicateKeys].join(", ")
    });
    warningEl.style.display = "block";
  } else {
    warningEl.style.display = "none";
  }
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

parseBtn.addEventListener("click", () => {
  const input = urlInput.value.trim();
  const result = validateUrl(input);

  if (!result.valid) {
    errorText.textContent = i18next.t('editor.urlError');
    errorText.style.display = "block";
    output.style.display = "none";
    return;
  }

  errorText.style.display = "none";
  output.style.display = "block";

  const parsed = parseUrl(result.url);
  domainInput.value = parsed.domain;
  pathInput.value = parsed.path;

  paramsContainer.innerHTML = "";
  parsed.params.forEach(([key, value]) => {
    const row = createParamRow(key, value);
    paramsContainer.appendChild(row);
  });

  rebuildUrl({ updateInput: false });
});

domainInput.addEventListener("input", () =>
  rebuildUrl({ updateInput: true })
);

pathInput.addEventListener("input", () => rebuildUrl({ updateInput: true }));

addParamBtn.addEventListener("click", () => {
  const row = createParamRow();
  paramsContainer.appendChild(row);
  rebuildUrl({ updateInput: true });
});

rebuildUrlBtn.addEventListener("click", () => rebuildUrl({ updateInput: true }));

rebuiltUrlEl.addEventListener("click", () => {
  const url = rebuiltUrlEl.textContent.trim();
  if (!url) return;

  navigator.clipboard.writeText(url).then(() => {
    rebuiltUrlEl.classList.add("copied");
    rebuiltUrlEl.textContent = i18next.t('editor.copySuccess');
    setTimeout(() => {
      rebuildUrl({ updateOutput: true, updateInput: false }); // 恢復原本 URL
      rebuiltUrlEl.classList.remove("copied");
    }, 1000);
  });
});

saveUrlBtn.addEventListener("click", () => {
  const url = rebuiltUrlEl.textContent.trim();
  if (!url) return;

  saveUrlToHistory(url);
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
