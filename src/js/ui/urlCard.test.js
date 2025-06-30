import { fireEvent, getByText, getByPlaceholderText } from '@testing-library/dom';
import { createUrlCard } from './urlCard';

// 模擬 i18next，因為 createUrlCard 依賴它來取得翻譯文字
jest.mock('../i18n', () => ({
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
  };

  let mockCallbacks;

  beforeEach(() => {
    // 在每個測試前，重置 mock 函式，避免測試之間互相影響
    mockCallbacks = {
      onUpdate: jest.fn(),
      onLoad: jest.fn(),
      onDelete: jest.fn(),
    };
  });

  test('should render card with correct initial data', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);

    // 驗證初始值是否正確渲染
    expect(card.querySelector('.url-card__label').value).toBe('Gemini');
    // We check for truthiness because the card is a detached element.
    // `getByText` will throw an error if the element is not found within the card.
    expect(getByText(card, 'https://gemini.google.com')).toBeTruthy();
    expect(card.querySelector('.url-card__tags').value).toBe('ai, google');
  });

  test('should call onUpdate with correct payload when label is changed', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);
    const labelInput = card.querySelector('.url-card__label');

    fireEvent.change(labelInput, { target: { value: 'Google Gemini' } });

    expect(mockCallbacks.onUpdate).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onUpdate).toHaveBeenCalledWith('test-uuid-123', 'label', 'Google Gemini');
  });

  test('should call onUpdate with correct payload when tags are changed', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);
    const tagsInput = card.querySelector('.url-card__tags');

    fireEvent.change(tagsInput, { target: { value: 'ai, google, tool' } });

    expect(mockCallbacks.onUpdate).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onUpdate).toHaveBeenCalledWith('test-uuid-123', 'tags', ['ai', 'google', 'tool']);
  });

  test('should call onLoad with correct url when load button is clicked', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);
    const loadButton = getByText(card, 'urlList.card.load');

    fireEvent.click(loadButton);

    expect(mockCallbacks.onLoad).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onLoad).toHaveBeenCalledWith('https://gemini.google.com');
  });

  test('should call onDelete with correct id when delete button is clicked', () => {
    const card = createUrlCard(sampleEntry, mockCallbacks);
    const deleteButton = getByText(card, 'urlList.card.delete');

    fireEvent.click(deleteButton);

    expect(mockCallbacks.onDelete).toHaveBeenCalledTimes(1);
    expect(mockCallbacks.onDelete).toHaveBeenCalledWith('test-uuid-123');
  });
});