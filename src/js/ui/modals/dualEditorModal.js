import i18next from '../../core/i18n.js';
import { validateUrl } from '../../core/urlParser.js';

let initialized = false;
let callbacks = {};

// 內部狀態記錄
const colState = {
  a: {
    baseUrl: null,
    params: [], // [{ id, key, value }]
  },
  b: {
    baseUrl: null,
    params: [],
  },
};

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else {
    dialog.removeAttribute('open');
    dialog.classList.add('hidden');
  }
}

function openDialog(dialog) {
  if (!dialog) return;
  dialog.classList.remove('hidden');
  if (typeof dialog.showModal === 'function' && !dialog.open) {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', 'true');
  }
}

function copyText(value) {
  if (!value || !navigator.clipboard?.writeText) return Promise.resolve(false);
  return navigator.clipboard
    .writeText(value)
    .then(() => true)
    .catch((err) => {
      console.warn('[DualEditor Clipboard Copy Failed]:', err);
      return false;
    });
}

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

/**
 * 依據當前欄位參數與基礎資訊重新組合 URL
 * @param {'a' | 'b'} colId
 * @returns {string} 重組後的完整 URL
 */
export function rebuildColumnUrl(colId) {
  const state = colState[colId];
  const rebuiltBox = document.getElementById(`dual-rebuilt-${colId}`);
  if (!rebuiltBox) return '';

  if (!state.baseUrl) {
    rebuiltBox.textContent = i18next.t('dualEditor.rebuiltEmpty');
    return '';
  }

  try {
    const url = new URL(state.baseUrl.toString());
    const searchParams = new URLSearchParams();

    state.params.forEach(({ key, value }) => {
      const trimmedKey = key.trim();
      if (trimmedKey) {
        searchParams.append(trimmedKey, value);
      }
    });

    url.search = searchParams.toString();
    const finalUrl = url.toString();
    rebuiltBox.textContent = finalUrl;
    return finalUrl;
  } catch {
    rebuiltBox.textContent = i18next.t('dualEditor.invalidUrl');
    return '';
  }
}

/**
 * 繪製該欄位的參數列 DOM
 * @param {'a' | 'b'} colId
 */
function renderParamRows(colId) {
  const container = document.getElementById(`dual-params-${colId}`);
  if (!container) return;
  container.replaceChildren();

  const state = colState[colId];
  if (!state.params || state.params.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'dual-empty-params';
    emptyEl.textContent = i18next.t('dualEditor.noParams');
    container.appendChild(emptyEl);
    return;
  }

  const oppositeColId = colId === 'a' ? 'b' : 'a';
  const sendIcon = colId === 'a' ? '➡️' : '⬅️';

  state.params.forEach((param) => {
    const row = document.createElement('div');
    row.className = 'dual-param-row';
    row.dataset.paramId = param.id;

    // Key 輸入框
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'dual-param-key';
    keyInput.placeholder = i18next.t('dualEditor.paramKeyPlaceholder');
    keyInput.value = param.key;
    keyInput.addEventListener('input', () => {
      param.key = keyInput.value;
      rebuildColumnUrl(colId);
    });

    // 等號
    const eq = document.createElement('span');
    eq.className = 'dual-param-eq';
    eq.textContent = '=';

    // Value 輸入框
    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.className = 'dual-param-val';
    valInput.placeholder = i18next.t('dualEditor.paramValPlaceholder');
    valInput.value = param.value;
    valInput.addEventListener('input', () => {
      param.value = valInput.value;
      rebuildColumnUrl(colId);
    });

    // 動作按鈕群
    const actions = document.createElement('div');
    actions.className = 'dual-param-actions';

    // 複製值按鈕
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'dual-row-btn';
    copyBtn.textContent = '📋';
    copyBtn.title = i18next.t('dualEditor.copyValueTooltip');
    copyBtn.setAttribute(
      'aria-label',
      i18next.t('dualEditor.copyValueTooltip')
    );
    copyBtn.addEventListener('click', () => {
      copyText(param.value).then((ok) => {
        if (ok) {
          copyBtn.textContent = '✅';
          setTimeout(() => {
            copyBtn.textContent = '📋';
          }, 1000);
        }
      });
    });

    // 送至對面按鈕
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'dual-row-btn';
    sendBtn.textContent = sendIcon;
    sendBtn.title = i18next.t('dualEditor.sendToOppositeTooltip');
    sendBtn.setAttribute(
      'aria-label',
      i18next.t('dualEditor.sendToOppositeTooltip')
    );
    sendBtn.addEventListener('click', () => {
      sendParamToTarget(oppositeColId, param.key, param.value);
    });

    // 刪除按鈕
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'dual-row-btn';
    delBtn.textContent = '✕';
    delBtn.title = i18next.t('dualEditor.deleteParamTooltip');
    delBtn.setAttribute(
      'aria-label',
      i18next.t('dualEditor.deleteParamTooltip')
    );
    delBtn.addEventListener('click', () => {
      state.params = state.params.filter((p) => p.id !== param.id);
      renderParamRows(colId);
      rebuildColumnUrl(colId);
    });

    actions.appendChild(copyBtn);
    actions.appendChild(sendBtn);
    actions.appendChild(delBtn);

    row.appendChild(keyInput);
    row.appendChild(eq);
    row.appendChild(valInput);
    row.appendChild(actions);

    container.appendChild(row);
  });
}

