import { initDarkMode } from './darkMode';

describe('darkMode', () => {
  // 在每個測試前，重置 DOM 和 Mocks
  beforeEach(() => {
    // 重置 localStorage 的 mock
    localStorage.clear();
    // 重置 matchMedia 的 mock
    window.matchMedia.mockClear();
    // 設定基本的 HTML 結構
    document.body.innerHTML = '<button id="toggle-dark"></button>';
    // 移除 <html> 上的 class
    document.documentElement.classList.remove('dark');
  });

  test('should apply dark mode if localStorage is set to "dark"', () => {
    localStorage.setItem('theme', 'dark');
    initDarkMode();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  test('should apply light mode if localStorage is set to "light"', () => {
    localStorage.setItem('theme', 'light');
    initDarkMode();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  test('should apply dark mode if system preference is dark and localStorage is unset', () => {
    // 模擬系統偏好為暗黑模式
    window.matchMedia.mockReturnValue({ matches: true });
    initDarkMode();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  test('should apply light mode if system preference is light and localStorage is unset', () => {
    // 模擬系統偏好為明亮模式
    window.matchMedia.mockReturnValue({ matches: false });
    initDarkMode();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  test('clicking the toggle button should switch from light to dark mode', () => {
    initDarkMode(); // 初始為 light
    const toggleBtn = document.getElementById('toggle-dark');
    toggleBtn.click();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'dark');
  });

  test('clicking the toggle button should switch from dark to light mode', () => {
    localStorage.setItem('theme', 'dark');
    initDarkMode(); // 初始為 dark
    const toggleBtn = document.getElementById('toggle-dark');

    toggleBtn.click();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'light');
  });
});

// --- Mocks ---
// 為了讓測試在 Node.js 環境中執行，我們需要手動模擬瀏覽器才有的 API

// 模擬 localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString();
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// 模擬 matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(() => ({
    matches: false, // 預設為 light mode
  })),
});
