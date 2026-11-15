/**
 * @file tests/stress/localAiAssistant.adversarial.test.js
 * Adversarial stress harness and empirical validation suite for localAiAssistant.js:
 * 1. Download progress monitoring under corrupt/adversarial event inputs
 * 2. Session lifecycle resilience (DOMException, call stack blowup, destroy failure, hanging)
 * 3. Agent bridge integration boundaries (null, undefined, non-array, 500 items, all duplicates)
 */

import {
  extractUrlsWithGeminiNano,
  ingestExtractedUrls,
} from '../../src/js/core/localAiAssistant.js';
import { createAgentBridge } from '../../src/js/core/agentBridge.js';

function createMockHost(initialEntries = []) {
  let entries = [...initialEntries];
  return {
    getUrls: () => entries,
    normalize: (items) =>
      items
        .filter(
          (item) =>
            item && typeof item.url === 'string' && item.url.startsWith('http')
        )
        .map((item, idx) => ({
          id:
            item.id ||
            `entry-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          url: item.url.trim(),
          label: item.label || 'Default Label',
          tags: Array.isArray(item.tags) ? item.tags : [],
          isPinned: item.isPinned === true,
          usageCount: 0,
          createdAt: Date.now(),
          lastUsed: Date.now(),
        })),
    commit: (next) => {
      entries = [...next];
    },
  };
}

function setupMockLanguageModel(options = {}) {
  const {
    availability = 'available',
    promptResponse = JSON.stringify([
      { url: 'https://example.com', label: 'Example', tags: ['sample'] },
    ]),
    promptError = null,
    promptPromise = null,
    destroyError = null,
    createError = null,
    onMonitor = null,
  } = options;

  const mockSession = {
    destroyCalls: 0,
    prompt: jest.fn().mockImplementation(async (text) => {
      if (promptPromise) {
        return promptPromise;
      }
      if (promptError) {
        throw promptError;
      }
      return typeof promptResponse === 'function'
        ? promptResponse(text)
        : promptResponse;
    }),
    destroy: jest.fn().mockImplementation(() => {
      mockSession.destroyCalls++;
      if (destroyError) {
        throw destroyError;
      }
    }),
  };

  const mockLM = {
    availability: jest.fn().mockResolvedValue(availability),
    create: jest.fn().mockImplementation(async (createOptions = {}) => {
      if (createError) throw createError;
      if (typeof createOptions.monitor === 'function') {
        const monitorTarget = new EventTarget();
        if (onMonitor) {
          onMonitor(monitorTarget);
        }
        createOptions.monitor(monitorTarget);
      }
      return mockSession;
    }),
  };

  global.LanguageModel = mockLM;
  if (typeof window !== 'undefined') {
    window.LanguageModel = mockLM;
  }

  return {
    mockLM,
    mockSession,
  };
}

describe('Adversarial Stress Test: localAiAssistant.js', () => {
  afterEach(() => {
    delete global.LanguageModel;
    if (typeof window !== 'undefined') {
      delete window.LanguageModel;
      delete window.urlEditorAgent;
    }
    jest.clearAllMocks();
  });

  // =========================================================================
  // Section 1: Download Progress Monitoring Stress
  // =========================================================================
  describe('Download Progress Monitoring Edge Cases', () => {
    test('ADV-1.1: Negative loaded and total values (-1, -1)', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const reports = [];
      const onProgress = jest.fn((p) => reports.push(p));

      const promise = extractUrlsWithGeminiNano('some text', onProgress);
      await Promise.resolve();
      await Promise.resolve();

      const evt = new Event('downloadprogress');
      evt.loaded = -1;
      evt.total = -1;
      monitorTarget.dispatchEvent(evt);

      await promise;

      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(reports[0]).toEqual({
        loaded: -1,
        total: -1,
        percent: 0,
      });
      expect(reports[0].percent).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(reports[0].percent)).toBe(false);
    });

    test('ADV-1.2: Division by zero when total = 0 and loaded has various values', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const reports = [];
      const onProgress = jest.fn((p) => reports.push(p));

      const promise = extractUrlsWithGeminiNano('some text', onProgress);
      await Promise.resolve();
      await Promise.resolve();

      // Case A: loaded = 0, total = 0
      const evt0 = new Event('downloadprogress');
      evt0.loaded = 0;
      evt0.total = 0;
      monitorTarget.dispatchEvent(evt0);

      // Case B: loaded = 0.5 (fractional 0..1), total = 0
      const evtFraction = new Event('downloadprogress');
      evtFraction.loaded = 0.5;
      evtFraction.total = 0;
      monitorTarget.dispatchEvent(evtFraction);

      // Case C: loaded = 75 (> 1), total = 0
      const evtWhole = new Event('downloadprogress');
      evtWhole.loaded = 75;
      evtWhole.total = 0;
      monitorTarget.dispatchEvent(evtWhole);

      // Case D: loaded = 200 (> 100), total = 0
      const evtOver100 = new Event('downloadprogress');
      evtOver100.loaded = 200;
      evtOver100.total = 0;
      monitorTarget.dispatchEvent(evtOver100);

      await promise;

      expect(reports).toHaveLength(4);
      expect(reports[0].percent).toBe(0);
      expect(reports[1].percent).toBe(50);
      expect(reports[2].percent).toBe(75);
      expect(reports[3].percent).toBe(100); // capped at 100
      reports.forEach((r) => {
        expect(Number.isFinite(r.percent)).toBe(true);
      });
    });

    test('ADV-1.3: Total less than loaded (total < loaded)', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const reports = [];
      const onProgress = jest.fn((p) => reports.push(p));

      const promise = extractUrlsWithGeminiNano('some text', onProgress);
      await Promise.resolve();
      await Promise.resolve();

      const evt = new Event('downloadprogress');
      evt.loaded = 1500;
      evt.total = 1000;
      monitorTarget.dispatchEvent(evt);

      await promise;

      expect(reports[0].percent).toBe(100);
      expect(reports[0].loaded).toBe(1500);
      expect(reports[0].total).toBe(1000);
    });

    test('ADV-1.4: Non-numeric, undefined, and NaN values', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const reports = [];
      const onProgress = jest.fn((p) => reports.push(p));

      const promise = extractUrlsWithGeminiNano('some text', onProgress);
      await Promise.resolve();
      await Promise.resolve();

      // Case A: loaded = undefined, total = undefined
      const evtUndef = new Event('downloadprogress');
      monitorTarget.dispatchEvent(evtUndef);

      // Case B: loaded = "foo", total = "bar"
      const evtStr = new Event('downloadprogress');
      evtStr.loaded = 'foo';
      evtStr.total = 'bar';
      monitorTarget.dispatchEvent(evtStr);

      // Case C: loaded = null, total = null
      const evtNull = new Event('downloadprogress');
      evtNull.loaded = null;
      evtNull.total = null;
      monitorTarget.dispatchEvent(evtNull);

      // Case D: loaded = NaN, total = undefined
      const evtNanUndef = new Event('downloadprogress');
      evtNanUndef.loaded = NaN;
      evtNanUndef.total = undefined;
      monitorTarget.dispatchEvent(evtNanUndef);

      // Case E: loaded = NaN, total = 100
      const evtNanTotal = new Event('downloadprogress');
      evtNanTotal.loaded = NaN;
      evtNanTotal.total = 100;
      monitorTarget.dispatchEvent(evtNanTotal);

      // Case F: loaded = 50, total = NaN
      const evtTotalNan = new Event('downloadprogress');
      evtTotalNan.loaded = 50;
      evtTotalNan.total = NaN;
      monitorTarget.dispatchEvent(evtTotalNan);

      await promise;

      expect(reports).toHaveLength(6);
      expect(reports[0]).toEqual({ loaded: 0, total: 0, percent: 0 });
      expect(reports[1]).toEqual({ loaded: 0, total: 0, percent: 0 });
      expect(reports[2]).toEqual({ loaded: 0, total: 0, percent: 0 });
      expect(reports[3]).toEqual({ loaded: 0, total: 0, percent: 0 });

      // Note Case E behavior under test:
      // When loaded is NaN and total is 100, loaded defaults to 0 and percent is 0 (never NaN)
      expect(reports[4]).toEqual({ loaded: 0, total: 100, percent: 0 });
      expect(Number.isNaN(reports[4].percent)).toBe(false);

      // Case F: loaded = 50, total = NaN -> total > 0 is false, loaded > 1 is true -> percent = 50
      expect(reports[5].percent).toBe(50);
    });

    test('ADV-1.5: Progress monitor callback throws an exception during dispatch', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const crashingProgress = jest.fn(() => {
        throw new Error('Explosive UI crash inside download progress listener');
      });

      const promise = extractUrlsWithGeminiNano('some text', crashingProgress);
      await Promise.resolve();
      await Promise.resolve();

      const evt = new Event('downloadprogress');
      evt.loaded = 50;
      evt.total = 100;

      // dispatchEvent should not throw even if onProgress throws
      expect(() => {
        monitorTarget.dispatchEvent(evt);
      }).not.toThrow();

      // Extraction should continue and succeed
      const results = await promise;
      expect(results).toHaveLength(1);
      expect(crashingProgress).toHaveBeenCalledTimes(1);
    });

    test('ADV-1.6: event.loaded = NaN, event.total = 1000 verifies progress listener receives 0, never NaN', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const reports = [];
      const onProgress = jest.fn((p) => reports.push(p));

      const promise = extractUrlsWithGeminiNano('input', onProgress);
      await Promise.resolve();
      await Promise.resolve();

      const evt = new Event('downloadprogress');
      evt.loaded = NaN;
      evt.total = 1000;
      monitorTarget.dispatchEvent(evt);

      await promise;

      expect(onProgress).toHaveBeenCalledTimes(1);
      const report = reports[0];
      expect(report).toEqual({ loaded: 0, total: 1000, percent: 0 });
      expect(Number.isNaN(report.loaded)).toBe(false);
      expect(Number.isNaN(report.total)).toBe(false);
      expect(Number.isNaN(report.percent)).toBe(false);
      expect(Number.isFinite(report.percent)).toBe(true);
    });

    test('ADV-1.7: event.total = 0, event.loaded = 0 verifies percent = 0', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const reports = [];
      const onProgress = jest.fn((p) => reports.push(p));

      const promise = extractUrlsWithGeminiNano('input', onProgress);
      await Promise.resolve();
      await Promise.resolve();

      const evt = new Event('downloadprogress');
      evt.loaded = 0;
      evt.total = 0;
      monitorTarget.dispatchEvent(evt);

      await promise;

      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(reports[0]).toEqual({ loaded: 0, total: 0, percent: 0 });
      expect(reports[0].percent).toBe(0);
      expect(Number.isFinite(reports[0].percent)).toBe(true);
    });

    test('ADV-1.8: Fractional progress values (loaded = 12.34, total = 56.78)', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const reports = [];
      const onProgress = jest.fn((p) => reports.push(p));

      const promise = extractUrlsWithGeminiNano('input', onProgress);
      await Promise.resolve();
      await Promise.resolve();

      // (12.34 / 56.78) * 100 = 21.733... -> round to 22
      const evt = new Event('downloadprogress');
      evt.loaded = 12.34;
      evt.total = 56.78;
      monitorTarget.dispatchEvent(evt);

      await promise;

      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(reports[0].loaded).toBe(12.34);
      expect(reports[0].total).toBe(56.78);
      expect(reports[0].percent).toBe(22);
      expect(Number.isFinite(reports[0].percent)).toBe(true);
    });

    test('ADV-1.9: Negative loaded (-50) with positive total (1000) clamps percent to 0', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const reports = [];
      const onProgress = jest.fn((p) => reports.push(p));

      const promise = extractUrlsWithGeminiNano('input', onProgress);
      await Promise.resolve();
      await Promise.resolve();

      const evt = new Event('downloadprogress');
      evt.loaded = -50;
      evt.total = 1000;
      monitorTarget.dispatchEvent(evt);

      await promise;

      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(reports[0].percent).toBe(0);
      expect(Number.isFinite(reports[0].percent)).toBe(true);
      expect(reports[0].percent).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // Section 2: Session Lifecycle & Cleanup Resilience
  // =========================================================================
  describe('Session Lifecycle & Exception Survival', () => {
    test('ADV-2.1: session.destroy() is called when prompt() rejects with DOMException', async () => {
      const domException = new DOMException(
        'The prompt operation was aborted.',
        'AbortError'
      );
      const { mockSession } = setupMockLanguageModel({
        promptError: domException,
      });

      let caughtError = null;
      try {
        await extractUrlsWithGeminiNano('some prompt input');
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBe(domException);
      expect(caughtError.name).toBe('AbortError');
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
    });

    test('ADV-2.2: session.destroy() is called when JSON.parse blows call stack / throws RangeError', async () => {
      const { mockSession } = setupMockLanguageModel({
        promptResponse: '[{"url": "https://example.com"}]',
      });

      const parseSpy = jest.spyOn(JSON, 'parse').mockImplementationOnce(() => {
        throw new RangeError('Maximum call stack size exceeded');
      });

      let errorCaught = null;
      try {
        await extractUrlsWithGeminiNano('some text');
      } catch (err) {
        errorCaught = err;
      }

      parseSpy.mockRestore();

      expect(errorCaught).toBeDefined();
      expect(errorCaught.message).toMatch(
        /PARSE_ERROR.*Maximum call stack size exceeded/i
      );
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
    });

    test('ADV-2.3: session.destroy() throwing does NOT swallow the primary prompt error', async () => {
      const primaryError = new Error('PRIMARY_PROMPT_CRASH');
      const secondaryDestroyError = new Error('SECONDARY_DESTROY_CRASH');

      const { mockSession } = setupMockLanguageModel({
        promptError: primaryError,
        destroyError: secondaryDestroyError,
      });

      let caughtError = null;
      try {
        await extractUrlsWithGeminiNano('prompt input');
      } catch (err) {
        caughtError = err;
      }

      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
      expect(caughtError).toBe(primaryError);
      expect(caughtError.message).toBe('PRIMARY_PROMPT_CRASH');
    });

    test('ADV-2.4: session.destroy() throwing does NOT cause success prompt to fail', async () => {
      const secondaryDestroyError = new Error('DESTROY_HARDWARE_FAILURE');
      const { mockSession } = setupMockLanguageModel({
        promptResponse: JSON.stringify([
          { url: 'https://clean.example.com', label: 'Clean', tags: ['safe'] },
        ]),
        destroyError: secondaryDestroyError,
      });

      const results = await extractUrlsWithGeminiNano('input');
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0].url).toBe('https://clean.example.com');
    });

    test('ADV-2.5: Investigation of prompt() hanging behavior (no timeout / AbortSignal in API)', async () => {
      let resolvePrompt;
      const neverEndingPrompt = new Promise((resolve) => {
        resolvePrompt = resolve;
      });

      const { mockSession } = setupMockLanguageModel({
        promptPromise: neverEndingPrompt,
      });

      let finished = false;
      const extractionPromise = extractUrlsWithGeminiNano('hanging text').then(
        (res) => {
          finished = true;
          return res;
        }
      );

      // Let microtasks run
      await Promise.resolve();
      await Promise.resolve();

      // Because prompt never settles, destroy has NOT been called yet
      expect(finished).toBe(false);
      expect(mockSession.destroy).not.toHaveBeenCalled();

      // Now resolve the hanging prompt to clean up test
      resolvePrompt(
        JSON.stringify([
          { url: 'https://resolved.com', label: 'R', tags: ['r'] },
        ])
      );
      await extractionPromise;

      expect(finished).toBe(true);
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
    });

    test('ADV-2.6: Hanging prompt with timeoutMs option rejects with PROMPT_TIMEOUT and guarantees session.destroy()', async () => {
      let resolvePrompt;
      const neverEndingPrompt = new Promise((resolve) => {
        resolvePrompt = resolve;
      });

      const { mockSession } = setupMockLanguageModel({
        promptPromise: neverEndingPrompt,
      });

      const extractionPromise = extractUrlsWithGeminiNano(
        'hanging text with timeout',
        null,
        { timeoutMs: 20 }
      );

      await expect(extractionPromise).rejects.toThrow(/PROMPT_TIMEOUT/i);
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);

      // Clean up lingering unhandled promise
      resolvePrompt('[]');
    });

    test('ADV-2.7: Hanging prompt with AbortSignal rejects with AbortError and guarantees session.destroy()', async () => {
      let resolvePrompt;
      const neverEndingPrompt = new Promise((resolve) => {
        resolvePrompt = resolve;
      });

      const { mockSession } = setupMockLanguageModel({
        promptPromise: neverEndingPrompt,
      });

      const controller = new AbortController();
      const extractionPromise = extractUrlsWithGeminiNano(
        'hanging text with abort',
        null,
        { signal: controller.signal }
      );

      // Abort after small microtask tick
      await Promise.resolve();
      controller.abort();

      await expect(extractionPromise).rejects.toThrow(/aborted/i);
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);

      resolvePrompt('[]');
    });

    test('ADV-2.8: Synchronous throw inside monitorTarget.addEventListener is caught gracefully', async () => {
      let addEventListenerThrew = false;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          target.addEventListener = () => {
            addEventListenerThrew = true;
            throw new Error('Blocked by restrictive sandbox environment');
          };
        },
        promptResponse: JSON.stringify([
          {
            url: 'https://resilient.example.com',
            label: 'Resilient',
            tags: ['safe'],
          },
        ]),
      });

      const onProgress = jest.fn();
      const results = await extractUrlsWithGeminiNano(
        'some input text',
        onProgress
      );

      expect(addEventListenerThrew).toBe(true);
      expect(results).toHaveLength(1);
      expect(results[0].url).toBe('https://resilient.example.com');
      expect(onProgress).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Section 3: Bridge Integration Boundaries
  // =========================================================================
  describe('Agent Bridge Integration (ingestExtractedUrls)', () => {
    let host;
    let bridge;

    beforeEach(() => {
      host = createMockHost();
      bridge = createAgentBridge(host);
      window.urlEditorAgent = bridge;
    });

    test('ADV-3.1: Call ingestExtractedUrls with null', async () => {
      const result = await ingestExtractedUrls(null);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('invalid_input');
      expect(result.error.message).toMatch(/non-empty array/i);
    });

    test('ADV-3.2: Call ingestExtractedUrls with undefined', async () => {
      const result = await ingestExtractedUrls(undefined);
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('invalid_input');
      expect(result.error.message).toMatch(/non-empty array/i);
    });

    test('ADV-3.3: Call ingestExtractedUrls with an object instead of array', async () => {
      const result = await ingestExtractedUrls({ url: 'https://example.com' });
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('invalid_input');
      expect(result.error.message).toMatch(/non-empty array/i);
    });

    test('ADV-3.4: Call ingestExtractedUrls with 500 items (chunks across MAX_BATCH of 200)', async () => {
      const largeBatch = Array.from({ length: 500 }, (_, i) => ({
        url: `https://batch-${i}.example.com`,
        label: `Batch ${i}`,
        tags: ['batch'],
      }));

      const result = await ingestExtractedUrls(largeBatch);
      expect(result.ok).toBe(true);
      expect(result.added).toHaveLength(500);
      expect(result.skipped).toEqual([]);
      expect(host.getUrls()).toHaveLength(500);
    });

    test('ADV-3.5: Call ingestExtractedUrls with all duplicate items', async () => {
      const duplicates = Array.from({ length: 50 }, () => ({
        url: 'https://duplicate.example.com',
        label: 'Duplicate Entry',
        tags: ['duplicate'],
      }));

      // Store initially empty
      const result = await ingestExtractedUrls(duplicates);
      expect(result.ok).toBe(true);
      expect(result.added).toHaveLength(1); // Exactly 1 item ingested
      expect(result.skipped).toHaveLength(49); // Remaining 49 skipped
      expect(result.skipped.every((s) => s.reason === 'duplicate')).toBe(true);
      expect(host.getUrls()).toHaveLength(1);

      // Calling again with the same duplicate items
      const result2 = await ingestExtractedUrls(duplicates);
      expect(result2.ok).toBe(true);
      expect(result2.added).toHaveLength(0); // 0 added
      expect(result2.skipped).toHaveLength(50); // All 50 skipped
      expect(result2.skipped.every((s) => s.reason === 'duplicate')).toBe(true);
      expect(host.getUrls()).toHaveLength(1);
    });

    test('ADV-3.6: 500 items batch with duplicates across chunks verifies chunking (200, 200, 100) and skipped index offsets', async () => {
      // Pre-seed host with 3 URLs that will collide with items at index 10, 215, 425
      host.commit([
        {
          id: 'pre-1',
          url: 'https://preseed-1.example.com',
          label: 'P1',
          tags: [],
        },
        {
          id: 'pre-2',
          url: 'https://preseed-2.example.com',
          label: 'P2',
          tags: [],
        },
        {
          id: 'pre-3',
          url: 'https://preseed-3.example.com',
          label: 'P3',
          tags: [],
        },
      ]);

      const largeBatch = Array.from({ length: 500 }, (_, i) => {
        if (i === 10)
          return {
            url: 'https://preseed-1.example.com',
            label: 'Dup 10',
            tags: [],
          };
        if (i === 215)
          return {
            url: 'https://preseed-2.example.com',
            label: 'Dup 215',
            tags: [],
          };
        if (i === 425)
          return {
            url: 'https://preseed-3.example.com',
            label: 'Dup 425',
            tags: [],
          };
        return {
          url: `https://chunked-item-${i}.example.com`,
          label: `Item ${i}`,
          tags: ['tag'],
        };
      });

      const result = await ingestExtractedUrls(largeBatch);

      expect(result.ok).toBe(true);
      expect(result.added).toHaveLength(497);
      expect(result.skipped).toHaveLength(3);

      // Verify exact skipped indices matching the original 500-item batch coordinates
      expect(result.skipped).toEqual([
        expect.objectContaining({ index: 10, reason: 'duplicate' }),
        expect.objectContaining({ index: 215, reason: 'duplicate' }),
        expect.objectContaining({ index: 425, reason: 'duplicate' }),
      ]);

      // Total in store: 3 preseeded + 497 added = 500
      expect(host.getUrls()).toHaveLength(500);
    });

    test('ADV-3.7: Ingestion aborts and returns error payload if an intermediate chunk fails', async () => {
      const items = Array.from({ length: 450 }, (_, i) => ({
        url: `https://failing-chunk-${i}.example.com`,
        label: `Item ${i}`,
        tags: [],
      }));

      let callCount = 0;
      const failingBridge = {
        addMany: jest.fn().mockImplementation((chunk) => {
          callCount++;
          if (callCount === 2) {
            return {
              ok: false,
              error: { code: 'quota_exceeded', message: 'Storage full' },
            };
          }
          return { ok: true, added: chunk, skipped: [] };
        }),
      };
      window.urlEditorAgent = failingBridge;

      const result = await ingestExtractedUrls(items);

      expect(failingBridge.addMany).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(false);
      expect(result.error).toEqual({
        code: 'quota_exceeded',
        message: 'Storage full',
      });
    });
  });
});