/**
 * 將參數直接傳入目標欄位
 * @param {'a' | 'b'} targetColId
 * @param {string} key
 * @param {string} value
 */
export function sendParamToTarget(targetColId, key, value) {
  const targetState = colState[targetColId];
  const newParam = {
    id: generateId(),
    key: key.trim(),
    value: value,
  };

  targetState.params.push(newParam);
  renderParamRows(targetColId);
  rebuildColumnUrl(targetColId);

  // 高亮動畫反饋
  const targetContainer = document.getElementById(`dual-params-${targetColId}`);
  if (targetContainer) {
    const rowEl = targetContainer.querySelector(
      `[data-param-id="${newParam.id}"]`
    );
    if (rowEl) {
      rowEl.classList.add('dual-param-row--highlight');
      if (typeof rowEl.scrollIntoView === 'function') {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      setTimeout(() => {
        rowEl.classList.remove('dual-param-row--highlight');
      }, 1200);
    }
  }
}

/**
 * 解析輸入的 URL 並更新該欄位狀態
 * @param {'a' | 'b'} colId
 * @param {string} urlString
 */
export function parseAndRenderColumn(colId, urlString) {
  const state = colState[colId];
  const domainEl = document.getElementById(`dual-domain-${colId}`);
  const pathEl = document.getElementById(`dual-path-${colId}`);
  const trimmed = (urlString || '').trim();

  if (!trimmed) {
    state.baseUrl = null;
    state.params = [];
    if (domainEl) domainEl.textContent = '-';
    if (pathEl) pathEl.textContent = '-';
    renderParamRows(colId);
    rebuildColumnUrl(colId);
    return;
  }

  const result = validateUrl(trimmed);
  if (!result.valid) {
    state.baseUrl = null;
    state.params = [];
    if (domainEl) domainEl.textContent = i18next.t('dualEditor.invalidUrl');
    if (pathEl) pathEl.textContent = '-';
    renderParamRows(colId);
    rebuildColumnUrl(colId);
    return;
  }

  const url = result.url;
  state.baseUrl = url;
  if (domainEl) domainEl.textContent = `${url.protocol}//${url.host}`;
  if (pathEl) pathEl.textContent = url.pathname || '/';

  // 提取 searchParams
  state.params = [];
  url.searchParams.forEach((val, k) => {
    state.params.push({
      id: generateId(),
      key: k,
      value: val,
    });
  });

  renderParamRows(colId);
  rebuildColumnUrl(colId);
}

/**
 * 填入已儲存卡片選單
 * @param {Array<{url: string, label?: string}>} urls
 */
function updateCardsDropdown(urls = []) {
  ['a', 'b'].forEach((colId) => {
    const select = document.getElementById(`dual-cards-select-${colId}`);
    if (!select) return;

    select.replaceChildren();
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = i18next.t('dualEditor.selectCardPlaceholder');
    select.appendChild(defaultOpt);

    urls.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.url;
      const title = item.label ? `${item.label} (${item.url})` : item.url;
      opt.textContent = title.length > 35 ? title.slice(0, 32) + '...' : title;
      select.appendChild(opt);
    });
  });
}

