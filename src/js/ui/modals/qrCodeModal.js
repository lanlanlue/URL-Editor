import i18next from '../../core/i18n';
import { renderQrCodeToCanvas } from '../../utils/qrCodeGenerator';

let currentUrl = '';

/**
 * Initializes the QR code modal dialog handlers.
 */
export function initQrCodeModal() {
  const dialog = document.getElementById('qrcode-modal');
  if (!dialog) return;

  const closeBtn = document.getElementById('qrcode-close-btn');
  const copyBtn = document.getElementById('qrcode-copy-btn');

  const handleClose = () => {
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

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!currentUrl) return;
      navigator.clipboard.writeText(currentUrl).then(() => {
        copyBtn.textContent = i18next.t('urlList.card.copied');
        setTimeout(() => {
          copyBtn.textContent = i18next.t('qrcode.copyBtn');
        }, 1000);
      });
    });
  }
}

/**
 * Opens the QR Code modal and renders the QR code for the specified URL.
 * @param {string} url
 * @param {string} [title]
 */
export function openQrCodeModal(url, title = '') {
  if (!url) return;
  currentUrl = url;

  const dialog = document.getElementById('qrcode-modal');
  if (!dialog) return;

  const titleEl = document.getElementById('qrcode-title');
  const textEl = document.getElementById('qrcode-text-code');
  const canvas = document.getElementById('qrcode-canvas');
  const copyBtn = document.getElementById('qrcode-copy-btn');

  if (titleEl) titleEl.textContent = title || i18next.t('qrcode.title');
  if (textEl) textEl.textContent = url;
  if (copyBtn) copyBtn.textContent = i18next.t('qrcode.copyBtn');

  if (canvas) {
    renderQrCodeToCanvas(canvas, url, {
      margin: 4,
      dark: '#000000',
      light: '#ffffff',
    });
  }

  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', 'true');
    dialog.classList.remove('hidden');
  }
}
