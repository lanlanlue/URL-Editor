import i18next from '../../core/i18n';
import {
  checkLocalAiAvailability,
  extractUrlsWithGeminiNano,
  MAX_INGESTION_BATCH,
} from '../../core/localAiAssistant';
import { copyUniversalAiPrompt } from '../components/aiPromptHelper';
import { showToast } from '../components/toast';

let bridge = null;
let candidates = [];
let abortController = null;
let busy = false;

const $ = (id) => document.getElementById(id);

function t(key, options) {
  return i18next.t(`aiAssistant.${key}`, options);
}

function setStatus(kind, text) {
  const indicator = $('ai-status-indicator');
  const label = $('ai-status-text');
  if (indicator) indicator.className = `ai-status-indicator status-${kind}`;
  if (label) label.textContent = text;
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') {
    if (!dialog.open) dialog.showModal();
  } else {
    dialog.setAttribute('open', 'true');
    dialog.classList.remove('hidden');
  }
}

export function closeAiAssistantModal() {
  const dialog = $('ai-assistant-modal');
  if (!dialog) return;
  if (abortController) abortController.abort();
  if (typeof dialog.close === 'function') {
    if (dialog.open) dialog.close();
  } else {
    dialog.removeAttribute('open');
    dialog.classList.add('hidden');
  }
}

function normalizeTags(value) {
  return String(value)
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean);
}

function updateConfirmState() {
  const selected = candidates.filter((item) => item.selected).length;
  const confirmBtn = $('ai-confirm-import-btn');
  const selectAll = $('ai-select-all');
  if (confirmBtn) {
    confirmBtn.disabled = busy || selected === 0;
    confirmBtn.textContent = t('confirmImport', { count: selected });
  }
  if (selectAll) {
    selectAll.checked = candidates.length > 0 && selected === candidates.length;
    selectAll.indeterminate = selected > 0 && selected < candidates.length;
  }
}

function renderPreview() {
  const section = $('ai-preview-section');
  const container = $('ai-preview-container');
  const title = $('ai-preview-count-badge');
  if (!section || !container) return;

  container.textContent = '';
  if (candidates.length === 0) {
    section.classList.add('hidden');
    updateConfirmState();
    return;
  }

  section.classList.remove('hidden');
  if (title)
    title.textContent = t('previewTitle', { count: candidates.length });

  const list = document.createElement('div');
  list.className = 'batch-import-items-list';

  candidates.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'batch-import-row';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'ai-item-check';
    check.checked = item.selected;
    check.addEventListener('change', () => {
      item.selected = check.checked;
      updateConfirmState();
    });

    const main = document.createElement('div');
    main.className = 'ai-preview-main';

    // Untrusted model output: always rendered with textContent.
    const url = document.createElement('code');
    url.className = 'ai-preview-url';
    url.textContent = item.url;

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'ai-item-label';
    label.value = item.label;
    label.placeholder = t('colLabel');
    label.setAttribute('aria-label', t('colLabel'));
    label.addEventListener('input', () => {
      item.label = label.value.trim();
    });

    const tags = document.createElement('input');
    tags.type = 'text';
    tags.className = 'ai-item-tags';
    tags.value = item.tags.join(', ');
    tags.placeholder = t('colTags');
    tags.setAttribute('aria-label', t('colTags'));
    tags.addEventListener('input', () => {
      item.tags = normalizeTags(tags.value);
    });

    main.append(url, label, tags);
    row.append(check, main);
    list.appendChild(row);
  });

  container.appendChild(list);
  updateConfirmState();
}

function setBusy(value) {
  busy = value;
  const extractBtn = $('ai-extract-btn');
  const spinner = $('ai-extract-spinner');
  if (extractBtn) extractBtn.disabled = value;
  if (spinner) spinner.classList.toggle('hidden', !value);
  updateConfirmState();
}

function showFallback(show) {
  $('ai-fallback-section')?.classList.toggle('hidden', !show);
}

