import { CLOUD_ENABLED } from './runtimeConfig.js';

const ADS_SRC =
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9603285949500141';

function appendAdsScript() {
  if (!navigator.onLine || document.querySelector(`script[src="${ADS_SRC}"]`))
    return;
  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = ADS_SRC;
  script.onerror = () => script.remove();
  document.head.appendChild(script);
}

export async function initGuestAds() {
  const pathname =
    typeof window !== 'undefined' ? window.location.pathname : '';
  if (/^\/app(?:\/|$)/.test(pathname)) return;
  if (!CLOUD_ENABLED) {
    appendAdsScript();
    return;
  }
  try {
    const response = await fetch('/api/session', {
      credentials: 'same-origin',
    });
    if (response.status === 401) appendAdsScript();
  } catch {
    // Do not load third-party code when the authentication state is unknown.
  }
}

export default { initGuestAds };
