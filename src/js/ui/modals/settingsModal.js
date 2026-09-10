import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from '../../core/settings.js';

let currentSettings = { ...DEFAULT_SETTINGS };
let onSettingsChange = null;
let initialized = false;

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close();
  } else {
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

function notifySettingsChange() {
  if (typeof onSettingsChange === 'function') onSettingsChange(currentSettings);
  if (
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function'
  ) {
    window.dispatchEvent(
      new CustomEvent('url-editor-settings-change', {
        detail: currentSettings,
      })
    );
  }
}

function updateControls() {
  const toggle = document.getElementById('marketing-toolkit-toggle');
  const provider = document.getElementById('cloud-sync-provider');
  if (toggle) toggle.checked = currentSettings.enableMarketingToolkit;
  if (provider) provider.value = currentSettings.cloudSyncProvider;
}

/**
 * Initializes the settings dialog and persists changes immediately.
 * @param {{settings?: object, onSettingsChange?: function}} [options]
 */
export function initSettingsModal(options = {}) {
  currentSettings = saveSettings(options.settings || loadSettings());
  onSettingsChange = options.onSettingsChange || null;
  const dialog = document.getElementById('settings-modal');
  if (!dialog || initialized) {
    updateControls();
    return;
  }

  const close = () => closeDialog(dialog);
  const closeBtn = document.getElementById('settings-close-btn');
  const doneBtn = document.getElementById('settings-done-btn');
  const toggle = document.getElementById('marketing-toolkit-toggle');
  const provider = document.getElementById('cloud-sync-provider');

  if (closeBtn) closeBtn.addEventListener('click', close);
  if (doneBtn) doneBtn.addEventListener('click', close);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  if (toggle) {
    toggle.addEventListener('change', (event) => {
      currentSettings = saveSettings({
        ...currentSettings,
        enableMarketingToolkit: event.target.checked,
      });
      notifySettingsChange();
    });
  }

  if (provider) {
    provider.addEventListener('change', (event) => {
      currentSettings = saveSettings({
        ...currentSettings,
        cloudSyncProvider: event.target.value,
      });
      notifySettingsChange();
    });
  }

  initialized = true;
  updateControls();
}

export function openSettingsModal(settings = loadSettings()) {
  currentSettings = saveSettings(settings);
  updateControls();
  openDialog(document.getElementById('settings-modal'));
}

export function getCurrentSettings() {
  return { ...currentSettings };
}
