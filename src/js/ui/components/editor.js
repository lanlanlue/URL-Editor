import i18next from '../../core/i18n';
import { validateUrl, parseUrl } from '../../core/urlParser';
import { getSavedPresets, openPresetModal } from '../modals/presetModal';

let urlInputElement;
let parseButtonElement;

const REBUILD_HISTORY_KEY = 'rebuildHistory';
const MAX_HISTORY = 10;

function getRebuildHistory() {
  const raw = localStorage.getItem(REBUILD_HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function pushRebuildHistory(url) {
  if (!url || typeof url !== 'string') return;
  let list = getRebuildHistory();
  // Avoid duplicate adjacent entry
  if (list.length > 0 && list[0].url === url) return;

  // Filter out exact duplicate if present elsewhere
  list = list.filter((item) => item.url !== url);
  list.unshift({ url, timestamp: Date.now() });

  if (list.length > MAX_HISTORY) list = list.slice(0, MAX_HISTORY);
  localStorage.setItem(REBUILD_HISTORY_KEY, JSON.stringify(list));
  updateHistoryDropdown();
}

function updateHistoryDropdown() {
  const select = document.getElementById('rebuild-history-select');
  if (!select) return;

  const history = getRebuildHistory();
  select.innerHTML = '';

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = i18next.t('history.selectPlaceholder');
  select.appendChild(defaultOption);

  history.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item.url;
    opt.textContent = `${new Date(item.timestamp).toLocaleTimeString()} - ${item.url}`;
    select.appendChild(opt);
  });
}

/**
 * Initializes the URL editor component and its event listeners.
 * @param {object} callbacks - Callbacks to communicate with the main application.
 * @param {function(string): void} callbacks.onSave - Called when the save button is clicked.
 * @param {function(string): void} [callbacks.onQrCode] - Called when QR code button is clicked.
 */
