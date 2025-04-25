import { initDarkMode } from "./darkMode.js";
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

// 生成 URL 卡片
function createUrlCard(entry) {
  const { url, label = "" } =
    typeof entry === "string" ? { url: entry } : entry;

  const card = document.createElement("div");
  card.classList.add("url-card");

  const labelInput = document.createElement("input");
  labelInput.placeholder = "名稱";
  labelInput.value = label;
  labelInput.className = "url-label";
  labelInput.addEventListener("change", () =>
    updateCardLabel(url, labelInput.value)
  );

  const text = document.createElement("code");
  text.textContent = url;
  text.title = "點擊複製 URL";
  text.addEventListener("click", () => {
    navigator.clipboard.writeText(url).then(() => {
      text.textContent = "✅ 已複製！";
      setTimeout(() => {
        text.textContent = url;
      }, 1000);
    });
  });

  const loadBtn = document.createElement("button");
  loadBtn.textContent = "載入";
  loadBtn.classList.add("load-btn");
  loadBtn.addEventListener("click", () => {
    urlInput.value = url;
    parseBtn.click(); // 觸發解析
  });

  const delBtn = document.createElement("button");
  delBtn.textContent = "刪除";
  delBtn.classList.add("delete-btn");
  delBtn.addEventListener("click", () => {
    let urls = JSON.parse(localStorage.getItem("urlHistory")) || [];
    urls = urls.filter((entry) =>
      typeof entry === "string" ? entry !== url : entry.url !== url
    );
    localStorage.setItem("urlHistory", JSON.stringify(urls));
    renderUrlList();
  });

  card.appendChild(labelInput);
  card.appendChild(text);
  card.appendChild(loadBtn);
  card.appendChild(delBtn);

  return card;
}

// 儲存 URL 到 localStorage（避免重複）
function saveUrlToHistory(url) {
  if (!url) return;
  let urls = JSON.parse(localStorage.getItem("urlHistory")) || [];
  if (!urls.includes(url)) {
    urls.push(url);
    localStorage.setItem("urlHistory", JSON.stringify(urls));
    renderUrlList(); // 更新畫面
  }
}
function updateCardLabel(url, newLabel) {
  let urls = JSON.parse(localStorage.getItem("urlHistory")) || [];
  urls = urls.map((entry) => {
    if (typeof entry === "string") return entry;
    if (entry.url === url) return { ...entry, label: newLabel };
    return entry;
  });
  localStorage.setItem("urlHistory", JSON.stringify(urls));
}

// 渲染 URL 清單
function renderUrlList() {
  const container =
    urlListSection.querySelector(".url-cards") || document.createElement("div");
  container.className = "url-cards";
  container.innerHTML = "";

  const urls = JSON.parse(localStorage.getItem("urlHistory")) || [];
  urls.forEach((url) => {
    const card = createUrlCard(url);
    container.appendChild(card);
  });

  if (!urlListSection.contains(container)) {
    urlListSection.appendChild(container);
  }
}

// 建立參數列
function createParamRow(key = "", value = "") {
  const row = document.createElement("div");
  row.classList.add("param-row");

  const keyInput = document.createElement("input");
  keyInput.value = key;
  keyInput.placeholder = "key";

  const valInput = document.createElement("input");
  valInput.value = value;
  valInput.placeholder = "value";

  const deleteBtn = document.createElement("button");
  deleteBtn.textContent = "❌";
  deleteBtn.title = "刪除這個參數";
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
    warningEl.textContent = `⚠️ 已覆蓋重複參數 key：${[...duplicateKeys].join(
      ", "
    )}`;
    warningEl.style.display = "block";
  } else {
    warningEl.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initDarkMode();

  parseBtn.addEventListener("click", () => {
    const input = urlInput.value.trim();
    const result = validateUrl(input);

    if (!result.valid) {
      errorText.textContent = result.error;
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
    saveUrlToHistory(urlInput.value.trim());
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
      rebuiltUrlEl.textContent = "✅ 已複製 URL！";
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

  renderUrlList();

  console.log("🚀 頁面初始化完成");
});
