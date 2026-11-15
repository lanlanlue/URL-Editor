/**
 * @file tests/stress/aiPromptHelper.adversarial.test.js
 * Empirical challenger stress harness and validation suite:
 * 1. copyUniversalAiPrompt stress testing:
 *    - Inputs: null, undefined, empty string, whitespace, 100,000 characters payload, emojis, quotes
 *    - Rejection with DOMException: NotAllowedError -> fallback
 *    - Undefined navigator.clipboard -> fallback
 *    - Textarea 100% DOM removal verification even if execCommand throws
 *    - 50 concurrent calls stress test
 * 2. src/index.html metadata validation:
 *    - <meta name="ai-agent-instructions"> format pattern verification
 *    - <script type="application/ld+json"> extraction and JSON.parse
 *    - Schema.org WebApplication properties and no script tags with src attribute
 */

import fs from 'fs';
import path from 'path';
import {
  UNIVERSAL_AI_PROMPT,
  copyUniversalAiPrompt,
} from '../../src/js/ui/components/aiPromptHelper.js';

describe('Empirical Adversarial Stress Suite: Prompt Helper & Metadata', () => {
  let originalClipboard;
  let originalExecCommand;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;

    // Reset DOM
    document.body.innerHTML = '';

    // Default mock: healthy navigator.clipboard.writeText
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
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
    jest.restoreAllMocks();
  });

  /* ========================================================================
     Part 1: copyUniversalAiPrompt(rawText) Empirical Stress Testing
     ======================================================================== */
  describe('1. copyUniversalAiPrompt(rawText) Input Variations & Edge Cases', () => {
    test('handles null rawText: copies pure base prompt without literal "null"', async () => {
      const result = await copyUniversalAiPrompt(null);
      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      const copied = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copied).toBe(UNIVERSAL_AI_PROMPT);
      expect(copied).not.toContain('null');
      expect(copied).not.toContain('---');
    });

    test('handles undefined rawText: copies pure base prompt without literal "undefined"', async () => {
      const result = await copyUniversalAiPrompt(undefined);
      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      const copied = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copied).toBe(UNIVERSAL_AI_PROMPT);
      expect(copied).not.toContain('undefined');
      expect(copied).not.toContain('---');
    });

    test('handles empty string "": copies pure base prompt without delimiter', async () => {
      const result = await copyUniversalAiPrompt('');
      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      const copied = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copied).toBe(UNIVERSAL_AI_PROMPT);
      expect(copied).not.toContain('---');
    });

    test('handles multi-line whitespace strings: copies base prompt only', async () => {
      const whitespacePayloads = [
        '   ',
        '\t\t\t',
        '\n\r\n\t  \n',
        '       \n\n\r\n    ',
      ];
      for (const ws of whitespacePayloads) {
        jest.clearAllMocks();
        const result = await copyUniversalAiPrompt(ws);
        expect(result).toBe(true);
        expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
        const copied = navigator.clipboard.writeText.mock.calls[0][0];
        expect(copied).toBe(UNIVERSAL_AI_PROMPT);
        expect(copied).not.toContain('---');
      }
    });

    test('handles 100,000 characters payload cleanly without memory or truncation errors', async () => {
      const massivePayload =
        'https://example.com/item?id=' + 'x'.repeat(100000);
      const startTime = Date.now();
      const result = await copyUniversalAiPrompt(massivePayload);
      const elapsed = Date.now() - startTime;

      expect(result).toBe(true);
      expect(elapsed).toBeLessThan(1500); // Must complete well under 1.5s
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      const copied = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copied.length).toBeGreaterThan(100000);
      expect(copied).toContain(UNIVERSAL_AI_PROMPT);
      expect(copied).toContain('---');
      expect(copied).toContain(massivePayload);
    });

    test('preserves complex emojis, multi-byte surrogate pairs, and zero-width joiner sequences', async () => {
      const emojiPayload =
        '測試表情符號: 👨‍👩‍👧‍👦 🌈 🚀 💻 🛡️ 🔑 🦄 🇹🇼 🤖 \uD83D\uDE00 \uD83D\uDE02';
      const result = await copyUniversalAiPrompt(emojiPayload);

      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      const copied = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copied).toContain(emojiPayload);
      expect(copied).toContain('👨‍👩‍👧‍👦');
      expect(copied).toContain('🇹🇼');
    });

    test('preserves all quote variants, backticks, and code syntax safely without mangling', async () => {
      const quotesPayload = `Single 'quotes', double "quotes", typographic “curly” quotes, backticks \`code\`, and XML <div class="test" data-val='1'>&amp;</div>`;
      const result = await copyUniversalAiPrompt(quotesPayload);

      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      const copied = navigator.clipboard.writeText.mock.calls[0][0];
      expect(copied).toContain(quotesPayload);
      expect(copied).toContain('“curly”');
      expect(copied).toContain('`code`');
    });
  });

  /* ========================================================================
     Part 2: Async Clipboard Rejections & Fallback Behavior
     ======================================================================== */
  describe('2. Clipboard API Failures & Fallback Resilience', () => {
    test('falls back to document.execCommand when writeText rejects with DOMException: NotAllowedError', async () => {
      const notAllowedException = new DOMException(
        'The request is not allowed by the user agent or the platform in the current context.',
        'NotAllowedError'
      );
      navigator.clipboard.writeText.mockRejectedValueOnce(notAllowedException);

      let execCommandCalledWith = null;
      document.execCommand = jest.fn().mockImplementation((cmd) => {
        execCommandCalledWith = cmd;
        return true;
      });

      const result = await copyUniversalAiPrompt('User research notes');

      expect(result).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
      expect(document.execCommand).toHaveBeenCalledTimes(1);
      expect(execCommandCalledWith).toBe('copy');
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });

    test('falls back to document.execCommand when navigator.clipboard is undefined', async () => {
      delete navigator.clipboard;

      document.execCommand = jest.fn().mockReturnValue(true);

      const result = await copyUniversalAiPrompt('Test payload');

      expect(result).toBe(true);
      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });

    test('returns false when navigator.clipboard is undefined and document.execCommand returns false', async () => {
      delete navigator.clipboard;

      document.execCommand = jest.fn().mockReturnValue(false);

      const result = await copyUniversalAiPrompt('Payload');

      expect(result).toBe(false);
      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });

    test('returns false without crashing when document.execCommand throws an unexpected error', async () => {
      delete navigator.clipboard;

      document.execCommand = jest.fn().mockImplementation(() => {
        throw new Error('Fatal document.execCommand security error');
      });

      const result = await copyUniversalAiPrompt('Payload');

      expect(result).toBe(false);
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });

    test('handles headless/server environments gracefully (document undefined or document.body missing)', async () => {
      delete navigator.clipboard;

      const originalBody = document.body;
      try {
        // Temporarily detach document.body
        Object.defineProperty(document, 'body', {
          value: null,
          configurable: true,
        });

        const result = await copyUniversalAiPrompt('Headless text');
        expect(result).toBe(false);
      } finally {
        Object.defineProperty(document, 'body', {
          value: originalBody,
          configurable: true,
        });
      }
    });
  });

  /* ========================================================================
     Part 3: 100% DOM Cleanup Verification Under Hostile Conditions
     ======================================================================== */
  describe('3. Off-Screen <textarea> Lifecycle and 100% DOM Cleanup Guarantee', () => {
    test('textarea is correctly configured in DOM during execCommand execution and 100% removed immediately after', async () => {
      delete navigator.clipboard;

      let textareaDuringExec = null;
      let textareaCountDuringExec = -1;

      document.execCommand = jest.fn().mockImplementation((cmd) => {
        if (cmd === 'copy') {
          const textareas = document.querySelectorAll('textarea');
          textareaCountDuringExec = textareas.length;
          textareaDuringExec = textareas[0];
        }
        return true;
      });

      expect(document.querySelectorAll('textarea')).toHaveLength(0);

      const res = await copyUniversalAiPrompt('DOM cleanup check');
      expect(res).toBe(true);

      // Verify state during execution
      expect(textareaCountDuringExec).toBe(1);
      expect(textareaDuringExec).toBeDefined();
      expect(textareaDuringExec.style.position).toBe('fixed');
      expect(textareaDuringExec.style.top).toBe('-9999px');
      expect(textareaDuringExec.style.left).toBe('-9999px');
      expect(textareaDuringExec.style.opacity).toBe('0');
      expect(textareaDuringExec.getAttribute('readonly')).toBe('');
      expect(textareaDuringExec.getAttribute('aria-hidden')).toBe('true');
      expect(textareaDuringExec.value).toContain('DOM cleanup check');

      // Verify 100% cleanup after execution completes
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
      expect(document.body.childNodes).toHaveLength(0);
    });

    test('textarea is 100% removed from DOM even when execCommand throws an unhandled DOMException', async () => {
      delete navigator.clipboard;

      document.execCommand = jest.fn().mockImplementation(() => {
        const currentTextareas = document.querySelectorAll('textarea');
        expect(currentTextareas).toHaveLength(1);
        throw new DOMException(
          'execCommand failed inside iframe',
          'SecurityError'
        );
      });

      const res = await copyUniversalAiPrompt('Crashing execCommand');
      expect(res).toBe(false);

      // Verify guaranteed removal despite exception
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
      expect(document.body.children).toHaveLength(0);
    });

    test('textarea is 100% removed even if focus() or select() throws on custom elements', async () => {
      delete navigator.clipboard;

      const originalCreateElement = document.createElement.bind(document);
      jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
        const el = originalCreateElement(tagName);
        if (tagName === 'textarea') {
          el.select = () => {
            throw new Error('select() not implemented on mock');
          };
        }
        return el;
      });

      const res = await copyUniversalAiPrompt('Select crash');
      expect(res).toBe(false);

      // Still guaranteed to be cleaned up
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });
  });

  /* ========================================================================
     Part 4: Concurrency Stress (50 Concurrent Calls)
     ======================================================================== */
  describe('4. High Concurrency Stress: 50 Simultaneous copyUniversalAiPrompt Calls', () => {
    test('handles 50 concurrent calls via modern Async Clipboard API without race conditions', async () => {
      let callCount = 0;
      navigator.clipboard.writeText.mockImplementation(async () => {
        callCount++;
        // Introduce small jitter to simulate real async clipboard latency
        await new Promise((r) => setTimeout(r, Math.random() * 5));
      });

      const batch = Array.from({ length: 50 }, (_, i) =>
        copyUniversalAiPrompt(`Payload #${i}`)
      );

      const results = await Promise.all(batch);

      expect(results).toHaveLength(50);
      expect(results.every((r) => r === true)).toBe(true);
      expect(callCount).toBe(50);
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });

    test('handles 50 concurrent calls in fallback mode without leaking textareas or DOM bloat', async () => {
      delete navigator.clipboard;

      let executedCopies = 0;
      document.execCommand = jest.fn().mockImplementation((cmd) => {
        if (cmd === 'copy') executedCopies++;
        return true;
      });

      const batch = Array.from({ length: 50 }, (_, i) =>
        copyUniversalAiPrompt(`Concurrent fallback #${i}`)
      );

      const results = await Promise.all(batch);

      expect(results).toHaveLength(50);
      expect(results.every((r) => r === true)).toBe(true);
      expect(executedCopies).toBe(50);
      // DOM must have exactly 0 textareas left
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
      expect(document.body.children).toHaveLength(0);
    });

    test('handles 50 concurrent calls with mixed rejections and fallback errors cleanly', async () => {
      // 50 concurrent calls:
      // Even calls: writeText succeeds
      // Odd calls: writeText rejects with NotAllowedError -> execCommand called
      // For odd calls divisible by 5: execCommand throws
      navigator.clipboard.writeText.mockImplementation(async (text) => {
        const idxMatch = text.match(/#(\d+)/);
        const idx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
        if (idx % 2 !== 0) {
          throw new DOMException('Not allowed', 'NotAllowedError');
        }
      });

      document.execCommand = jest.fn().mockImplementation(() => {
        const textareas = document.querySelectorAll('textarea');
        if (textareas.length > 0) {
          const val = textareas[0].value;
          const idxMatch = val.match(/#(\d+)/);
          const idx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
          if (idx % 5 === 0) {
            throw new Error('execCommand fault');
          }
        }
        return true;
      });

      const batch = Array.from({ length: 50 }, (_, i) =>
        copyUniversalAiPrompt(`Mixed payload #${i}`)
      );

      const results = await Promise.all(batch);

      expect(results).toHaveLength(50);
      // Even calls (25 items) succeeded via writeText
      // Odd calls not divisible by 5 succeeded via execCommand
      // Odd calls divisible by 5 (5, 15, 25, 35, 45 -> 5 items) failed gracefully
      const successfulCount = results.filter((r) => r === true).length;
      const failedCount = results.filter((r) => r === false).length;
      expect(successfulCount).toBe(45);
      expect(failedCount).toBe(5);

      // DOM must remain completely clean
      expect(document.querySelectorAll('textarea')).toHaveLength(0);
      expect(document.body.children).toHaveLength(0);
    });
  });

  /* ========================================================================
     Part 5: src/index.html Metadata Empirical Validation
     ======================================================================== */
  describe('5. src/index.html AI Metadata & Schema.org Specification Validation', () => {
    let indexHtmlRaw;

    beforeAll(() => {
      const htmlPath = path.resolve(__dirname, '../../src/index.html');
      if (fs.existsSync(htmlPath)) {
        indexHtmlRaw = fs.readFileSync(htmlPath, 'utf-8');
      }
    });

    test('validates <meta name="ai-agent-instructions"> exists and contains strict format pattern', () => {
      expect(indexHtmlRaw).toBeDefined();
      // Find the meta tag
      const metaRegex =
        /<meta\s+name=["']ai-agent-instructions["']\s+content=["']([\s\S]*?)["']\s*\/?>/i;
      const match = indexHtmlRaw.match(metaRegex);

      expect(match).not.toBeNull();
      const content = match[1];

      // Format pattern checks
      expect(content).toContain('[label](url) #tag1 #tag2');
      expect(content).toContain('[標籤名稱](URL) #tag1 #tag2');
      expect(content).toContain('Markdown');
      expect(content).toContain('URL-Editor');
      expect(content).toContain('strictly as one item per line');
    });

    test('extracts <script type="application/ld+json">, parses cleanly, and verifies Schema.org WebApplication', () => {
      const scriptRegex =
        /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/i;
      const match = indexHtmlRaw.match(scriptRegex);

      expect(match).not.toBeNull();
      const jsonText = match[1].trim();

      // Must parse without JSON syntax error
      let parsedJson;
      expect(() => {
        parsedJson = JSON.parse(jsonText);
      }).not.toThrow();

      // Verify Schema.org WebApplication specification
      expect(parsedJson['@context']).toBe('https://schema.org');
      expect(parsedJson['@type']).toBe('WebApplication');
      expect(parsedJson.name).toBe('URL Editor');
      expect(typeof parsedJson.description).toBe('string');
      expect(parsedJson.description).toContain('AI Smart Import');
      expect(parsedJson.description).toContain('Gemini Nano');
      expect(parsedJson.applicationCategory).toBe('UtilityApplication');
      expect(parsedJson.operatingSystem).toBe('All');
      expect(typeof parsedJson.browserRequirements).toBe('string');
      expect(parsedJson.browserRequirements).toContain('Prompt API');

      // Verify featureList
      expect(Array.isArray(parsedJson.featureList)).toBe(true);
      expect(parsedJson.featureList).toContain('AI Smart Import');
      expect(parsedJson.featureList).toContain('Gemini Nano local extraction');
      expect(parsedJson.featureList).toContain('Batch UTM tagging');
      expect(parsedJson.featureList).toContain('Trailing hashtag parsing');
    });

    test('verifies <script type="application/ld+json"> has no src attribute (inline JSON-LD)', () => {
      const allLdJsonTags = [
        ...indexHtmlRaw.matchAll(
          /<script[^>]*type=["']application\/ld\+json["'][^>]*>/gi
        ),
      ];

      expect(allLdJsonTags.length).toBeGreaterThanOrEqual(1);
      for (const tagMatch of allLdJsonTags) {
        const tag = tagMatch[0];
        expect(tag).not.toMatch(/\bsrc\s*=/i);
      }
    });

    test('verifies no external script tags with remote src attributes exist in src/index.html', () => {
      // Find all <script src="..."> tags
      const scriptWithSrcMatches = [
        ...indexHtmlRaw.matchAll(/<script[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi),
      ];

      for (const match of scriptWithSrcMatches) {
        const srcAttr = match[1];
        // Must NOT start with http://, https://, or //
        expect(srcAttr).not.toMatch(/^(?:https?:)?\/\//i);
      }
    });
  });
});
