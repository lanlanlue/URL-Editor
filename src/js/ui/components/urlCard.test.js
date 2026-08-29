import { fireEvent, getByText } from '@testing-library/dom';
import { createUrlCard, createUrlRow } from './urlCard';

// 模擬 i18next，因為 createUrlCard 依賴它來取得翻譯文字
jest.mock('../../core/i18n', () => ({
  __esModule: true,
  default: {
    t: (key) => key, // 簡單地返回 key 作為翻譯結果
  },
}));

describe('ui/urlCard', () => {
  // 準備一個固定的測試資料和一組 mock 回呼函式
  const sampleEntry = {
    id: 'test-uuid-123',
    url: 'https://gemini.google.com',
    label: 'Gemini',
    tags: ['ai', 'google'],
    usageCount: 0,
    isPinned: false,
    lastUsed: Date.now(),
    createdAt: Date.now(),
  };

  let mockCallbacks;

  beforeEach(() => {
    // 在每個測試前，重置 mock 函式，避免測試之間互相影響
    mockCallbacks = {
      onUpdate: jest.fn(),
      onLoad: jest.fn(),
      onDelete: jest.fn(),
      onCopy: jest.fn(),
      onOpen: jest.fn(),
      onPin: jest.fn(),
      onToggleSelect: jest.fn(),
      onCheckHealth: jest.fn(),
      onQrCode: jest.fn(),
    };
  });

  test('should render card with correct initial data', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);

    // 驗證初始值是否正確渲染
    expect(card.querySelector('.url-card__label').value).toBe('Gemini');
    // We check for truthiness because the card is a detached element.
    expect(getByText(card, 'https://gemini.google.com')).toBeTruthy();
    expect(card.querySelector('.url-card__tags').value).toBe('ai, google');
  });

  test('should call onUpdate with correct payload when label is changed', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);
    const labelInput = card.querySelector('.url-card__label');

    fireEvent.change(labelInput, { target: { value: 'Google Gemini' } });

    expect(mockCallbacks.onUpdate).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onUpdate).toHaveBeenCalledWith(
      'test-uuid-123',
      'label',
      'Google Gemini'
    );
  });

  test('should call onUpdate with correct payload when tags are changed', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);
    const tagsInput = card.querySelector('.url-card__tags');

    fireEvent.change(tagsInput, { target: { value: 'ai, google, tool' } });

    expect(mockCallbacks.onUpdate).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onUpdate).toHaveBeenCalledWith(
      'test-uuid-123',
      'tags',
      ['ai', 'google', 'tool']
    );
  });

  test('should call onDelete with correct id when delete button is clicked', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);
    const deleteButton = getByText(card, 'urlList.card.delete');

    fireEvent.click(deleteButton);

    expect(mockCallbacks.onDelete).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onDelete).toHaveBeenCalledWith('test-uuid-123');
  });

  test('should toggle selection and call onToggleSelect', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks, false);
    document.body.appendChild(card);
    const checkbox = card.querySelector('.url-card__checkbox');

    expect(checkbox.checked).toBe(false);
    expect(card.classList.contains('url-card--selected')).toBe(false);

    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(true);
    expect(card.classList.contains('url-card--selected')).toBe(true);
    expect(mockCallbacks.onToggleSelect).toHaveBeenCalledWith(
      'test-uuid-123',
      true
    );

    document.body.removeChild(card);
  });

  test('should show usage badge when usageCount > 0', () => {
    const entryWithUsage = { ...sampleEntry, usageCount: 5 };
    const card = createUrlCard(entryWithUsage, mockCallbacks);
    const badge = card.querySelector('.url-card__usage-badge');

    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('5');
    expect(badge.style.display).not.toBe('none');
  });

  test('should hide usage badge when usageCount is 0', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);
    const badge = card.querySelector('.url-card__usage-badge');

    expect(badge.style.display).toBe('none');
  });

  test('should toggle pin state and call onPin callback', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);
    document.body.appendChild(card);
    const pinBtn = card.querySelector('.url-card__pin-btn');

    expect(card.classList.contains('url-card--pinned')).toBe(false);
    expect(pinBtn.classList.contains('is-pinned')).toBe(false);

    fireEvent.click(pinBtn);

    expect(card.classList.contains('url-card--pinned')).toBe(true);
    expect(pinBtn.classList.contains('is-pinned')).toBe(true);
    expect(mockCallbacks.onPin).toHaveBeenCalledWith('test-uuid-123', true);

    document.body.removeChild(card);
  });

  test('should render pinned card with is-pinned class when isPinned=true', () => {
    const pinnedEntry = { ...sampleEntry, isPinned: true };
    const card = createUrlCard(pinnedEntry, mockCallbacks);

    expect(card.classList.contains('url-card--pinned')).toBe(true);
    const pinBtn = card.querySelector('.url-card__pin-btn');
    expect(pinBtn.classList.contains('is-pinned')).toBe(true);
  });

  test('should call onOpen with url and id when open button is clicked', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);
    const openBtn = card.querySelector('.url-card__button--open');

    fireEvent.click(openBtn);

    expect(mockCallbacks.onOpen).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onOpen).toHaveBeenCalledWith(
      'https://gemini.google.com',
      'test-uuid-123'
    );
  });

  // ── Table Row Mode Tests ──
  test('should render table row with correct columns and data', () => {
    const row = createUrlRow(sampleEntry, mockCallbacks);

    expect(row.tagName).toBe('TR');
    expect(row.classList.contains('url-table__row')).toBe(true);
    expect(row.querySelector('.url-table__label-input').value).toBe('Gemini');
    expect(row.querySelector('.url-table__url-code').textContent).toBe(
      'https://gemini.google.com'
    );
    expect(row.querySelector('.url-table__tags-input').value).toBe(
      'ai, google'
    );
  });

  test('should toggle table row selection on checkbox change', () => {
    const row = createUrlRow(sampleEntry, mockCallbacks, false);
    document.body.appendChild(row);
    const checkbox = row.querySelector('.url-table__col-check input');

    expect(checkbox.checked).toBe(false);
    expect(row.classList.contains('url-table__row--selected')).toBe(false);

    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(true);
    expect(row.classList.contains('url-table__row--selected')).toBe(true);
    expect(mockCallbacks.onToggleSelect).toHaveBeenCalledWith(
      'test-uuid-123',
      true
    );

    document.body.removeChild(row);
  });

  test('should trigger onUpdate when editing label in table row', () => {
    const row = createUrlRow(sampleEntry, mockCallbacks);
    const labelInput = row.querySelector('.url-table__label-input');

    fireEvent.change(labelInput, { target: { value: 'Gemini Advanced' } });

    expect(mockCallbacks.onUpdate).toHaveBeenCalledWith(
      'test-uuid-123',
      'label',
      'Gemini Advanced'
    );
  });

  test('should render usage badge when usageCount > 0 in table row', () => {
    const row = createUrlRow({ ...sampleEntry, usageCount: 7 }, mockCallbacks);
    const usageEl = row.querySelector('.url-table__usage');

    expect(usageEl).not.toBeNull();
    expect(usageEl.textContent).toBe('🔥 7');
  });

  test('should not render usage badge when usageCount is 0 in table row', () => {
    const row = createUrlRow({ ...sampleEntry, usageCount: 0 }, mockCallbacks);
    const usageEl = row.querySelector('.url-table__usage');

    expect(usageEl).toBeNull();
  });

  test('should toggle pin state and call onPin callback in table row', () => {
    const row = createUrlRow(sampleEntry, mockCallbacks);
    document.body.appendChild(row);
    const pinBtn = row.querySelector('.url-table__pin-btn');

    expect(row.classList.contains('url-table__row--pinned')).toBe(false);
    expect(pinBtn.classList.contains('is-pinned')).toBe(false);

    fireEvent.click(pinBtn);

    expect(row.classList.contains('url-table__row--pinned')).toBe(true);
    expect(pinBtn.classList.contains('is-pinned')).toBe(true);
    expect(mockCallbacks.onPin).toHaveBeenCalledWith('test-uuid-123', true);

    document.body.removeChild(row);
  });

  test('should call actions callbacks when table row action buttons are clicked', () => {
    const row = createUrlRow(sampleEntry, mockCallbacks);
    document.body.appendChild(row);

    const loadBtn = row.querySelector('.url-table__action-btn--load');
    fireEvent.click(loadBtn);
    expect(mockCallbacks.onLoad).toHaveBeenCalledWith(
      'https://gemini.google.com',
      'test-uuid-123'
    );

    const openBtn = row.querySelector('.url-table__action-btn--open');
    fireEvent.click(openBtn);
    expect(mockCallbacks.onOpen).toHaveBeenCalledWith(
      'https://gemini.google.com',
      'test-uuid-123'
    );

    const healthBtn = row.querySelector('.url-table__action-btn--health');
    fireEvent.click(healthBtn);
    expect(mockCallbacks.onCheckHealth).toHaveBeenCalledWith(
      'https://gemini.google.com',
      'test-uuid-123'
    );

    const qrBtn = row.querySelector('.url-table__action-btn--qr');
    fireEvent.click(qrBtn);
    expect(mockCallbacks.onQrCode).toHaveBeenCalledWith(
      'https://gemini.google.com',
      'Gemini'
    );

    const delBtn = row.querySelector('.url-table__action-btn--delete');
    fireEvent.click(delBtn);
    expect(mockCallbacks.onDelete).toHaveBeenCalledWith('test-uuid-123');

    document.body.removeChild(row);
  });
});
