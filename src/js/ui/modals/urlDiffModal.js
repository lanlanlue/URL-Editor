import i18next from '../../core/i18n.js';
import { compareUrls } from '../../core/urlDiff.js';

let currentDiff = null;
let initialized = false;

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
  if (typeof dialog.showModal === 'function' && !dialog.open)
    dialog.showModal();
  else dialog.setAttribute('open', 'true');
}

function copyText(value) {
  if (!value || !navigator.clipboard?.writeText) return Promise.resolve(false);
  return navigator.clipboard
    .writeText(value)
    .then(() => true)
    .catch(() => false);
}

function displayValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function renderDiff() {
  const inputA = document.getElementById('url-diff-input-a');
  const inputB = document.getElementById('url-diff-input-b');
  const error = document.getElementById('url-diff-error');
  const summary = document.getElementById('url-diff-summary');
  const results = document.getElementById('url-diff-results');
  if (!inputA || !inputB || !error || !summary || !results) return;

  error.textContent = '';
  error.classList.add('hidden');
  summary.textContent = '';
  results.replaceChildren();
  currentDiff = null;

  if (!inputA.value.trim() && !inputB.value.trim()) return;

  try {
    currentDiff = compareUrls(inputA.value, inputB.value);
  } catch (diffError) {
    error.textContent = diffError.message;
    error.classList.remove('hidden');
    return;
  }

  const changedCount =
    Object.keys(currentDiff.addedParams).length +
    Object.keys(currentDiff.removedParams).length +
    Object.keys(currentDiff.modifiedParams).length;
  summary.textContent = currentDiff.hasChanges
    ? `${i18next.t('urlDiff.changedSummary', { count: changedCount })} ${
        currentDiff.domainChanged ? i18next.t('urlDiff.domainChanged') : ''
      } ${currentDiff.pathChanged ? i18next.t('urlDiff.pathChanged') : ''}`.trim()
    : i18next.t('urlDiff.noChanges');

  const sections = [
    ['added', currentDiff.addedParams, i18next.t('urlDiff.added')],
    ['removed', currentDiff.removedParams, i18next.t('urlDiff.removed')],
    ['modified', currentDiff.modifiedParams, i18next.t('urlDiff.modified')],
  ];
  sections.forEach(([type, values, title]) => {
    const keys = Object.keys(values);
    if (keys.length === 0) return;
    const section = document.createElement('section');
    section.className = `url-diff-section url-diff-section--${type}`;
    const heading = document.createElement('h4');
    heading.textContent = title;
    section.appendChild(heading);
    const list = document.createElement('ul');
    keys.forEach((key) => {
      const item = document.createElement('li');
      const keyEl = document.createElement('code');
      keyEl.textContent = key;
      item.appendChild(keyEl);
      const valueEl = document.createElement('span');
      const value = values[key];
      valueEl.textContent =
        type === 'modified'
          ? `${displayValue(value.oldVal)} → ${displayValue(value.newVal)}`
          : displayValue(value);
      item.appendChild(valueEl);
      list.appendChild(item);
    });
    section.appendChild(list);
    results.appendChild(section);
  });
}

export function initUrlDiffModal() {
  const dialog = document.getElementById('url-diff-modal');
  if (!dialog || initialized) return;
  const close = () => closeDialog(dialog);
  document
    .getElementById('url-diff-close-btn')
    ?.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  ['url-diff-input-a', 'url-diff-input-b'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', renderDiff);
  });
  document
    .getElementById('url-diff-copy-btn')
    ?.addEventListener('click', () => {
      if (!currentDiff) return;
      copyText(JSON.stringify(currentDiff, null, 2));
    });
  initialized = true;
}

export function openUrlDiffModal(urlA = '', urlB = '') {
  const inputA = document.getElementById('url-diff-input-a');
  const inputB = document.getElementById('url-diff-input-b');
  if (inputA) inputA.value = urlA;
  if (inputB) inputB.value = urlB;
  renderDiff();
  openDialog(document.getElementById('url-diff-modal'));
}

export function getCurrentUrlDiff() {
  return currentDiff;
}
