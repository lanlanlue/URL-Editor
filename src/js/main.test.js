import fs from 'fs';
import path from 'path';
import { screen, fireEvent, findByText } from '@testing-library/dom';

// 模擬 darkMode 模組
// We still mock darkMode to isolate the test to main.js logic
jest.mock('./darkMode.js', () => ({
  initDarkMode: jest.fn(),
}));

describe('main.js - User Interaction Tests', () => {
  beforeEach(async () => {
    // 在每個測試前重置模組快取，確保 main.js 在乾淨的環境中重新執行
    jest.resetModules();

    // 讀取 index.html 的內容並設定到 JSDOM 中
    const html = fs.readFileSync(
      path.resolve(__dirname, '../../src/index.html'),
      'utf8'
    );
    document.body.innerHTML = html;

    // 動態載入 main.js，使其在 DOM 設定完成後執行
    await import('./main.js');
  });

  afterEach(() => {
    // 清理 localStorage 和 DOM
    localStorage.clear();
    document.body.innerHTML = '';
  });

  test('should parse a valid URL and display editor fields', async () => {
    // Since we are now using the real i18next, we wait for the real translated text
    const urlInput = await screen.findByPlaceholderText(
      'https://example.com/path?foo=bar'
    );
    const parseBtn = await screen.findByText('Parse URL');

    // 模擬使用者輸入並點擊
    fireEvent.change(urlInput, {
      target: { value: 'https://www.google.com/search?q=gemini' },
    });
    fireEvent.click(parseBtn);

    // 驗證結果
    const domainInput = await screen.findByDisplayValue('www.google.com');
    const pathInput = await screen.findByDisplayValue('/search');
    const paramKeyInput = await screen.findByDisplayValue('q');
    const paramValueInput = await screen.findByDisplayValue('gemini');

    expect(domainInput).toBeInTheDocument();
    expect(pathInput).toBeInTheDocument();
    expect(paramKeyInput).toBeInTheDocument();
    expect(paramValueInput).toBeInTheDocument();
  });

  test('should save a URL to the list and render a card', async () => {
    // Setup: Parse a URL first
    const urlInput = await screen.findByPlaceholderText(
      'https://example.com/path?foo=bar'
    );
    const parseBtn = await screen.findByText('Parse URL');
    fireEvent.change(urlInput, { target: { value: 'https://test.dev' } });
    fireEvent.click(parseBtn);

    // Action: Click the save button
    const saveBtn = await screen.findByText('💾 Save to List');
    fireEvent.click(saveBtn);

    // Assertion: Verify the card is rendered in the list
    const urlList = document.getElementById('url-list');
    const cardCode = await findByText(urlList, 'https://test.dev');
    expect(cardCode).toBeInTheDocument();
  });
});
