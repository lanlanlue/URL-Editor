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

  test('should open maintenance modal and batch replace domain', async () => {
    // Pre-populate localStorage with 2 URLs
    const initialUrls = [
      {
        id: 'id-1',
        url: 'https://old-domain.com/users?a=1',
        label: 'Users',
        tags: [],
      },
      {
        id: 'id-2',
        url: 'https://old-domain.com/orders',
        label: 'Orders',
        tags: [],
      },
    ];
    localStorage.setItem('urlHistory', JSON.stringify({ urls: initialUrls }));

    // Re-import main to reload state
    jest.resetModules();
    const html = fs.readFileSync(
      path.resolve(__dirname, '../../src/index.html'),
      'utf8'
    );
    document.body.innerHTML = html;
    await import('./main.js');

    // Wait for cards to render
    const urlList = document.getElementById('url-list');
    expect(
      await findByText(urlList, 'https://old-domain.com/users?a=1')
    ).toBeInTheDocument();

    // Mock alert and prompt
    window.alert = jest.fn();

    // Click maintenance button
    const maintenanceBtn = document.getElementById('open-maintenance-btn');
    fireEvent.click(maintenanceBtn);

    // Fill in new domain
    const newDomainInput = document.getElementById('modal-new-domain');
    fireEvent.change(newDomainInput, {
      target: { value: 'https://new-domain.com' },
    });

    // Click apply button
    const applyBtn = document.getElementById('modal-apply-btn');
    fireEvent.click(applyBtn);

    // Verify updated URLs in list and localStorage
    expect(
      await findByText(urlList, 'https://new-domain.com/users?a=1')
    ).toBeInTheDocument();
    expect(
      await findByText(urlList, 'https://new-domain.com/orders')
    ).toBeInTheDocument();

    const storedData = JSON.parse(localStorage.getItem('urlHistory'));
    expect(storedData.urls[0].url).toBe('https://new-domain.com/users?a=1');
    expect(storedData.urls[1].url).toBe('https://new-domain.com/orders');
  });

  test('should support batch selection and select-all', async () => {
    const initialUrls = [
      { id: 'id-1', url: 'https://site1.com', label: 'Site 1', tags: [] },
      { id: 'id-2', url: 'https://site2.com', label: 'Site 2', tags: [] },
    ];
    localStorage.setItem('urlHistory', JSON.stringify({ urls: initialUrls }));

    jest.resetModules();
    const html = fs.readFileSync(
      path.resolve(__dirname, '../../src/index.html'),
      'utf8'
    );
    document.body.innerHTML = html;
    await import('./main.js');

    const selectAllCheckbox = document.getElementById(
      'batch-select-all-checkbox'
    );
    const badge = document.getElementById('batch-selected-count-badge');

    // Click select all
    fireEvent.click(selectAllCheckbox);
    expect(badge.textContent).toContain('2');

    // Check individual card checkboxes
    const checkboxes = document.querySelectorAll('.url-card__checkbox');
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(true);
  });

  test('should batch paste import URLs with auto-naming and tagging', async () => {
    jest.resetModules();
    const html = fs.readFileSync(
      path.resolve(__dirname, '../../src/index.html'),
      'utf8'
    );
    document.body.innerHTML = html;
    await import('./main.js');

    window.alert = jest.fn();

    // Click batch import button
    const openBatchImportBtn = document.getElementById('open-batch-import-btn');
    fireEvent.click(openBatchImportBtn);

    // Paste text into textarea
    const textarea = document.getElementById('batch-import-textarea');
    const pasteContent = `
      https://api.dev.company.com/v1/users?id=10
      - [Order Center](https://qa-orders.company.com/manage)
    `;
    fireEvent.change(textarea, { target: { value: pasteContent } });

    // Submit import
    const submitBtn = document.getElementById('batch-import-submit-btn');
    fireEvent.click(submitBtn);

    // Verify cards are rendered in URL list
    const urlList = document.getElementById('url-list');
    expect(
      await findByText(urlList, 'https://api.dev.company.com/v1/users?id=10')
    ).toBeInTheDocument();
    expect(
      await findByText(urlList, 'https://qa-orders.company.com/manage')
    ).toBeInTheDocument();

    const stored = JSON.parse(localStorage.getItem('urlHistory'));
    expect(stored.urls.length).toBe(2);
    expect(stored.urls[0].tags).toContain('dev');
    expect(stored.urls[1].label).toBe('Order Center');
  });
});
