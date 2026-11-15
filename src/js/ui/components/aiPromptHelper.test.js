/**
 * @file aiPromptHelper.test.js
 * Unit tests for Universal AI Prompt Helper component (Feature F07).
 * Covers constant definition, formatting compliance, input concatenation,
 * modern Async Clipboard API execution, legacy execCommand fallback,
 * error handling, and concurrency stress resilience.
 */

import {
  UNIVERSAL_AI_PROMPT,
  copyUniversalAiPrompt,
} from './aiPromptHelper.js';

describe('ui/components/aiPromptHelper', () => {
  let originalClipboard;
  let originalExecCommand;

  beforeEach(() => {
    // Snapshot original globals
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;

    // Default mock setup: healthy async clipboard writeText
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    // Clean restoration of all mocked globals
    if (originalClipboard !== undefined) {
      Object.assign(navigator, { clipboard: originalClipboard });
    } else {
      delete navigator.clipboard;
    }

    if (originalExecCommand !== undefined) {
      document.execCommand = originalExecCommand;
    } else {
      delete document.execCommand;
    }

    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  /* ========================================================================
     1. Constant Definition & Formatting Integrity (Tier 1 & Tier 2)
     ======================================================================== */
  describe('UNIVERSAL_AI_PROMPT Constant', () => {
    test('TC-T1-F07-01: exports non-empty UNIVERSAL_AI_PROMPT containing markdown link and tag rules', () => {
      expect(typeof UNIVERSAL_AI_PROMPT).toBe('string');
      expect(UNIVERSAL_AI_PROMPT.length).toBeGreaterThan(50);
      expect(UNIVERSAL_AI_PROMPT).toContain('[label](url)');
      expect(UNIVERSAL_AI_PROMPT).toContain('#tag');
    });

    test('TC-F07-PROMPT-01: specifies format [標籤名稱](URL) #tag1 #tag2', () => {
      expect(UNIVERSAL_AI_PROMPT).toContain('[標籤名稱](URL) #tag1 #tag2');
      expect(UNIVERSAL_AI_PROMPT).toContain('HTTP/HTTPS');
    });

    test('TC-F07-PROMPT-02: includes strict negative constraints forbidding code blocks and conversational text', () => {
      expect(UNIVERSAL_AI_PROMPT).toContain('不要使用 Markdown 程式碼區塊');
      expect(UNIVERSAL_AI_PROMPT).toContain('只輸出整理後的清單');
    });

    test('TC-F07-PROMPT-03: provides concrete example lines matching markdown link + tag structure', () => {
      expect(UNIVERSAL_AI_PROMPT).toContain('[Google](https://www.google.com)');
      expect(UNIVERSAL_AI_PROMPT).toContain('[GitHub](https://github.com)');
      expect(UNIVERSAL_AI_PROMPT).toContain(
        '[MDN Web Docs](https://developer.mozilla.org)'
      );
    });

    test('TC-T2-F07-01: UNIVERSAL_AI_PROMPT is an immutable string primitive', () => {
      expect(typeof UNIVERSAL_AI_PROMPT).toBe('string');
      // Primitive strings cannot be mutated; assigning properties has no effect
      expect(() => {
        // eslint-disable-next-line no-unused-expressions
        UNIVERSAL_AI_PROMPT.slice(0, 5);
      }).not.toThrow();
    });
  });

  /* ========================================================================
     2. Standard Clipboard Operation (Tier 1 & Tier 2)
     ======================================================================== */
  describe('copyUniversalAiPrompt Execution', () => {
    test('TC-T1-F07-02: writes UNIVERSAL_AI_PROMPT to clipboard when called without arguments', async () => {
      const result = await copyUniversalAiPrompt();
      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      const copiedPayload = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copiedPayload).toBe(UNIVERSAL_AI_PROMPT);
    });

    test('TC-T1-F07-04: resolves to true upon successful clipboard write', async () => {
      const success = await copyUniversalAiPrompt();
      expect(success).toBe(true);
    });

    test('TC-T1-F07-03: cleanly appends provided user text separated by delimiter', async () => {
      const userText =
        'Notes from meeting: https://github.com/darren/url-editor and https://vuejs.org';
      const result = await copyUniversalAiPrompt(userText);

      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      const copiedPayload = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copiedPayload).toContain(UNIVERSAL_AI_PROMPT);
      expect(copiedPayload).toContain(userText);
      expect(copiedPayload).toContain('---');
    });

    test('TC-T2-F07-02: preserves unicode, CJK characters, emoji, and special markdown tokens in raw text', async () => {
      const specialText =
        '🔥 重要筆記：《繁體中文標籤》 & [Markdown Token](https://unicode.org/emoji#flags) #測試';
      await copyUniversalAiPrompt(specialText);

      const copiedPayload = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copiedPayload).toContain(specialText);
    });

    test('TC-T2-F07-03: copies only base prompt without "null" or "undefined" when given null or undefined', async () => {
      await copyUniversalAiPrompt(null);
      let copiedPayload = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copiedPayload).toBe(UNIVERSAL_AI_PROMPT);
      expect(copiedPayload).not.toContain('null');

      jest.clearAllMocks();
      await copyUniversalAiPrompt(undefined);
      copiedPayload = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copiedPayload).toBe(UNIVERSAL_AI_PROMPT);
      expect(copiedPayload).not.toContain('undefined');
    });

    test('TC-F07-INPUT-01: treats empty and whitespace-only text as empty, copying base prompt only', async () => {
      await copyUniversalAiPrompt('');
      let copiedPayload = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copiedPayload).toBe(UNIVERSAL_AI_PROMPT);

      jest.clearAllMocks();
      await copyUniversalAiPrompt('   \n\t  \n  ');
      copiedPayload = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copiedPayload).toBe(UNIVERSAL_AI_PROMPT);
      expect(copiedPayload).not.toContain('---');
    });

    test('TC-F07-INPUT-02: safely handles non-string inputs (number, object, boolean) by copying base prompt', async () => {
      await copyUniversalAiPrompt(12345);
      let copiedPayload = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copiedPayload).toBe(UNIVERSAL_AI_PROMPT);

      jest.clearAllMocks();
      await copyUniversalAiPrompt({ url: 'https://example.com' });
      copiedPayload = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copiedPayload).toBe(UNIVERSAL_AI_PROMPT);
      expect(copiedPayload).not.toContain('[object Object]');
    });
  });

  /* ========================================================================
     3. Error Handling & Rejection Fallbacks (Tier 1 & Tier 2)
     ======================================================================== */
  describe('Error Handling & Async Clipboard Failure', () => {
    test('TC-T1-F07-05: returns false gracefully when clipboard writeText rejects with generic Error', async () => {
      navigator.clipboard.writeText.mockRejectedValueOnce(
        new Error('Permission denied')
      );
      const result = await copyUniversalAiPrompt('user sample text');
      expect(result).toBe(false);
    });

    test('TC-T2-F07-04: returns false gracefully when clipboard writeText rejects with NotAllowedError DOMException', async () => {
      const domException = new DOMException(
        'The request is not allowed by the user agent.',
        'NotAllowedError'
      );
      navigator.clipboard.writeText.mockRejectedValueOnce(domException);

      const result = await copyUniversalAiPrompt('user sample text');
      expect(result).toBe(false);
    });

    test('TC-F07-ERR-01: returns false when navigator.clipboard is undefined without throwing', async () => {
      delete navigator.clipboard;
      const result = await copyUniversalAiPrompt();
      expect(result).toBe(false);
    });

    test('TC-F07-ERR-02: returns false when navigator.clipboard.writeText is not a function', async () => {
      navigator.clipboard.writeText = 'not-a-function';
      const result = await copyUniversalAiPrompt();
      expect(result).toBe(false);
    });
  });

  /* ========================================================================
     4. Legacy DOM Fallback via document.execCommand('copy')
     ======================================================================== */
  describe('Legacy DOM execCommand Fallback', () => {
    test('TC-F07-FALLBACK-01: falls back to document.execCommand("copy") when navigator.clipboard is missing', async () => {
      delete navigator.clipboard;
      document.execCommand = jest.fn().mockReturnValue(true);

      const result = await copyUniversalAiPrompt('fallback content');

      expect(result).toBe(true);
      expect(document.execCommand).toHaveBeenCalledWith('copy');
      // Verify no leaked textarea elements
      expect(document.body.querySelectorAll('textarea')).toHaveLength(0);
    });

    test('TC-F07-FALLBACK-02: falls back to document.execCommand("copy") when writeText throws', async () => {
      navigator.clipboard.writeText.mockRejectedValueOnce(new Error('Blocked'));
      document.execCommand = jest.fn().mockReturnValue(true);

      const result = await copyUniversalAiPrompt('fallback text');

      expect(result).toBe(true);
      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(document.body.querySelectorAll('textarea')).toHaveLength(0);
    });

    test('TC-F07-FALLBACK-03: guarantees removal of temporary textarea even if document.execCommand throws', async () => {
      delete navigator.clipboard;
      document.execCommand = jest.fn().mockImplementation(() => {
        throw new Error('execCommand fatal crash');
      });

      const result = await copyUniversalAiPrompt('text');

      expect(result).toBe(false);
      expect(document.body.querySelectorAll('textarea')).toHaveLength(0);
    });

    test('TC-F07-FALLBACK-04: returns false when document.execCommand returns false', async () => {
      delete navigator.clipboard;
      document.execCommand = jest.fn().mockReturnValue(false);

      const result = await copyUniversalAiPrompt('text');

      expect(result).toBe(false);
      expect(document.body.querySelectorAll('textarea')).toHaveLength(0);
    });
  });

  /* ========================================================================
     5. Concurrency Resilience (Tier 2)
     ======================================================================== */
  describe('Concurrency & Stress Resilience', () => {
    test('TC-T2-F07-05: handles 10 rapid concurrent copy requests without race conditions or uncaught errors', async () => {
      const concurrentRequests = Array.from({ length: 10 }, (_, idx) =>
        copyUniversalAiPrompt(`Concurrent payload ${idx}`)
      );

      const results = await Promise.all(concurrentRequests);

      expect(results).toHaveLength(10);
      expect(results.every((r) => r === true)).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(10);
    });
  });
});
