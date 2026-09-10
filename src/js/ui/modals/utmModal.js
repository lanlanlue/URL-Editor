import {
  buildUtmUrl,
  getUtmPreset,
  UTM_KEYS,
  UTM_PRESETS,
} from '../../core/utmBuilder.js';

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

function getParams() {
  const params = {};
  UTM_KEYS.forEach((key) => {
    const input = document.querySelector(`[data-utm-key="${key}"]`);
    if (input) params[key] = input.value;
  });
  return params;
}

function renderUtm() {
  const baseUrl = document.getElementById('utm-base-url');
  const output = document.getElementById('utm-output');
  const error = document.getElementById('utm-error');
  if (!baseUrl || !output || !error) return;
  output.value = '';
  error.textContent = '';
  error.classList.add('hidden');
  if (!baseUrl.value.trim()) return;

  try {
    output.value = buildUtmUrl(baseUrl.value, getParams(), {
      requireCampaign: false,
    });
  } catch (buildError) {
    error.textContent = buildError.message;
    error.classList.remove('hidden');
  }
}

function fillPreset(name) {
  const preset = getUtmPreset(name);
  if (!preset) return;
  UTM_KEYS.forEach((key) => {
    const input = document.querySelector(`[data-utm-key="${key}"]`);
    if (input) input.value = preset[key] || '';
  });
  renderUtm();
}

export function initUtmModal() {
  const dialog = document.getElementById('utm-modal');
  const presetSelect = document.getElementById('utm-preset');
  if (!dialog || initialized) return;
  if (presetSelect) {
    presetSelect.replaceChildren();
    Object.entries(UTM_PRESETS).forEach(([key, preset]) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = preset.label;
      presetSelect.appendChild(option);
    });
    presetSelect.addEventListener('change', () =>
      fillPreset(presetSelect.value)
    );
  }
  const close = () => closeDialog(dialog);
  document.getElementById('utm-close-btn')?.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  document.getElementById('utm-base-url')?.addEventListener('input', renderUtm);
  document.querySelectorAll('[data-utm-key]').forEach((input) => {
    input.addEventListener('input', renderUtm);
  });
  document.getElementById('utm-copy-btn')?.addEventListener('click', () => {
    copyText(document.getElementById('utm-output')?.value || '');
  });
  initialized = true;
  if (presetSelect)
    fillPreset(presetSelect.value || Object.keys(UTM_PRESETS)[0]);
}

export function openUtmModal(baseUrl = '') {
  const input = document.getElementById('utm-base-url');
  if (input) input.value = baseUrl;
  renderUtm();
  openDialog(document.getElementById('utm-modal'));
}
