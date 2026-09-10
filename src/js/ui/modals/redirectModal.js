import i18next from '../../core/i18n.js';
import { generateRedirectRule } from '../../core/redirectGenerator.js';

let initialized = false;
let currentOutput = '';

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

function renderRule() {
  const source = document.getElementById('redirect-source');
  const destination = document.getElementById('redirect-destination');
  const format = document.getElementById('redirect-format');
  const preserveQuery = document.getElementById('redirect-preserve-query');
  const output = document.getElementById('redirect-output');
  const error = document.getElementById('redirect-error');
  if (!source || !destination || !format || !preserveQuery || !output || !error)
    return;

  currentOutput = '';
  error.textContent = '';
  error.classList.add('hidden');
  output.textContent = '';
  if (!source.value.trim() || !destination.value.trim()) return;

  try {
    currentOutput = generateRedirectRule(
      source.value,
      destination.value,
      format.value,
      { preserveQuery: preserveQuery.checked }
    );
    output.textContent = currentOutput;
  } catch (ruleError) {
    error.textContent = ruleError.message;
    error.classList.remove('hidden');
  }
}

export function initRedirectModal() {
  const dialog = document.getElementById('redirect-modal');
  if (!dialog || initialized) return;
  const close = () => closeDialog(dialog);
  document
    .getElementById('redirect-close-btn')
    ?.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  [
    'redirect-source',
    'redirect-destination',
    'redirect-format',
    'redirect-preserve-query',
  ].forEach((id) => {
    const element = document.getElementById(id);
    element?.addEventListener('input', renderRule);
    element?.addEventListener('change', renderRule);
  });
  document
    .getElementById('redirect-copy-btn')
    ?.addEventListener('click', () => {
      copyText(currentOutput).then((copied) => {
        const status = document.getElementById('redirect-copy-status');
        if (status) {
          status.textContent = copied ? i18next.t('redirect.copySuccess') : '';
        }
      });
    });
  initialized = true;
}

export function openRedirectModal(source = '', destination = '') {
  const sourceInput = document.getElementById('redirect-source');
  const destinationInput = document.getElementById('redirect-destination');
  if (sourceInput) sourceInput.value = source;
  if (destinationInput) destinationInput.value = destination;
  renderRule();
  openDialog(document.getElementById('redirect-modal'));
}

export function getCurrentRedirectOutput() {
  return currentOutput;
}
