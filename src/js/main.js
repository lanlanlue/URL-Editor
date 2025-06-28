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
const urlListSection = document.getElementById("url-list");
const saveUrlBtn = document.getElementById("save-url-btn");

const exportBtn = document.getElementById("export-json-btn");
const importInput = document.getElementById("import-json-file");
const importBtn = document.getElementById("import-json-btn");

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
    localStorage.setItem("urlHistory", JSON.stringify({ urls: newUrls }));
    console.log("資料遷移完成！");
  }
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
    let data = JSON.parse(localStorage.getItem("urlHistory")) || { urls: [] };
    data.urls = data.urls.filter((entry) => entry.id !== id);
    localStorage.setItem("urlHistory", JSON.stringify(data));
    renderUrlList();
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
  const data = JSON.parse(localStorage.getItem("urlHistory")) || { urls: [] };
  const existing = data.urls.find((entry) => entry.url === url);

  if (!existing) {
    const newEntry = {
      id: self.crypto.randomUUID(),
      url,
      label: "",
      tags: []
    };
    data.urls.push(newEntry);
    localStorage.setItem("urlHistory", JSON.stringify(data));
    renderUrlList();
  }
}

// 更新卡片屬性 (通用函數)
function updateCardProperty(id, property, value) {
  let data = JSON.parse(localStorage.getItem("urlHistory")) || { urls: [] };
  const urlIndex = data.urls.findIndex(u => u.id === id);
  if (urlIndex > -1) {
    data.urls[urlIndex][property] = value;
    localStorage.setItem("urlHistory", JSON.stringify(data));
    renderUrlList(); // 重新渲染以更新標籤過濾器
  }
}

// 渲染標籤過濾按鈕
function renderTagFilters() {
  const data = JSON.parse(localStorage.getItem("urlHistory")) || { urls: [] };
  const allTags = new Set(data.urls.flatMap(url => url.tags));
  const filtersContainer = document.getElementById('tag-filters');
  filtersContainer.innerHTML = '';

  const createFilterButton = (tag, text) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.onclick = () => renderUrlList(tag);
    filtersContainer.appendChild(btn);
  };

  createFilterButton(null, '全部');
  allTags.forEach(tag => createFilterButton(tag, tag));
}

// 渲染 URL 清單
function renderUrlList(filterTag = null) {
  const container =
    urlListSection.querySelector(".url-cards") || document.createElement("div");
  container.className = "url-cards";
  container.innerHTML = "";

  const data = JSON.parse(localStorage.getItem("urlHistory")) || { urls: [] };
  const filteredUrls = filterTag ? data.urls.filter(u => u.tags.includes(filterTag)) : data.urls;

  filteredUrls.forEach((entry) => {
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

  if (updateOutput) {
    rebuiltUrlEl.textContent = baseUrl.toString();
  }

  if (updateInput) {
    urlInput.value = baseUrl.toString();
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
  const data = JSON.parse(localStorage.getItem("urlHistory")) || { urls: [] };
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
      // 簡單的匯入：直接覆蓋
      if (importedData && Array.isArray(importedData.urls)) {
        localStorage.setItem("urlHistory", JSON.stringify(importedData));
        renderUrlList();
        alert(i18next.t('urlList.importSuccess', { count: importedData.urls.length }));
      } else { throw new Error("JSON 格式不符"); }
    } catch (err) {
      alert(i18next.t('urlList.importError'));
    }
  };
  reader.readAsText(file);
}

document.addEventListener("DOMContentLoaded", () => {
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
    console.log(url);
    if (!url) return;

    saveUrlToHistory(url);
  });

  // 匯入匯出按鈕初始化
  exportBtn.addEventListener("click", exportUrlJson);

  importInput.addEventListener("change", (e) =>
    importUrlJson(e.target.files[0])
  );

  importBtn.addEventListener("click", () => importInput.click());

  // 初始化 i18n 並更新內容
  // Use the promise-based approach for initialization
  i18next.init().then(() => {
    console.log('i18next initialized, rendering content...');
    updateContent();
    renderUrlList();

    const langSwitcher = document.getElementById('language-switcher');
    langSwitcher.value = i18next.language;

    // 語言切換器事件
    langSwitcher.addEventListener('change', (e) => {
      i18next.changeLanguage(e.target.value).then(() => {
        updateContent();
        renderUrlList(); // Re-render list to update dynamic texts like buttons
      });
    });
  });

  console.log("🚀 頁面初始化完成");
});

// --- 搜尋 URL 清單功能 ---

// 1. 取得搜尋輸入框的 DOM 元素
const searchInput = document.getElementById('search-url');

// 2. 監聽輸入事件 (每次輸入都會觸發)
searchInput.addEventListener('input', (e) => {
    // 取得使用者輸入的搜尋關鍵字，並轉換為小寫以便不分大小寫比對
    const searchTerm = e.target.value.toLowerCase();

    // 取得所有 URL 卡片的 DOM 元素
    // *** 請注意：這裡的 '.url-card' 是一個假設的 class 名稱。
    // *** 您需要將它換成您用來代表「單一 URL 項目容器」的實際 CSS 選擇器。
    const urlCards = document.querySelectorAll('#url-list .url-card'); 

    // 3. 遍歷所有卡片，根據搜尋關鍵字決定顯示或隱藏
    urlCards.forEach(card => {
        // 取得卡片內的文字內容，也轉換為小寫
        const cardText = card.textContent.toLowerCase();

        // 如果卡片內容包含搜尋關鍵字，則顯示卡片，否則隱藏
        if (cardText.includes(searchTerm)) {
            card.style.display = ''; // 恢復預設顯示方式 (例如 'block', 'flex' 等)
        } else {
            card.style.display = 'none'; // 隱藏不符合的卡片
        }
    });
});
