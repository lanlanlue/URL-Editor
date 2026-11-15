/**
 * @file aiAssistantModal.test.js
 * Unit tests for the AI assistant modal (preview, confirm import, undo, fallback).
 */
import fs from 'fs';
import path from 'path';

jest.mock('../../core/i18n', () => ({
  __esModule: true,
  default: { t: (key, opts) => `${key}${opts ? JSON.stringify(opts) : ''}` },
}));
jest.mock('../../core/localAiAssistant', () => ({
  checkLocalAiAvailability: jest.fn(),
  extractUrlsWithGeminiNano: jest.fn(),
  MAX_INGESTION_BATCH: 2,
}));
jest.mock('../components/aiPromptHelper', () => ({
  copyUniversalAiPrompt: jest.fn(),
}));
jest.mock('../components/toast', () => ({ showToast: jest.fn() }));

import {
  checkLocalAiAvailability,
  extractUrlsWithGeminiNano,
} from '../../core/localAiAssistant';
import { copyUniversalAiPrompt } from '../components/aiPromptHelper';
import { showToast } from '../components/toast';
import {
  initAiAssistantModal,
  openAiAssistantModal,
  closeAiAssistantModal,
} from './aiAssistantModal';

const html = fs.readFileSync(
  path.resolve(__dirname, '../../../index.html'),
  'utf-8'
);
const dialogMarkup = html.match(
  /<dialog id="ai-assistant-modal"[\s\S]*?<\/dialog>/
)[0];

const $ = (id) => document.getElementById(id);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('aiAssistantModal', () => {
  let bridge;

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = dialogMarkup;
    // JSDOM lacks dialog.showModal in some versions.
    const dlg = $('ai-assistant-modal');
    dlg.showModal = jest.fn(() => dlg.setAttribute('open', ''));
    dlg.close = jest.fn(() => dlg.removeAttribute('open'));
    bridge = {
      addMany: jest.fn((items) => ({ ok: true, added: items, skipped: [] })),
      undo: jest.fn(() => ({ ok: true })),
    };
    checkLocalAiAvailability.mockResolvedValue('available');
    initAiAssistantModal({ bridge });
  });

  test('opens and shows ready state when model is available', async () => {
    await openAiAssistantModal();
    expect($('ai-assistant-modal').showModal).toHaveBeenCalled();
    expect($('ai-status-text').textContent).toContain('statusReady');
    expect($('ai-fallback-section').classList.contains('hidden')).toBe(true);
  });

  test('shows prompt fallback when local AI is unavailable', async () => {
    checkLocalAiAvailability.mockResolvedValue('unavailable');
    await openAiAssistantModal();
    expect($('ai-fallback-section').classList.contains('hidden')).toBe(false);
  });

  test('copy prompt button copies and shows hint', async () => {
    copyUniversalAiPrompt.mockResolvedValue(true);
    $('ai-input-text').value = 'notes';
    $('ai-copy-prompt-btn').click();
    await flush();
    expect(copyUniversalAiPrompt).toHaveBeenCalledWith('notes');
    expect($('ai-copy-success-hint').classList.contains('hidden')).toBe(false);
  });

  test('empty input does not call the model', async () => {
    $('ai-extract-btn').click();
    await flush();
    expect(extractUrlsWithGeminiNano).not.toHaveBeenCalled();
  });

  test('renders preview with textContent only (no HTML injection)', async () => {
    extractUrlsWithGeminiNano.mockResolvedValue([
      {
        url: 'https://a.com/<img src=x onerror=alert(1)>',
        label: '<b>x</b>',
        tags: ['t'],
      },
    ]);
    $('ai-input-text').value = 'text';
    $('ai-extract-btn').click();
    await flush();
    expect($('ai-preview-container').querySelector('img')).toBeNull();
    expect($('ai-preview-container').querySelector('b')).toBeNull();
    expect(
      $('ai-preview-container').querySelectorAll('.batch-import-row')
    ).toHaveLength(1);
  });

  test('confirm imports only checked items, then toast with working undo', async () => {
    extractUrlsWithGeminiNano.mockResolvedValue([
      { url: 'https://a.com/', label: 'A', tags: [] },
      { url: 'https://b.com/', label: 'B', tags: [] },
      { url: 'https://c.com/', label: 'C', tags: [] },
    ]);
    $('ai-input-text').value = 'text';
    $('ai-extract-btn').click();
    await flush();

    $('ai-preview-container').querySelectorAll('.ai-item-check')[1].click();
    $('ai-confirm-import-btn').click();

    // 2 selected, chunk size 2 -> a single addMany call
    expect(bridge.addMany).toHaveBeenCalledTimes(1);
    expect(bridge.addMany.mock.calls[0][0].map((i) => i.url)).toEqual([
      'https://a.com/',
      'https://c.com/',
    ]);
    expect(bridge.addMany.mock.calls[0][1]).toEqual({ skipDuplicates: true });
    expect(showToast).toHaveBeenCalledTimes(1);

    const opts = showToast.mock.calls[0][1];
    opts.onAction();
    expect(bridge.undo).toHaveBeenCalledTimes(1);
  });

  test('chunks imports larger than the bridge batch limit', async () => {
    extractUrlsWithGeminiNano.mockResolvedValue([
      { url: 'https://a.com/', label: '', tags: [] },
      { url: 'https://b.com/', label: '', tags: [] },
      { url: 'https://c.com/', label: '', tags: [] },
    ]);
    $('ai-input-text').value = 'text';
    $('ai-extract-btn').click();
    await flush();
    $('ai-confirm-import-btn').click();
    expect(bridge.addMany).toHaveBeenCalledTimes(2);
    showToast.mock.calls[0][1].onAction();
    expect(bridge.undo).toHaveBeenCalledTimes(2);
  });

  test('unavailable error during extraction reveals fallback', async () => {
    extractUrlsWithGeminiNano.mockRejectedValue(
      Object.assign(new Error('LOCAL_AI_UNAVAILABLE'), { code: 'unavailable' })
    );
    $('ai-input-text').value = 'text';
    $('ai-extract-btn').click();
    await flush();
    expect($('ai-fallback-section').classList.contains('hidden')).toBe(false);
  });

  test('close button closes the dialog', async () => {
    await openAiAssistantModal();
    closeAiAssistantModal();
    expect($('ai-assistant-modal').close).toHaveBeenCalled();
  });
});
