export function initDarkMode() {
  const toggleBtn = document.getElementById('toggle-dark');
  const htmlEl = document.documentElement;

  if (!toggleBtn) {
    console.error('Dark mode toggle button not found');
    return;
  }

  const applyTheme = (theme) => {
    if (theme === 'dark') {
      htmlEl.classList.add('dark');
      htmlEl.classList.remove('light');
      toggleBtn.textContent = '🌙';
      toggleBtn.title = '切換為亮色主題';
    } else {
      htmlEl.classList.remove('dark');
      htmlEl.classList.add('light');
      toggleBtn.textContent = '☀️';
      toggleBtn.title = '切換為深色主題';
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
      } else {
        applyTheme('light');
      }
    } catch (e) {
      console.error('Failed to initialize theme', e);
    }
  };

  toggleBtn.addEventListener('click', () => {
    const isDark = htmlEl.classList.contains('dark');
    const newTheme = isDark ? 'light' : 'dark';
    applyTheme(newTheme);
  });

  initializeTheme();
}
