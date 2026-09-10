import i18next from '../../core/i18n.js';
import { batchStrip } from '../../core/trackerStripper.js';

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
  if (!value || !navigator.clipboard?.writeText) return;
  navigator.clipboard.writeText(value).catch(() => {});
}

function renderResults() {
  const input = document.getElementById('batch-stripper-input');
  const output = document.getElementById('batch-stripper-output');
  const summary = document.getElementById('batch-stripper-summary');
  if (!input || !output || !summary) return;
  const lines = input.value
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const cleaned = batchStrip(lines);
  output.value = cleaned.join('\n');
  const changed = cleaned.filter(
    (value, index) => value !== lines[index]
  ).length;
  summary.textContent = i18next.t('marketing.stripperSummary', {
    total: lines.length,
    changed,
  });
}

export function initBatchStripperModal() {
  const dialog = document.getElementById('batch-stripper-modal');
  if (!dialog || initialized) return;
  const close = () => closeDialog(dialog);
  document
    .getElementById('batch-stripper-close-btn')
    ?.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  document
    .getElementById('batch-stripper-input')
    ?.addEventListener('input', renderResults);
  document
    .getElementById('batch-stripper-copy-btn')
    ?.addEventListener('click', () => {
      copyText(document.getElementById('batch-stripper-output')?.value || '');
    });
  initialized = true;
}

export function openBatchStripperModal(value = '') {
  const input = document.getElementById('batch-stripper-input');
  if (input) input.value = value;
  renderResults();
  openDialog(document.getElementById('batch-stripper-modal'));
}
