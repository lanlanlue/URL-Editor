import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation files directly. This is more robust than using http-backend
// as it ensures files are included in the bundle and avoids race conditions.
import enTranslation from '../locales/en/translation.json';
import zhTWTranslation from '../locales/zh-TW/translation.json';

i18next
  .use(LanguageDetector)
  .init({
    fallbackLng: 'en', // 如果偵測不到語言，預設使用英文
    debug: true, // 在開發模式下開啟 debug，方便查看載入情況
    // Define resources directly
    resources: {
      en: {
        translation: enTranslation,
      },
      'zh-TW': {
        translation: zhTWTranslation,
      },
    },
    detection: {
      // 偵測順序：localStorage -> navigator (瀏覽器語言)
      order: ['localStorage', 'navigator'],
      caches: ['localStorage']
    }
  });

// 函數：更新頁面上所有帶有 data-i18n 屬性的元素
export function updateContent() {
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const keyAttr = el.getAttribute('data-i18n');
    const attrRegex = /\[(.*?)\](.*)/;
    const match = keyAttr.match(attrRegex);

    if (match) {
      // It's an attribute, e.g., [placeholder]editor.placeholder
      const attrName = match[1];
      const key = match[2];
      el.setAttribute(attrName, i18next.t(key));
    } else {
      // It's innerHTML
      el.innerHTML = i18next.t(keyAttr);
    }
  });
}

export default i18next;