/**
 * 綁定單一欄位的互動按鈕與輸入框
 * @param {'a' | 'b'} colId
 */
function bindColumnEvents(colId) {
  const inputEl = document.getElementById(`dual-input-${colId}`);
  const loadEditorBtn = document.getElementById(`dual-load-editor-${colId}`);
  const cardsSelect = document.getElementById(`dual-cards-select-${colId}`);
  const addParamBtn = document.getElementById(`dual-add-param-${colId}`);
  const copyBtn = document.getElementById(`dual-copy-${colId}`);
  const applyBtn = document.getElementById(`dual-apply-${colId}`);
  const saveBtn = document.getElementById(`dual-save-${colId}`);

  // 輸入改變時自動解析
  if (inputEl) {
    inputEl.addEventListener('input', () => {
      parseAndRenderColumn(colId, inputEl.value);
    });
  }

  // 載入主編輯器網址
  if (loadEditorBtn) {
    loadEditorBtn.addEventListener('click', () => {
      const mainInput = document.getElementById('url-main-input');
      const mainUrl = mainInput ? mainInput.value.trim() : '';
      if (inputEl) inputEl.value = mainUrl;
      parseAndRenderColumn(colId, mainUrl);
    });
  }

  // 選取已儲存卡片
  if (cardsSelect) {
    cardsSelect.addEventListener('change', () => {
      if (cardsSelect.value) {
        if (inputEl) inputEl.value = cardsSelect.value;
        parseAndRenderColumn(colId, cardsSelect.value);
        cardsSelect.value = '';
      }
    });
  }

  // 新增參數按鈕
  if (addParamBtn) {
    addParamBtn.addEventListener('click', () => {
      colState[colId].params.push({
        id: generateId(),
        key: '',
        value: '',
      });
      renderParamRows(colId);
      rebuildColumnUrl(colId);
    });
  }

  // 複製網址
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const url = rebuildColumnUrl(colId);
      if (!url) return;
      copyText(url).then((ok) => {
        if (ok) {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = i18next.t('dualEditor.copiedUrl');
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 1200);
        }
      });
    });
  }

  // 套用至主編輯器
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      const url = rebuildColumnUrl(colId);
      if (!url) return;
      if (typeof callbacks.onApplyToEditor === 'function') {
        callbacks.onApplyToEditor(url);
      } else {
        const mainInput = document.getElementById('url-main-input');
        if (mainInput) {
          mainInput.value = url;
          document.getElementById('parse-btn')?.click();
        }
      }
      const originalText = applyBtn.textContent;
      applyBtn.textContent = i18next.t('dualEditor.appliedToEditor');
      setTimeout(() => {
        applyBtn.textContent = originalText;
      }, 1200);
    });
  }

  // 存為卡片 (若存在)
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const url = rebuildColumnUrl(colId);
      if (!url) return;
      if (typeof callbacks.onSaveUrl === 'function') {
        callbacks.onSaveUrl(url);
      }
      const originalText = saveBtn.textContent;
      saveBtn.textContent = i18next.t('dualEditor.savedAsCard');
      setTimeout(() => {
        saveBtn.textContent = originalText;
      }, 1200);
    });
  }
}

/**
 * 互換 A 與 B 的內容
 */
export function swapDualColumns() {
  const inputA = document.getElementById('dual-input-a');
  const inputB = document.getElementById('dual-input-b');
  if (!inputA || !inputB) return;

  const tempVal = inputA.value;
  inputA.value = inputB.value;
  inputB.value = tempVal;

  parseAndRenderColumn('a', inputA.value);
  parseAndRenderColumn('b', inputB.value);
}

