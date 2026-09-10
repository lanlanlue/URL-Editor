import i18next from '../../core/i18n';
import {
  createQrCodeSvg,
  renderQrCodeToCanvas,
} from '../../utils/qrCodeGenerator';

let currentUrl = '';
let currentTitle = '';
let currentLogo = null;
let initialized = false;

function closeDialog(dialog) {
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else {
    dialog.removeAttribute('open');
    dialog.classList.add('hidden');
  }
}

function getQrOptions() {
  return {
    margin: 4,
    dark: document.getElementById('qrcode-dark-color')?.value || '#000000',
    light: document.getElementById('qrcode-light-color')?.value || '#ffffff',
    rounded: document.getElementById('qrcode-rounded')?.checked || false,
    logo: currentLogo,
  };
}

function renderCurrentQrCode() {
  const canvas = document.getElementById('qrcode-canvas');
  if (canvas && currentUrl)
    renderQrCodeToCanvas(canvas, currentUrl, getQrOptions());
}

function loadLogo(file) {
  currentLogo = null;
  const supportedTypes = new Set(['image/png', 'image/jpeg']);
  if (
    !file ||
    !supportedTypes.has(file.type) ||
    file.size > 2 * 1024 * 1024 ||
    typeof FileReader === 'undefined' ||
    typeof Image === 'undefined'
  ) {
    renderCurrentQrCode();
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      currentLogo = image;
      renderCurrentQrCode();
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/**
 * Initializes the QR code modal dialog handlers.
 */
export function initQrCodeModal() {
  const dialog = document.getElementById('qrcode-modal');
  if (!dialog || initialized) return;

  const closeBtn = document.getElementById('qrcode-close-btn');
  const copyBtn = document.getElementById('qrcode-copy-btn');

  const handleClose = () => closeDialog(dialog);

  if (closeBtn) closeBtn.addEventListener('click', handleClose);

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      handleClose();
    }
  });

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!currentUrl) return;
      if (!navigator.clipboard?.writeText) return;
      navigator.clipboard
        .writeText(currentUrl)
        .then(() => {
          copyBtn.textContent = i18next.t('urlList.card.copied');
          setTimeout(() => {
            copyBtn.textContent = i18next.t('qrcode.copyBtn');
          }, 1000);
        })
        .catch(() => {});
    });
  }

  ['qrcode-dark-color', 'qrcode-light-color', 'qrcode-rounded'].forEach(
    (id) => {
      const control = document.getElementById(id);
      control?.addEventListener('input', renderCurrentQrCode);
      control?.addEventListener('change', renderCurrentQrCode);
    }
  );

  document
    .getElementById('qrcode-logo-file')
    ?.addEventListener('change', (event) => {
      loadLogo(event.target.files?.[0]);
    });

  document
    .getElementById('qrcode-download-btn')
    ?.addEventListener('click', () => {
      if (!currentUrl) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 1024;
        renderQrCodeToCanvas(canvas, currentUrl, getQrOptions());
        if (typeof canvas.toDataURL !== 'function') return;
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `${(currentTitle || 'url-editor-qr').replace(/[^a-z0-9_-]+/gi, '-')}.png`;
        link.click();
      } catch {
        // Canvas export can be unavailable in restricted browser contexts.
      }
    });

  document
    .getElementById('qrcode-download-svg-btn')
    ?.addEventListener('click', () => {
      if (!currentUrl || typeof Blob === 'undefined' || !URL.createObjectURL)
        return;
      const svg = createQrCodeSvg(currentUrl, getQrOptions());
      if (!svg) return;
      const objectUrl = URL.createObjectURL(
        new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      );
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `${(currentTitle || 'url-editor-qr').replace(/[^a-z0-9_-]+/gi, '-')}.svg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    });
  initialized = true;
}

/**
 * Opens the QR Code modal and renders the QR code for the specified URL.
 * @param {string} url
 * @param {string} [title]
 */
export function openQrCodeModal(url, title = '') {
  if (!url) return;
  currentUrl = url;
  currentTitle = title;
  currentLogo = null;

  const dialog = document.getElementById('qrcode-modal');
  if (!dialog) return;

  const titleEl = document.getElementById('qrcode-title');
  const textEl = document.getElementById('qrcode-text-code');
  const canvas = document.getElementById('qrcode-canvas');
  const copyBtn = document.getElementById('qrcode-copy-btn');

  if (titleEl) titleEl.textContent = title || i18next.t('qrcode.title');
  if (textEl) textEl.textContent = url;
  if (copyBtn) copyBtn.textContent = i18next.t('qrcode.copyBtn');

  const logoInput = document.getElementById('qrcode-logo-file');
  if (logoInput) logoInput.value = '';

  if (canvas) {
    renderQrCodeToCanvas(canvas, url, getQrOptions());
  }

  dialog.classList.remove('hidden');
  if (typeof dialog.showModal === 'function' && !dialog.open) {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', 'true');
    dialog.classList.remove('hidden');
  }
}