async function handleExtract() {
  const textarea = $('ai-input-text');
  const rawText = textarea ? textarea.value.trim() : '';
  if (!rawText) {
    setStatus('warn', t('emptyInputAlert'));
    textarea?.focus();
    return;
  }

  const wrapper = $('ai-download-progress-wrapper');
  const bar = $('ai-download-progress');
  const percentEl = $('ai-download-percent');

  abortController = new AbortController();
  setBusy(true);
  setStatus('busy', t('extracting'));

  try {
    const items = await extractUrlsWithGeminiNano(
      rawText,
      ({ percent }) => {
        wrapper?.classList.remove('hidden');
        if (bar) bar.value = percent;
        if (percentEl) percentEl.textContent = `${percent}%`;
        setStatus('downloading', t('downloadProgress', { percent }));
      },
      { signal: abortController.signal }
    );

    wrapper?.classList.add('hidden');
    candidates = (items || []).map((item) => ({
      url: item.url,
      label: item.label || '',
      tags: Array.isArray(item.tags) ? item.tags : [],
      selected: true,
    }));
    renderPreview();
    setStatus(
      candidates.length ? 'available' : 'warn',
      candidates.length
        ? t('previewTitle', { count: candidates.length })
        : t('noItemsFound')
    );
  } catch (error) {
    wrapper?.classList.add('hidden');
    if (error?.name === 'AbortError') return;
    if (
      error?.code === 'unavailable' ||
      String(error?.message).includes('LOCAL_AI_UNAVAILABLE')
    ) {
      showFallback(true);
      setStatus('unavailable', t('errorUnavailable'));
    } else {
      console.warn('[AI Assistant] extraction failed:', error);
      setStatus('error', t('errorGeneric'));
    }
  } finally {
    abortController = null;
    setBusy(false);
  }
}

// Writes through the bridge handed in by main.js, in chunks the bridge accepts.
function ingest(items) {
  const added = [];
  let steps = 0;
  for (let i = 0; i < items.length; i += MAX_INGESTION_BATCH) {
    const result = bridge.addMany(items.slice(i, i + MAX_INGESTION_BATCH), {
      skipDuplicates: true,
    });
    if (!result || !result.ok) {
      return { ok: false, error: result?.error, added, steps };
    }
    if (result.added?.length) steps += 1;
    added.push(...(result.added || []));
  }
  return { ok: true, added, steps };
}

function handleConfirmImport() {
  const selected = candidates
    .filter((item) => item.selected)
    .map(({ url, label, tags }) => ({ url, label, tags }));
  if (selected.length === 0 || !bridge) return;

  const result = ingest(selected);
  if (!result.ok) {
    console.warn('[AI Assistant] import failed:', result.error);
    setStatus('error', t('errorGeneric'));
    return;
  }

  closeAiAssistantModal();
  showToast(t('toastSuccess', { count: result.added.length }), {
    actionLabel: t('toastUndoAction'),
    onAction: () => {
      for (let i = 0; i < result.steps; i += 1) bridge.undo();
      showToast(t('toastUndoSuccess'));
    },
  });
}

export async function openAiAssistantModal() {
  const dialog = $('ai-assistant-modal');
  if (!dialog) return;

  candidates = [];
  renderPreview();
  $('ai-download-progress-wrapper')?.classList.add('hidden');
  $('ai-copy-success-hint')?.classList.add('hidden');
  showFallback(false);
  openDialog(dialog);
  setStatus('checking', t('statusChecking'));

  let state = 'unavailable';
  try {
    state = await checkLocalAiAvailability();
  } catch {
    state = 'unavailable';
  }

  if (state === 'available') {
    setStatus('available', t('statusReady'));
  } else if (state === 'downloadable') {
    setStatus('downloadable', t('statusDownloadable'));
  } else if (state === 'downloading') {
    $('ai-download-progress-wrapper')?.classList.remove('hidden');
    setStatus('downloading', t('statusDownloading'));
  } else {
    showFallback(true);
    setStatus('unavailable', t('statusUnavailable'));
  }
  $('ai-input-text')?.focus();
}

export function initAiAssistantModal(options = {}) {
  bridge = options.bridge || null;
  const dialog = $('ai-assistant-modal');
  if (!dialog) return;

  $('ai-assistant-close-btn')?.addEventListener('click', closeAiAssistantModal);
  $('ai-cancel-btn')?.addEventListener('click', closeAiAssistantModal);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeAiAssistantModal();
  });

  $('ai-clear-btn')?.addEventListener('click', () => {
    const textarea = $('ai-input-text');
    if (textarea) {
      textarea.value = '';
      textarea.focus();
    }
    candidates = [];
    renderPreview();
  });

  $('ai-copy-prompt-btn')?.addEventListener('click', async () => {
    const ok = await copyUniversalAiPrompt($('ai-input-text')?.value || '');
    if (!ok) {
      setStatus('warn', t('copyFailed'));
      return;
    }
    const hint = $('ai-copy-success-hint');
    hint?.classList.remove('hidden');
    setTimeout(() => hint?.classList.add('hidden'), 2500);
  });

  $('ai-extract-btn')?.addEventListener('click', handleExtract);
  $('ai-select-all')?.addEventListener('change', (event) => {
    const checked = Boolean(event.target.checked);
    candidates.forEach((item) => {
      item.selected = checked;
    });
    renderPreview();
  });
  $('ai-confirm-import-btn')?.addEventListener('click', handleConfirmImport);
}