export function initUrlEditor(callbacks = {}) {
  // DOM references for the editor
  urlInputElement = document.getElementById('url-main-input');
  parseButtonElement = document.getElementById('parse-btn');
  const errorText = document.getElementById('url-error');
  const output = document.getElementById('parsed-output');
  const domainInput = document.getElementById('domain');
  const pathInput = document.getElementById('path');
  const paramsContainer = document.getElementById('params-container');
  const rebuiltUrlEl = document.getElementById('rebuilt-url');
  const warningEl = document.getElementById('param-warning');
  const addParamBtn = document.getElementById('add-param-btn');
  const rebuildUrlBtn = document.getElementById('rebuild-url-btn');
  const saveUrlBtn = document.getElementById('save-url-btn');
  const qrCodeBtn = document.getElementById('editor-qrcode-btn');

  // Chips DOM references
  const protocolChip = document.getElementById('chip-protocol');
  const openPresetManageBtn = document.getElementById('open-preset-manage-btn');
  const presetChipsList = document.getElementById('editor-preset-chips');
  const historySelect = document.getElementById('rebuild-history-select');

  // --- Internal Functions ---

  function createParamRow(key = '', value = '') {
    const row = document.createElement('div');
    row.classList.add('param-row');

    const keyInput = document.createElement('input');
    keyInput.value = key;
    keyInput.placeholder = i18next.t('editor.paramKeyPlaceholder');

    const valInput = document.createElement('input');
    valInput.value = value;
    valInput.placeholder = i18next.t('editor.paramValuePlaceholder');

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '❌';
    const deleteTooltip = i18next.t('editor.deleteParamTooltip');
    deleteBtn.title = deleteTooltip;
    deleteBtn.setAttribute('aria-label', deleteTooltip);
    deleteBtn.addEventListener('click', () => {
      row.remove();
      rebuildUrl({ updateInput: true });
    });

    keyInput.addEventListener('input', () => rebuildUrl({ updateInput: true }));
    valInput.addEventListener('input', () => rebuildUrl({ updateInput: true }));

    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(deleteBtn);

    return row;
  }

  function rebuildUrl({ updateOutput = true, updateInput = false } = {}) {
    let domain = domainInput.value.trim();
    let path = pathInput.value.trim();

    if (path && !path.startsWith('/')) path = '/' + path;
    if (!/^https?:\/\//.test(domain)) domain = 'https://' + domain;

    let baseUrl;
    try {
      baseUrl = new URL(domain + path);
    } catch (err) {
      console.error('Error constructing URL:', err);
      return;
    }

    const rows = paramsContainer.querySelectorAll('.param-row');
    const paramMap = new Map();
    const seenKeys = new Set();
    const duplicateKeys = new Set();

    rows.forEach((row) => {
      const key = row.children[0].value.trim();
      const value = row.children[1].value.trim();
      if (key !== '') {
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
    if (path === '/' && !searchParams.toString() && finalUrl.endsWith('/')) {
      finalUrl = finalUrl.slice(0, -1);
    }

    if (updateOutput) rebuiltUrlEl.textContent = finalUrl;
    if (updateInput) urlInputElement.value = finalUrl;

    if (duplicateKeys.size > 0) {
      warningEl.textContent = i18next.t('editor.duplicateWarning', {
        keys: [...duplicateKeys].join(', '),
      });
      warningEl.classList.remove('hidden');
    } else {
      warningEl.classList.add('hidden');
    }

    if (finalUrl) {
      pushRebuildHistory(finalUrl);
    }
  }

  function renderEditorPresetChips() {
    if (!presetChipsList) return;
    presetChipsList.innerHTML = '';

    const presets = getSavedPresets();
    presets.forEach((preset) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-btn';
      btn.textContent = `➕ ${preset.name}`;
      btn.addEventListener('click', () => {
        applyParamsToEditor(preset.params);
      });
      presetChipsList.appendChild(btn);
    });
  }

  function applyParamsToEditor(paramPairs) {
    paramPairs.forEach(([key, val]) => {
      // Check if key already exists in rows
      const rows = paramsContainer.querySelectorAll('.param-row');
      let found = false;
      rows.forEach((row) => {
        if (row.children[0].value.trim() === key) {
          row.children[1].value = val;
          found = true;
        }
      });
      if (!found) {
        const newRow = createParamRow(key, val);
        paramsContainer.appendChild(newRow);
      }
    });
    rebuildUrl({ updateInput: true });
  }

  // --- Switcher Chips Event Handlers ---
  if (protocolChip) {
    protocolChip.addEventListener('click', () => {
      let val = domainInput.value.trim();
      if (val.startsWith('https://')) {
        domainInput.value = val.replace(/^https:\/\//, 'http://');
      } else if (val.startsWith('http://')) {
        domainInput.value = val.replace(/^http:\/\//, 'https://');
      } else {
        domainInput.value = 'http://' + val;
      }
      rebuildUrl({ updateInput: true });
    });
  }

  // Port chips
  document.querySelectorAll('[data-port]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const port = btn.dataset.port;
      let val = domainInput.value.trim();
      let hasProto = false;
      let proto = 'https://';
      if (/^https?:\/\//.test(val)) {
        hasProto = true;
        proto = val.match(/^https?:\/\//)[0];
        val = val.replace(/^https?:\/\//, '');
      }

      // Remove any existing port
      val = val.replace(/:\d+/, '');
      // Append new port
      val = `${val}:${port}`;
      domainInput.value = hasProto ? `${proto}${val}` : val;
      rebuildUrl({ updateInput: true });
    });
  });

  // Env chips
  document.querySelectorAll('[data-env]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetEnv = btn.dataset.env;
      let val = domainInput.value.trim();

      // Check if domain contains dev, qa, staging, prod
      const envRegex = /\b(dev|qa|staging|uat|prod)\b/i;
      if (envRegex.test(val)) {
        domainInput.value = val.replace(envRegex, targetEnv);
      } else {
        // Prepend env subdomain if hostname starts with domain segment
        const hasProto = /^https?:\/\//.test(val);
        const protoStr = hasProto ? val.match(/^https?:\/\//)[0] : '';
        const rawHost = val.replace(/^https?:\/\//, '');
        domainInput.value = `${protoStr}${targetEnv}.${rawHost}`;
      }
      rebuildUrl({ updateInput: true });
    });
  });

  if (openPresetManageBtn) {
    openPresetManageBtn.addEventListener('click', () => {
      openPresetModal({
        onApplyPreset: (params) => {
          applyParamsToEditor(params);
          renderEditorPresetChips();
        },
      });
    });
  }

  if (historySelect) {
    updateHistoryDropdown();
    historySelect.addEventListener('change', (e) => {
      if (e.target.value) {
        loadUrlInEditor(e.target.value);
      }
    });
  }

  // --- Event Listeners ---

  parseButtonElement.addEventListener('click', () => {
    const input = urlInputElement.value.trim();
    const result = validateUrl(input);

    if (!result.valid) {
      errorText.textContent = i18next.t('editor.urlError');
      errorText.classList.remove('hidden');
      output.classList.add('hidden');
      return;
    }

    errorText.classList.add('hidden');
    output.classList.remove('hidden');

    const parsed = parseUrl(result.url);
    domainInput.value = parsed.domain;
    pathInput.value = parsed.path;

    paramsContainer.innerHTML = '';
    parsed.params.forEach(([key, value]) => {
      const row = createParamRow(key, value);
      paramsContainer.appendChild(row);
    });

    renderEditorPresetChips();
    rebuildUrl({ updateInput: false });
  });

  domainInput.addEventListener('input', () =>
    rebuildUrl({ updateInput: true })
  );
  pathInput.addEventListener('input', () => rebuildUrl({ updateInput: true }));
  addParamBtn.addEventListener('click', () => {
    const row = createParamRow();
    paramsContainer.appendChild(row);
    row.querySelector('input').focus();
    rebuildUrl({ updateInput: true });
  });
  rebuildUrlBtn.addEventListener('click', () =>
    rebuildUrl({ updateInput: true })
  );

  if (qrCodeBtn) {
    qrCodeBtn.addEventListener('click', () => {
      const currentUrl = rebuiltUrlEl.textContent.trim();
      if (currentUrl && callbacks.onQrCode) {
        callbacks.onQrCode(currentUrl, i18next.t('editor.title'));
      }
    });
  }

  function handleCopy() {
    const url = rebuiltUrlEl.textContent.trim();
    if (!url) return;

    navigator.clipboard
      .writeText(url)
      .then(() => {
        rebuiltUrlEl.classList.add('copied');
        rebuiltUrlEl.textContent = i18next.t('editor.copySuccess');
        setTimeout(() => {
          rebuildUrl({ updateOutput: true, updateInput: false });
          rebuiltUrlEl.classList.remove('copied');
        }, 1000);
      })
      .catch((err) => {
        console.error('Failed to copy URL: ', err);
      });
  }

  rebuiltUrlEl.addEventListener('click', handleCopy);
  rebuiltUrlEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCopy();
    }
  });

  saveUrlBtn.addEventListener('click', () => {
    const url = rebuiltUrlEl.textContent.trim();
    if (!url) return;
    callbacks.onSave(url);
  });
}

/**
 * Loads a given URL into the editor and triggers parsing.
 * @param {string} url - The URL to load.
 */
export function loadUrlInEditor(url) {
  if (urlInputElement && parseButtonElement) {
    urlInputElement.value = url;
    parseButtonElement.click();
  }
}
