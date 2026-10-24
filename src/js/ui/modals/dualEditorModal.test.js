import {
  initDualEditorModal,
  openDualEditorModal,
  closeDualEditorModal,
  parseAndRenderColumn,
  sendParamToTarget,
  swapDualColumns,
  clearDualColumns,
  resetDualEditorModalState,
} from './dualEditorModal.js';

describe('dualEditorModal', () => {
  beforeEach(() => {
    resetDualEditorModalState();
    document.body.innerHTML = `
      <input id="url-main-input" value="https://main-editor.com/path?foo=bar" />
      <button id="parse-btn"></button>

      <dialog id="dual-editor-modal" class="maintenance-modal dual-editor-modal">
        <button id="dual-editor-maximize-btn">🗖</button>
        <button id="dual-editor-close-btn">✕</button>
        <button id="dual-editor-done-btn">完成</button>
        <button id="dual-editor-swap-btn">⇄</button>
        <button id="dual-editor-clear-all-btn">🔄</button>

        <div id="dual-col-a">
          <button id="dual-load-editor-a">載入主編輯器</button>
          <select id="dual-cards-select-a"></select>
          <textarea id="dual-input-a"></textarea>
          <code id="dual-domain-a">-</code>
          <code id="dual-path-a">-</code>
          <button id="dual-add-param-a">＋ 新增參數</button>
          <div id="dual-params-a"></div>
          <div id="dual-rebuilt-a"></div>
          <button id="dual-copy-a">複製</button>
          <button id="dual-apply-a">套用</button>
        </div>

        <div id="dual-col-b">
          <button id="dual-load-editor-b">載入主編輯器</button>
          <select id="dual-cards-select-b"></select>
          <textarea id="dual-input-b"></textarea>
          <code id="dual-domain-b">-</code>
          <code id="dual-path-b">-</code>
          <button id="dual-add-param-b">＋ 新增參數</button>
          <div id="dual-params-b"></div>
          <div id="dual-rebuilt-b"></div>
          <button id="dual-copy-b">複製</button>
          <button id="dual-apply-b">套用</button>
          <button id="dual-save-b">存為卡片</button>
        </div>
      </dialog>
    `;

    // Mock HTMLDialogElement methods
    HTMLDialogElement.prototype.showModal = jest.fn(function () {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = jest.fn(function () {
      this.open = false;
    });

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockImplementation(() => Promise.resolve()),
      },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should parse and render URL columns correctly', () => {
    const urlA = 'https://api.example.com/v1/users?token=abc1234&role=admin';
    parseAndRenderColumn('a', urlA);

    expect(document.getElementById('dual-domain-a').textContent).toBe(
      'https://api.example.com'
    );
    expect(document.getElementById('dual-path-a').textContent).toBe(
      '/v1/users'
    );

    const paramRows = document.querySelectorAll(
      '#dual-params-a .dual-param-row'
    );
    expect(paramRows.length).toBe(2);

    const keys = Array.from(paramRows).map(
      (row) => row.querySelector('.dual-param-key').value
    );
    expect(keys).toEqual(['token', 'role']);

    const values = Array.from(paramRows).map(
      (row) => row.querySelector('.dual-param-val').value
    );
    expect(values).toEqual(['abc1234', 'admin']);

    expect(document.getElementById('dual-rebuilt-a').textContent).toBe(urlA);
  });

  test('should rebuild URL when param key or value changes', () => {
    const urlA = 'https://example.com/api?env=dev';
    parseAndRenderColumn('a', urlA);

    const valInput = document.querySelector(
      '#dual-params-a .dual-param-row .dual-param-val'
    );
    valInput.value = 'production';
    valInput.dispatchEvent(new Event('input'));

    expect(document.getElementById('dual-rebuilt-a').textContent).toBe(
      'https://example.com/api?env=production'
    );
  });

  test('should send parameter from A to B and rebuild B', () => {
    parseAndRenderColumn('a', 'https://source.com/?auth=jwt_secret&mode=test');
    parseAndRenderColumn('b', 'https://target.com/api');

    expect(
      document.querySelectorAll('#dual-params-b .dual-param-row').length
    ).toBe(0);

    // Send auth to target B
    sendParamToTarget('b', 'auth', 'jwt_secret');

    const bRows = document.querySelectorAll('#dual-params-b .dual-param-row');
    expect(bRows.length).toBe(1);
    expect(bRows[0].querySelector('.dual-param-key').value).toBe('auth');
    expect(bRows[0].querySelector('.dual-param-val').value).toBe('jwt_secret');

    expect(document.getElementById('dual-rebuilt-b').textContent).toBe(
      'https://target.com/api?auth=jwt_secret'
    );
  });

  test('should swap A and B contents properly', () => {
    const inputA = document.getElementById('dual-input-a');
    const inputB = document.getElementById('dual-input-b');

    inputA.value = 'https://site-a.com/page?id=1';
    inputB.value = 'https://site-b.com/other?name=test';

    parseAndRenderColumn('a', inputA.value);
    parseAndRenderColumn('b', inputB.value);

    swapDualColumns();

    expect(inputA.value).toBe('https://site-b.com/other?name=test');
    expect(inputB.value).toBe('https://site-a.com/page?id=1');
    expect(document.getElementById('dual-domain-a').textContent).toBe(
      'https://site-b.com'
    );
    expect(document.getElementById('dual-domain-b').textContent).toBe(
      'https://site-a.com'
    );
  });

  test('should clear both columns', () => {
    const inputA = document.getElementById('dual-input-a');
    const inputB = document.getElementById('dual-input-b');

    inputA.value = 'https://example.com';
    inputB.value = 'https://other.com';
    parseAndRenderColumn('a', inputA.value);
    parseAndRenderColumn('b', inputB.value);

    clearDualColumns();

    expect(inputA.value).toBe('');
    expect(inputB.value).toBe('');
    expect(document.getElementById('dual-domain-a').textContent).toBe('-');
    expect(document.getElementById('dual-domain-b').textContent).toBe('-');
  });

  test('should open dialog with initial values and card options', () => {
    const onApply = jest.fn();
    const onSave = jest.fn();

    initDualEditorModal();

    openDualEditorModal({
      initialUrlA: 'https://init-a.com?x=1',
      initialUrlB: 'https://init-b.com?y=2',
      urls: [{ url: 'https://card-1.com', label: 'Card 1' }],
      onApplyToEditor: onApply,
      onSaveUrl: onSave,
    });

    const dialog = document.getElementById('dual-editor-modal');
    expect(dialog.showModal).toHaveBeenCalled();

    expect(document.getElementById('dual-input-a').value).toBe(
      'https://init-a.com?x=1'
    );
    expect(document.getElementById('dual-input-b').value).toBe(
      'https://init-b.com?y=2'
    );

    const selectA = document.getElementById('dual-cards-select-a');
    expect(selectA.options.length).toBe(2);
    expect(selectA.options[1].value).toBe('https://card-1.com');

    // Test apply button
    document.getElementById('dual-apply-b').click();
    expect(onApply).toHaveBeenCalledWith('https://init-b.com/?y=2');

    // Test save button
    document.getElementById('dual-save-b').click();
    expect(onSave).toHaveBeenCalledWith('https://init-b.com/?y=2');

    // Test close
    closeDualEditorModal();
    expect(dialog.close).toHaveBeenCalled();
  });

  test('should toggle maximize class and button icon on maximize button click', () => {
    initDualEditorModal();
    const dialog = document.getElementById('dual-editor-modal');
    const maxBtn = document.getElementById('dual-editor-maximize-btn');

    expect(dialog.classList.contains('is-maximized')).toBe(false);

    maxBtn.click();
    expect(dialog.classList.contains('is-maximized')).toBe(true);
    expect(maxBtn.textContent).toBe('🗗');

    maxBtn.click();
    expect(dialog.classList.contains('is-maximized')).toBe(false);
    expect(maxBtn.textContent).toBe('🗖');
  });

  test('should not close dialog when clicking dialog element directly (backdrop)', () => {
    initDualEditorModal();
    const dialog = document.getElementById('dual-editor-modal');
    dialog.open = true;

    // Simulate clicking backdrop (target === dialog)
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Should NOT have called close
    expect(dialog.close).not.toHaveBeenCalled();
  });

  test('should preserve draft content when reopening without forceReset', () => {
    initDualEditorModal();

    openDualEditorModal({
      initialUrlA: 'https://draft-a.com?tag=original',
      initialUrlB: 'https://draft-b.com?auth=kept',
    });

    // User edits input A
    const inputA = document.getElementById('dual-input-a');
    inputA.value = 'https://draft-a.com?tag=modified';
    parseAndRenderColumn('a', inputA.value);

    // Modal is closed
    closeDualEditorModal();

    // Reopen with new editor suggestion for A
    openDualEditorModal({
      initialUrlA: 'https://new-suggested.com',
      // initialUrlB omitted
    });

    // Content in A should remain the user's modified draft, and B should retain its URL
    expect(document.getElementById('dual-input-a').value).toBe(
      'https://draft-a.com?tag=modified'
    );
    expect(document.getElementById('dual-input-b').value).toBe(
      'https://draft-b.com?auth=kept'
    );
  });
});
