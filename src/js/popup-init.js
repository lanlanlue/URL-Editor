/**
 * Detects if the app is running as a browser extension popup.
 * If so, adds a specific class to the <html> element to apply popup-specific styles.
 */
if (window.location.protocol.startsWith('chrome-extension:') || window.location.protocol.startsWith('moz-extension:')) {
  document.documentElement.classList.add('is-extension-popup');
}