/**
 * 清空兩側內容
 */
export function clearDualColumns() {
  const inputA = document.getElementById('dual-input-a');
  const inputB = document.getElementById('dual-input-b');
  if (inputA) inputA.value = '';
  if (inputB) inputB.value = '';

  parseAndRenderColumn('a', '');
  parseAndRenderColumn('b', '');
}

/**
 * 初始化雙網址對照編輯器對話框
 * @param {object} [options]
 * @param {function(string): void} [options.onApplyToEditor]
 * @param {function(string): void} [options.onSaveUrl]
 * @param {Array<{url: string, label?: string}>} [options.urls]
 */
export function initDualEditorModal(options = {}) {
  callbacks = { ...callbacks, ...options };
  const dialog = document.getElementById('dual-editor-modal');
  if (!dialog || initialized) return;

  const close = () => closeDialog(dialog);

  document
    .getElementById('dual-editor-close-btn')
    ?.addEventListener('click', close);
  document
    .getElementById('dual-editor-done-btn')
    ?.addEventListener('click', close);

  // 最大化 / 還原視窗
  const maxBtn = document.getElementById('dual-editor-maximize-btn');
  if (maxBtn) {
    maxBtn.addEventListener('click', () => {
      dialog.classList.toggle('is-maximized');
      const isMax = dialog.classList.contains('is-maximized');
      maxBtn.textContent = isMax ? '🗗' : '🗖';
      maxBtn.title = isMax
        ? i18next.t('dualEditor.restoreBtn')
        : i18next.t('dualEditor.maximizeBtn');
      maxBtn.setAttribute('aria-label', maxBtn.title);
    });
  }

  // 互換按鈕
  document
    .getElementById('dual-editor-swap-btn')
    ?.addEventListener('click', swapDualColumns);

  // 清空按鈕
  document
    .getElementById('dual-editor-clear-all-btn')
    ?.addEventListener('click', clearDualColumns);

  // 綁定兩欄各自事件
  bindColumnEvents('a');
  bindColumnEvents('b');

  initialized = true;
}

/**
 * 開啟雙網址對照編輯器對話框
 * @param {object} [options]
 * @param {string} [options.initialUrlA]
 * @param {string} [options.initialUrlB]
 * @param {boolean} [options.forceReset]
 * @param {Array<{url: string, label?: string}>} [options.urls]
 * @param {function(string): void} [options.onApplyToEditor]
 * @param {function(string): void} [options.onSaveUrl]
 */
export function openDualEditorModal(options = {}) {
  callbacks = { ...callbacks, ...options };
  const dialog = document.getElementById('dual-editor-modal');
  if (!dialog) return;

  // 更新卡片選單
  if (Array.isArray(options.urls)) {
    updateCardsDropdown(options.urls);
  }

  // 設定初始 URL A：保留使用者既有草稿，若為空或強制重設時才帶入
  const inputA = document.getElementById('dual-input-a');
  if (inputA) {
    if (
      options.forceReset ||
      (!inputA.value.trim() && options.initialUrlA !== undefined)
    ) {
      inputA.value = options.initialUrlA || '';
      parseAndRenderColumn('a', inputA.value);
    }
  }

  // 設定初始 URL B：保留使用者既有草稿，若為空或強制重設時才帶入
  const inputB = document.getElementById('dual-input-b');
  if (inputB) {
    if (options.forceReset || (!inputB.value.trim() && options.initialUrlB)) {
      inputB.value = options.initialUrlB || '';
      parseAndRenderColumn('b', inputB.value);
    }
  }

  openDialog(dialog);
}

export function closeDualEditorModal() {
  closeDialog(document.getElementById('dual-editor-modal'));
}

export function resetDualEditorModalState() {
  initialized = false;
  colState.a.baseUrl = null;
  colState.a.params = [];
  colState.b.baseUrl = null;
  colState.b.params = [];
}
