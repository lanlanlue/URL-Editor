import i18next from './i18n';
import { validateUrl, parseUrl } from './urlParser';

let urlInputElement;
let parseButtonElement;

/**
 * Initializes the URL editor component and its event listeners.
 * @param {object} callbacks - Callbacks to communicate with the main application.
 * @param {function(string): void} callbacks.onSave - Called when the save button is clicked.
 */
export function initUrlEditor(callbacks) {
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

    rebuildUrl({ updateInput: false });
  });

  domainInput.addEventListener('input', () =>
    rebuildUrl({ updateInput: true })
  );
  pathInput.addEventListener('input', () => rebuildUrl({ updateInput: true }));
  addParamBtn.addEventListener('click', () => {
    const row = createParamRow();
    paramsContainer.appendChild(row);
    row.querySelector('input').focus(); // Automatically focus the new key input
    rebuildUrl({ updateInput: true });
  });
  rebuildUrlBtn.addEventListener('click', () =>
    rebuildUrl({ updateInput: true })
  );

  function handleCopy() {
    const url = rebuiltUrlEl.textContent.trim();
    if (!url) return;

    navigator.clipboard.writeText(url).then(() => {
      rebuiltUrlEl.classList.add('copied');
      rebuiltUrlEl.textContent = i18next.t('editor.copySuccess');
      setTimeout(() => {
        // Re-render the URL without triggering an input update
        rebuildUrl({ updateOutput: true, updateInput: false });
        rebuiltUrlEl.classList.remove('copied');
      }, 1000);
    }).catch(err => {
      console.error('Failed to copy URL: ', err);
      // Optionally, you could show an error message to the user here.
    });
  }

  rebuiltUrlEl.addEventListener('click', handleCopy);
  rebuiltUrlEl.addEventListener('keydown', (e) => {
    // Allow copying with Enter or Space key
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault(); // Prevent space from scrolling the page
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
