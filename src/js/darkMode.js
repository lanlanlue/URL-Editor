export function initDarkMode() {
  const toggleBtn = document.getElementById('toggle-dark');
  // 使用 documentElement (<html>) 來套用主題 class，這樣 CSS 權重更高、更穩定
  const htmlEl = document.documentElement;

  if (!toggleBtn) {
    console.error('Dark mode toggle button not found');
    return;
  }

  const applyTheme = (theme) => {
    if (theme === 'dark') {
      htmlEl.classList.add('dark');
    } else {
      htmlEl.classList.remove('dark');
    }
    // 將使用者的選擇儲存起來
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      console.error('Failed to access localStorage', e);
    }
  };

  const initializeTheme = () => {
    try {
      const savedTheme = localStorage.getItem('theme');
      const prefersDark = window.matchMedia(
        '(prefers-color-scheme: dark)'
      ).matches;

      if (savedTheme) {
        applyTheme(savedTheme);
      } else if (prefersDark) {
        applyTheme('dark');
      }
    } catch (e) {
      console.error('Failed to initialize theme', e);
    }
  };

  toggleBtn.addEventListener('click', () => {
    const newTheme = htmlEl.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(newTheme);
  });

  initializeTheme();
}