import i18next from '../i18n';

const PRESETS_STORAGE_KEY = 'paramPresets';

const DEFAULT_PRESETS = [
  { id: 'default-qa', name: 'QA 環境', params: [['env', 'qa']] },
  {
    id: 'default-debug',
    name: 'Debug & Mock 模式',
    params: [
      ['debug', 'true'],
      ['mock', '1'],
    ],
  },
  {
    id: 'default-auth',
    name: '測試 Token',
    params: [['token', 'bearer_test_token']],
  },
];

let presetApplyCallback = null;
let presetsChangeCallback = null;
let editingPresetId = null;

export function getSavedPresets() {
  const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(DEFAULT_PRESETS));
    return DEFAULT_PRESETS;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return DEFAULT_PRESETS;
  }
}

export function savePresets(presets) {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  if (presetsChangeCallback) {
    presetsChangeCallback(presets);
  }
}

function parseRawParams(rawParams) {
  const searchParams = new URLSearchParams(rawParams.replace(/[\n,]/g, '&'));
  const paramsList = [];
  for (const [k, v] of searchParams.entries()) {
    if (k.trim()) paramsList.push([k.trim(), v.trim()]);
  }
  return paramsList;
}

/**
 * Initializes the Preset Modal listeners.
 */
export function initPresetModal() {
  const dialog = document.getElementById('preset-modal');
  if (!dialog) return;

  const closeBtn = document.getElementById('preset-close-btn');
  const addBtn = document.getElementById('preset-add-btn');

  const handleClose = () => {
    editingPresetId = null;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
      dialog.classList.add('hidden');
    }
  };

  if (closeBtn) closeBtn.addEventListener('click', handleClose);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      handleClose();
    }
  });

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('preset-new-name');
      const paramsInput = document.getElementById('preset-new-params');
      if (!nameInput || !paramsInput) return;

      const name = nameInput.value.trim();
      const rawParams = paramsInput.value.trim();

      if (!name || !rawParams) {
        alert(i18next.t('presets.inputRequiredAlert'));
        return;
      }

      const paramsList = parseRawParams(rawParams);
      if (paramsList.length === 0) {
        alert(i18next.t('presets.invalidParamsAlert'));
        return;
      }

      const presets = getSavedPresets();
      const newPreset = {
        id: `preset-${Date.now()}`,
        name,
        params: paramsList,
      };

      presets.push(newPreset);
      savePresets(presets);

      nameInput.value = '';
      paramsInput.value = '';

      renderPresetsList();
    });
  }
}

function renderPresetsList() {
  const container = document.getElementById('preset-list-container');
  if (!container) return;

  const presets = getSavedPresets();
  container.innerHTML = '';

  presets.forEach((preset) => {
    const item = document.createElement('div');
    item.className = 'preset-item-row';

    if (editingPresetId === preset.id) {
      // Inline edit mode
      item.classList.add('preset-item-row--editing');

      const editForm = document.createElement('div');
      editForm.className = 'preset-item-edit-form';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'preset-edit-input-name';
      nameInput.value = preset.name;
      nameInput.placeholder = i18next.t('presets.namePlaceholder');

      const paramsInput = document.createElement('input');
      paramsInput.type = 'text';
      paramsInput.className = 'preset-edit-input-params';
      paramsInput.value = preset.params.map(([k, v]) => `${k}=${v}`).join('&');
      paramsInput.placeholder = i18next.t('presets.paramsPlaceholder');

      editForm.appendChild(nameInput);
      editForm.appendChild(paramsInput);

      const actions = document.createElement('div');
      actions.className = 'preset-item-actions';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn-primary btn-sm';
      saveBtn.textContent = i18next.t('presets.saveEditBtn');
      saveBtn.addEventListener('click', () => {
        const newName = nameInput.value.trim();
        const newRawParams = paramsInput.value.trim();
        if (!newName || !newRawParams) {
          alert(i18next.t('presets.inputRequiredAlert'));
          return;
        }
        const newParamsList = parseRawParams(newRawParams);
        if (newParamsList.length === 0) {
          alert(i18next.t('presets.invalidParamsAlert'));
          return;
        }

        const updatedPresets = getSavedPresets().map((p) => {
          if (p.id === preset.id) {
            return { ...p, name: newName, params: newParamsList };
          }
          return p;
        });

        savePresets(updatedPresets);
        editingPresetId = null;
        renderPresetsList();
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-secondary btn-sm';
      cancelBtn.textContent = i18next.t('presets.cancelEditBtn');
      cancelBtn.addEventListener('click', () => {
        editingPresetId = null;
        renderPresetsList();
      });

      actions.appendChild(saveBtn);
      actions.appendChild(cancelBtn);

      item.appendChild(editForm);
      item.appendChild(actions);
    } else {
      // Normal display mode
      const info = document.createElement('div');
      info.className = 'preset-item-info';

      const title = document.createElement('strong');
      title.textContent = preset.name;

      const code = document.createElement('code');
      code.className = 'preset-item-code';
      code.textContent = preset.params.map(([k, v]) => `${k}=${v}`).join('&');

      info.appendChild(title);
      info.appendChild(code);

      const actions = document.createElement('div');
      actions.className = 'preset-item-actions';

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn-secondary btn-sm';
      applyBtn.textContent = i18next.t('presets.applyBtn');
      applyBtn.addEventListener('click', () => {
        if (presetApplyCallback) {
          presetApplyCallback(preset.params);
        }
        const dialog = document.getElementById('preset-modal');
        if (dialog && typeof dialog.close === 'function') dialog.close();
      });

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-secondary btn-sm';
      editBtn.textContent = i18next.t('presets.editBtn');
      editBtn.addEventListener('click', () => {
        editingPresetId = preset.id;
        renderPresetsList();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-delete btn-sm';
      deleteBtn.textContent = i18next.t('presets.deleteBtn');
      deleteBtn.addEventListener('click', () => {
        const updated = getSavedPresets().filter((p) => p.id !== preset.id);
        savePresets(updated);
        renderPresetsList();
      });

      actions.appendChild(applyBtn);
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(info);
      item.appendChild(actions);
    }

    container.appendChild(item);
  });
}

/**
 * Opens the Preset Management Modal.
 * @param {object} params
 * @param {function(Array<[string, string]>): void} params.onApplyPreset
 * @param {function(Array): void} [params.onPresetsChanged]
 */
export function openPresetModal({ onApplyPreset, onPresetsChanged }) {
  presetApplyCallback = onApplyPreset;
  presetsChangeCallback = onPresetsChanged;
  editingPresetId = null;

  const dialog = document.getElementById('preset-modal');
  if (!dialog) return;

  renderPresetsList();

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', 'true');
    dialog.classList.remove('hidden');
  }
}
