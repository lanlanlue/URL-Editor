import i18next, { updateContent } from './core/i18n.js';
import {
  authenticateGoogle,
  getOAuthCsrfToken,
  getPublicConfig,
} from './core/cloudApi.js';

function setStatus(message, isError = false) {
  const element = document.getElementById('login-status');
  if (!element) return;
  element.textContent = message || '';
  element.classList.toggle('error', isError);
}

function getReturnPath() {
  const value = new URLSearchParams(window.location.search).get('returnTo');
  return value && value.startsWith('/') && !value.startsWith('//')
    ? value
    : '/app';
}

function loadGoogleScript() {
  return new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.id) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google 登入元件載入失敗。'));
    document.head.appendChild(script);
  });
}

async function initLogin() {
  await i18next.init();
  document.documentElement.lang = i18next.language;
  updateContent();

  const publicConfig = await getPublicConfig();
  const googleClientId = publicConfig?.googleClientId || '';
  if (!googleClientId || googleClientId.startsWith('REPLACE_')) {
    setStatus('尚未設定 Google OAuth Client ID。', true);
    return;
  }

  try {
    const oauthCsrfToken = await getOAuthCsrfToken();
    await loadGoogleScript();
    globalThis.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async (response) => {
        try {
          setStatus('正在驗證 Google 帳戶…');
          await authenticateGoogle(response.credential, oauthCsrfToken);
          window.location.href = getReturnPath();
        } catch (error) {
          setStatus(error.message || 'Google 登入失敗。', true);
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    globalThis.google.accounts.id.renderButton(
      document.getElementById('google-sign-in'),
      {
        type: 'standard',
        theme: 'filled_blue',
        size: 'large',
        text: 'signin_with',
        shape: 'rectangular',
        width: 280,
      }
    );
  } catch (error) {
    setStatus(error.message || '無法啟動 Google 登入。', true);
  }
}

void initLogin();
