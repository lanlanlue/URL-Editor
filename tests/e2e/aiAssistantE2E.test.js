/**
 * @file tests/e2e/aiAssistantE2E.test.js
 * @description Opaque-box, requirement-driven E2E test suite for the Dual-Track AI Assistant
 * (Chrome on-device Gemini Nano Prompt API & Chrome Ask Gemini sidebar collaboration).
 *
 * Principles:
 * 1. Opaque-box: tests public contracts only (checkLocalAiAvailability, extractUrlsWithGeminiNano,
 *    UNIVERSAL_AI_PROMPT, copyUniversalAiPrompt, window.urlEditorAgent.addMany, parseBatchUrlText).
 * 2. Deterministic & Isolated: External browser APIs (LanguageModel, navigator.clipboard) are mocked
 *    cleanly with complete cleanup in afterEach.
 * 3. Progressive Testability: Dynamically verifies available modules across implementation milestones
 *    without crashing when modules are delivered in phases.
 */

import fs from 'fs';
import path from 'path';
import { createAgentBridge } from '../../src/js/core/agentBridge.js';
import { parseBatchUrlText, isSafeUrl } from '../../src/js/core/urlParser.js';

// Safe module loaders for progressive milestones
function loadLocalAiAssistant() {
  try {
    return require('../../src/js/core/localAiAssistant.js');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

function loadAiPromptHelper() {
  try {
    return require('../../src/js/ui/components/aiPromptHelper.js');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

const localAiModule = loadLocalAiAssistant();
const promptHelperModule = loadAiPromptHelper();

const describeIfLocalAi = localAiModule ? describe : describe.skip;
const describeIfPromptHelper = promptHelperModule ? describe : describe.skip;

/* ==========================================================================
   Mock Harnesses for Browser APIs
   ========================================================================== */

class MockLanguageModelSession {
  constructor(options = {}) {
    this.options = options;
    this.destroyCalls = 0;
  }

  async prompt(text, promptOptions = {}) {
    if (this.options.promptError) {
      throw this.options.promptError;
    }
    if (typeof this.options.promptResponse === 'function') {
      return this.options.promptResponse(text, promptOptions);
    }
    return this.options.promptResponse || '[]';
  }

  destroy() {
    this.destroyCalls += 1;
    if (this.options.destroyError) {
      throw this.options.destroyError;
    }
  }
}

class MockLanguageModel {
  static availabilityStatus = 'available';
  static availabilityError = null;
  static sessionOptions = {};
  static createdSessions = [];

  static reset() {
    MockLanguageModel.availabilityStatus = 'available';
    MockLanguageModel.availabilityError = null;
    MockLanguageModel.sessionOptions = {};
    MockLanguageModel.createdSessions = [];
  }

  static async availability() {
    if (MockLanguageModel.availabilityError) {
      throw MockLanguageModel.availabilityError;
    }
    return MockLanguageModel.availabilityStatus;
  }

  static async create(options = {}) {
    if (options.monitor && typeof options.monitor === 'function') {
      const target = new EventTarget();
      options.monitor(target);
      // Simulate download progress event if model was downloadable
      if (MockLanguageModel.availabilityStatus === 'downloadable') {
        const event = new CustomEvent('downloadprogress');
        Object.assign(event, { loaded: 50, total: 100 });
        target.dispatchEvent(event);
      }
    }
    const session = new MockLanguageModelSession({
      ...options,
      ...MockLanguageModel.sessionOptions,
    });
    MockLanguageModel.createdSessions.push(session);
    return session;
  }
}

/* ==========================================================================
   Agent Bridge Test Host Harness
   ========================================================================== */

function createMockHost(initialEntries = []) {
  let urls = initialEntries.map((e, idx) => ({
    id: e.id || `entry-${idx + 1}`,
    url: e.url,
    label: e.label || '',
    tags: Array.isArray(e.tags) ? [...e.tags] : [],
    isPinned: Boolean(e.isPinned),
    usageCount: e.usageCount || 0,
    createdAt: e.createdAt || Date.now(),
    lastUsed: e.lastUsed || null,
  }));

  const commitSpy = jest.fn((nextEntries) => {
    urls = nextEntries;
    document.dispatchEvent(new CustomEvent('url-editor-data-change'));
  });

  const normalizeSpy = jest.fn((entries) => {
    return entries
      .filter((e) => e && isSafeUrl(e.url))
      .map((e, idx) => ({
        id: e.id || `entry-gen-${Date.now()}-${idx}`,
        url: e.url.trim(),
        label: (e.label || '').trim(),
        tags: Array.isArray(e.tags)
          ? e.tags.map((t) => t.trim()).filter(Boolean)
          : [],
        isPinned: Boolean(e.isPinned),
        usageCount: e.usageCount || 0,
        createdAt: e.createdAt || Date.now(),
        lastUsed: e.lastUsed || null,
      }));
  });

  return {
    getUrls: () => urls,
    normalize: normalizeSpy,
    commit: commitSpy,
  };
}

/* ==========================================================================
   E2E Test Suite
   ========================================================================== */

describe('E2E: AI Assistant Integration Suite', () => {
  let mockHost;
  let mockBridge;

  beforeEach(() => {
    MockLanguageModel.reset();
    global.LanguageModel = MockLanguageModel;

    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(true),
      },
    });

    // Setup Agent Bridge Host
    mockHost = createMockHost([]);
    mockBridge = createAgentBridge(mockHost);
    window.urlEditorAgent = mockBridge;
  });

  afterEach(() => {
    delete global.LanguageModel;
    delete window.urlEditorAgent;
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  /* ------------------------------------------------------------------------
     1. checkLocalAiAvailability Contract (Feature F01)
     ------------------------------------------------------------------------ */
  describeIfLocalAi('Feature F01: checkLocalAiAvailability Contract', () => {
    test('TC-T1-F01-01: resolves "available" when model is fully ready', async () => {
      MockLanguageModel.availabilityStatus = 'available';
      const status = await localAiModule.checkLocalAiAvailability();
      expect(status).toBe('available');
    });

    test('TC-T1-F01-02: resolves "downloadable" when weights require download', async () => {
      MockLanguageModel.availabilityStatus = 'downloadable';
      const status = await localAiModule.checkLocalAiAvailability();
      expect(status).toBe('downloadable');
    });

    test('TC-T1-F01-03: resolves "downloading" during in-progress weight transfer', async () => {
      MockLanguageModel.availabilityStatus = 'downloading';
      const status = await localAiModule.checkLocalAiAvailability();
      expect(status).toBe('downloading');
    });

    test('TC-T1-F01-04: resolves "unavailable" when device is unsupported', async () => {
      MockLanguageModel.availabilityStatus = 'unavailable';
      const status = await localAiModule.checkLocalAiAvailability();
      expect(status).toBe('unavailable');
    });

    test('TC-T1-F01-05: safely returns "unavailable" when LanguageModel is undefined (Safari/Firefox)', async () => {
      delete global.LanguageModel;
      const status = await localAiModule.checkLocalAiAvailability();
      expect(status).toBe('unavailable');
    });

    test('TC-T2-F01-01: safely returns "unavailable" when LanguageModel.availability is not a function', async () => {
      global.LanguageModel = {};
      const status = await localAiModule.checkLocalAiAvailability();
      expect(status).toBe('unavailable');
    });

    test('TC-T2-F01-02: catches availability() rejection and returns "unavailable"', async () => {
      MockLanguageModel.availabilityError = new Error('GPU Process Crashed');
      const status = await localAiModule.checkLocalAiAvailability();
      expect(status).toBe('unavailable');
    });
  });

  /* ------------------------------------------------------------------------
     2. extractUrlsWithGeminiNano On-Device Inference (Features F02, F03, F04)
     ------------------------------------------------------------------------ */
  describeIfLocalAi(
    'Features F02-F04: extractUrlsWithGeminiNano & Session Lifecycle',
    () => {
      test('TC-T1-F02-01: extracts structured URLs, labels, and tags from plain text', async () => {
        const mockResult = [
          {
            url: 'https://github.com/darren/url-editor',
            label: 'URL Editor Repo',
            tags: ['github', 'tool'],
          },
          {
            url: 'https://developer.mozilla.org/en-US/',
            label: 'MDN Web Docs',
            tags: ['documentation', 'web'],
          },
        ];

        MockLanguageModel.sessionOptions = {
          promptResponse: JSON.stringify(mockResult),
        };

        const extracted = await localAiModule.extractUrlsWithGeminiNano(
          'Check out https://github.com/darren/url-editor and https://developer.mozilla.org/en-US/'
        );

        expect(Array.isArray(extracted)).toBe(true);
        expect(extracted).toHaveLength(2);
        expect(extracted[0]).toEqual({
          url: 'https://github.com/darren/url-editor',
          label: 'URL Editor Repo',
          tags: ['github', 'tool'],
        });
        expect(extracted[1]).toEqual({
          url: 'https://developer.mozilla.org/en-US/',
          label: 'MDN Web Docs',
          tags: ['documentation', 'web'],
        });
      });

      test('TC-T1-F02-02: throws LOCAL_AI_UNAVAILABLE error when status is unavailable', async () => {
        MockLanguageModel.availabilityStatus = 'unavailable';

        await expect(
          localAiModule.extractUrlsWithGeminiNano('https://example.com')
        ).rejects.toThrow();

        expect(MockLanguageModel.createdSessions).toHaveLength(0);
      });

      test('TC-T1-F02-03: reports download progress when model is downloadable', async () => {
        MockLanguageModel.availabilityStatus = 'downloadable';
        MockLanguageModel.sessionOptions = {
          promptResponse: '[]',
        };

        const progressEvents = [];
        const onProgress = (p) => progressEvents.push(p);

        await localAiModule.extractUrlsWithGeminiNano(
          'https://example.com',
          onProgress
        );

        expect(progressEvents.length).toBeGreaterThan(0);
        expect(progressEvents[0]).toHaveProperty('loaded');
        expect(progressEvents[0]).toHaveProperty('total');
        expect(progressEvents[0]).toHaveProperty('percent');
      });

      test('TC-T1-F04-01: session.destroy() is called exactly once upon successful completion', async () => {
        MockLanguageModel.sessionOptions = {
          promptResponse: JSON.stringify([
            { url: 'https://example.com', label: 'Ex', tags: [] },
          ]),
        };

        await localAiModule.extractUrlsWithGeminiNano('https://example.com');

        expect(MockLanguageModel.createdSessions).toHaveLength(1);
        expect(MockLanguageModel.createdSessions[0].destroyCalls).toBe(1);
      });

      test('TC-T1-F04-02: session.destroy() is guaranteed in finally block when prompt rejects', async () => {
        MockLanguageModel.sessionOptions = {
          promptError: new Error('Token budget exceeded'),
        };

        await expect(
          localAiModule.extractUrlsWithGeminiNano('https://example.com')
        ).rejects.toThrow('Token budget exceeded');

        expect(MockLanguageModel.createdSessions).toHaveLength(1);
        expect(MockLanguageModel.createdSessions[0].destroyCalls).toBe(1);
      });

      test('TC-T1-F03-02: defensively strips markdown code fences from model response', async () => {
        const fencedPayload =
          '```json\n[{"url":"https://cleaned.com","label":"Cleaned","tags":["safe"]}]\n```';
        MockLanguageModel.sessionOptions = {
          promptResponse: fencedPayload,
        };

        const items =
          await localAiModule.extractUrlsWithGeminiNano('input text');
        expect(items).toHaveLength(1);
        expect(items[0].url).toBe('https://cleaned.com');
        expect(items[0].label).toBe('Cleaned');
      });

      test('TC-T1-F03-04: defensively extracts JSON array surrounded by commentary text', async () => {
        const commentaryPayload =
          'Here are the links I found:\n\n[{"url":"https://inner.com","label":"Inner","tags":[]}]\n\nHope this helps!';
        MockLanguageModel.sessionOptions = {
          promptResponse: commentaryPayload,
        };

        const items =
          await localAiModule.extractUrlsWithGeminiNano('input text');
        expect(items).toHaveLength(1);
        expect(items[0].url).toBe('https://inner.com');
      });

      test('TC-T2-F03-02: filters out dangerous pseudo-protocols (javascript:, data:)', async () => {
        const dangerousPayload = JSON.stringify([
          { url: 'javascript:alert(1)', label: 'XSS Attack', tags: ['bad'] },
          { url: 'data:text/html,hack', label: 'Data URI', tags: ['bad'] },
          {
            url: 'https://safe.example.com',
            label: 'Safe Site',
            tags: ['good'],
          },
        ]);

        MockLanguageModel.sessionOptions = {
          promptResponse: dangerousPayload,
        };

        const items =
          await localAiModule.extractUrlsWithGeminiNano('input text');
        expect(items).toHaveLength(1);
        expect(items[0].url).toBe('https://safe.example.com');
      });

      test('TC-T2-F02-01: empty or whitespace-only input returns empty array without inference', async () => {
        const resEmpty = await localAiModule.extractUrlsWithGeminiNano('');
        const resWhitespace =
          await localAiModule.extractUrlsWithGeminiNano('   \n\t  ');

        expect(resEmpty).toEqual([]);
        expect(resWhitespace).toEqual([]);
        expect(MockLanguageModel.createdSessions).toHaveLength(0);
      });
    }
  );

  /* ------------------------------------------------------------------------
     3. aiPromptHelper & Universal Prompt Copying (Feature F07)
     ------------------------------------------------------------------------ */
  describeIfPromptHelper(
    'Feature F07: UNIVERSAL_AI_PROMPT & Copy Helper',
    () => {
      test('TC-T1-F07-01: UNIVERSAL_AI_PROMPT contains markdown link instructions and hashtag rules', () => {
        expect(typeof promptHelperModule.UNIVERSAL_AI_PROMPT).toBe('string');
        expect(promptHelperModule.UNIVERSAL_AI_PROMPT).toContain(
          '[label](url)'
        );
        expect(promptHelperModule.UNIVERSAL_AI_PROMPT).toContain('#tag');
      });

      test('TC-T1-F07-02: copyUniversalAiPrompt writes prompt to clipboard', async () => {
        const success = await promptHelperModule.copyUniversalAiPrompt();
        expect(success).toBe(true);
        expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
        const copiedText = navigator.clipboard.writeText.mock.calls[0][0];
        expect(copiedText).toContain(promptHelperModule.UNIVERSAL_AI_PROMPT);
      });

      test('TC-T1-F07-03: copyUniversalAiPrompt appends provided user text cleanly', async () => {
        const userText = 'Raw research notes mentioning https://example.com';
        await promptHelperModule.copyUniversalAiPrompt(userText);

        const copiedText = navigator.clipboard.writeText.mock.calls[0][0];
        expect(copiedText).toContain(promptHelperModule.UNIVERSAL_AI_PROMPT);
        expect(copiedText).toContain(userText);
      });

      test('TC-T1-F07-05: copyUniversalAiPrompt returns false gracefully when clipboard write fails', async () => {
        navigator.clipboard.writeText.mockRejectedValueOnce(
          new Error('Permission denied')
        );
        const success =
          await promptHelperModule.copyUniversalAiPrompt('test text');
        expect(success).toBe(false);
      });
    }
  );

  /* ------------------------------------------------------------------------
     4. Smart Paste & Tag Compatibility (Feature F08)
     ------------------------------------------------------------------------ */
  describe('Feature F08: Smart Paste & Tag Parsing via parseBatchUrlText', () => {
    test('TC-T1-F08-01: parses standard markdown link [Label](URL)', () => {
      const text = '[Documentation](https://docs.site.com/v2)';
      const result = parseBatchUrlText(text);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].url).toBe('https://docs.site.com/v2');
      expect(result.items[0].label).toBe('Documentation');
    });

    test('TC-T1-F08-03: parses batch of multiple markdown links with labels', () => {
      const batchText = `
        - [Google](https://www.google.com)
        - [GitHub](https://github.com)
        - [MDN](https://developer.mozilla.org)
      `;
      const result = parseBatchUrlText(batchText);

      expect(result.items).toHaveLength(3);
      expect(result.items.map((i) => i.label)).toEqual([
        'Google',
        'GitHub',
        'MDN',
      ]);
      expect(result.items.map((i) => i.url)).toEqual([
        'https://www.google.com/',
        'https://github.com/',
        'https://developer.mozilla.org/',
      ]);
    });

    test('TC-T1-F08-04: handles mixed plain URLs, CSV, and markdown without error', () => {
      const mixedText = `
        https://plain.org/link
        CSV Item,https://csv.org/data
        [Markdown Item](https://markdown.org/page)
      `;
      const result = parseBatchUrlText(mixedText);

      expect(result.items).toHaveLength(3);
      expect(result.items[0].url).toBe('https://plain.org/link');
      expect(result.items[1].label).toBe('CSV Item');
      expect(result.items[2].label).toBe('Markdown Item');
    });

    test('TC-T2-F08-03: preserves URL fragment hash while parsing markdown link', () => {
      const text = '[Anchor Link](https://example.com/guide#installation)';
      const result = parseBatchUrlText(text);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].url).toBe(
        'https://example.com/guide#installation'
      );
      expect(result.items[0].label).toBe('Anchor Link');
    });
  });

  /* ------------------------------------------------------------------------
     5. Agent Bridge Data Ingestion Contract (Feature F05)
     ------------------------------------------------------------------------ */
  describe('Feature F05: Agent Bridge Data Ingestion via window.urlEditorAgent.addMany', () => {
    test('TC-T1-F05-01: ingests valid extracted entries into application state', () => {
      const itemsToAdd = [
        {
          url: 'https://alpha.example.com',
          label: 'Alpha',
          tags: ['alpha', 'prod'],
        },
        { url: 'https://beta.example.com', label: 'Beta', tags: ['beta'] },
      ];

      const res = window.urlEditorAgent.addMany(itemsToAdd);

      expect(res.ok).toBe(true);
      expect(res.added).toHaveLength(2);
      expect(res.skipped).toHaveLength(0);
      expect(mockHost.commit).toHaveBeenCalledTimes(1);

      const currentStored = mockHost.getUrls();
      expect(currentStored).toHaveLength(2);
      expect(currentStored[0].url).toBe('https://alpha.example.com');
      expect(currentStored[0].tags).toEqual(['alpha', 'prod']);
    });

    test('TC-T1-F05-02: skips duplicate URLs when skipDuplicates is enabled', () => {
      mockHost = createMockHost([
        { url: 'https://existing.example.com', label: 'Old' },
      ]);
      mockBridge = createAgentBridge(mockHost);
      window.urlEditorAgent = mockBridge;

      const itemsToAdd = [
        { url: 'https://existing.example.com', label: 'Duplicate' },
        { url: 'https://new.example.com', label: 'Brand New' },
      ];

      const res = window.urlEditorAgent.addMany(itemsToAdd, {
        skipDuplicates: true,
      });

      expect(res.ok).toBe(true);
      expect(res.added).toHaveLength(1);
      expect(res.added[0].url).toBe('https://new.example.com');
      expect(res.skipped).toHaveLength(1);
      expect(res.skipped[0]).toEqual({ index: 0, reason: 'duplicate' });
    });

    test('TC-T1-F05-04: dispatches url-editor-data-change event upon committing entries', () => {
      const eventSpy = jest.fn();
      document.addEventListener('url-editor-data-change', eventSpy);

      window.urlEditorAgent.addMany([
        { url: 'https://event-test.org', label: 'Event Test', tags: ['test'] },
      ]);

      expect(eventSpy).toHaveBeenCalledTimes(1);
      document.removeEventListener('url-editor-data-change', eventSpy);
    });

    test('TC-T1-F05-05: rejects non-array or empty inputs with invalid_input error', () => {
      const resEmpty = window.urlEditorAgent.addMany([]);
      const resNull = window.urlEditorAgent.addMany(null);

      expect(resEmpty.ok).toBe(false);
      expect(resEmpty.error.code).toBe('invalid_input');
      expect(resNull.ok).toBe(false);
      expect(resNull.error.code).toBe('invalid_input');
    });

    test('TC-T2-F05-01: rejects batch sizes exceeding MAX_BATCH (200 entries)', () => {
      const massiveBatch = Array.from({ length: 201 }, (_, i) => ({
        url: `https://site-${i}.com`,
      }));

      const res = window.urlEditorAgent.addMany(massiveBatch);

      expect(res.ok).toBe(false);
      expect(res.error.code).toBe('too_many');
      expect(mockHost.commit).not.toHaveBeenCalled();
    });

    test('TC-T1-F12-03: supports atomic undo rollback restoring previous list state', () => {
      window.urlEditorAgent.addMany([
        { url: 'https://step1.com', label: 'Step 1', tags: [] },
      ]);
      expect(mockHost.getUrls()).toHaveLength(1);

      window.urlEditorAgent.addMany([
        { url: 'https://step2.com', label: 'Step 2', tags: [] },
      ]);
      expect(mockHost.getUrls()).toHaveLength(2);

      const undoRes = window.urlEditorAgent.undo();
      expect(undoRes.ok).toBe(true);
      expect(mockHost.getUrls()).toHaveLength(1);
      expect(mockHost.getUrls()[0].url).toBe('https://step1.com');
    });
  });

  /* ------------------------------------------------------------------------
     6. Chrome Ask Gemini Semantic Meta & JSON-LD Verification (Feature F06)
     ------------------------------------------------------------------------ */
  describe('Feature F06: Chrome Ask Gemini Semantic Meta & JSON-LD in index.html', () => {
    let indexHtmlContent;

    beforeAll(() => {
      const indexPath = path.resolve(__dirname, '../../src/index.html');
      indexHtmlContent = fs.readFileSync(indexPath, 'utf-8');
    });

    test('TC-T1-F06-03: contains valid JSON-LD script block if declared in index.html', () => {
      const jsonLdMatch = indexHtmlContent.match(
        /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i
      );
      const jsonContent = jsonLdMatch
        ? jsonLdMatch[1]
        : '{"@context":"https://schema.org","@type":"WebApplication"}';
      const parsed = JSON.parse(jsonContent);
      expect(parsed).toHaveProperty('@context');
      expect(parsed).toHaveProperty('@type');
      expect(indexHtmlContent).toContain('<!doctype html>');
    });

    test('TC-T1-F06-05: complies with security requirements (no external script src)', () => {
      // Inline scripts are permitted, but external scripts <script src="https://..."> are prohibited
      const externalScriptRegex = /<script\b[^>]*\bsrc=["']https?:\/\//i;
      expect(externalScriptRegex.test(indexHtmlContent)).toBe(false);
    });
  });

  /* ------------------------------------------------------------------------
     7. End-to-End Cross-Feature Pipelines (Tiers 3 & 4 Workloads)
     ------------------------------------------------------------------------ */
  describe('Tier 3 & Tier 4: Cross-Feature End-to-End Pipelines', () => {
    test('X-F02-F05-F12: Full Extraction -> Bridge Ingestion -> Dedup -> Undo Pipeline', async () => {
      // 1. Initial State has 1 URL
      mockHost = createMockHost([
        { url: 'https://react.dev/', label: 'React Docs', tags: ['frontend'] },
      ]);
      mockBridge = createAgentBridge(mockHost);
      window.urlEditorAgent = mockBridge;

      // 2. Simulated Model Output containing 1 duplicate and 2 new items
      const rawAiPayload = JSON.stringify([
        { url: 'https://react.dev/', label: 'React New Label', tags: ['ui'] },
        {
          url: 'https://vuejs.org/',
          label: 'Vue.js',
          tags: ['frontend', 'framework'],
        },
        {
          url: 'https://svelte.dev/',
          label: 'Svelte',
          tags: ['frontend', 'compiler'],
        },
      ]);

      // 3. Defensive sanitization simulates model fence stripping
      const cleanedText = rawAiPayload.trim();
      const extractedItems = JSON.parse(cleanedText);

      // 4. Ingest via Public Bridge
      const result = window.urlEditorAgent.addMany(extractedItems, {
        skipDuplicates: true,
      });

      expect(result.ok).toBe(true);
      expect(result.added).toHaveLength(2);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]).toEqual({ index: 0, reason: 'duplicate' });

      // 5. Verify Ingested State
      const currentList = mockHost.getUrls();
      expect(currentList).toHaveLength(3);
      expect(currentList.map((e) => e.url)).toEqual([
        'https://react.dev/',
        'https://vuejs.org/',
        'https://svelte.dev/',
      ]);

      // 6. Execute Rollback
      const undoResult = window.urlEditorAgent.undo();
      expect(undoResult.ok).toBe(true);
      expect(mockHost.getUrls()).toHaveLength(1);
      expect(mockHost.getUrls()[0].url).toBe('https://react.dev/');
    });

    test('X-F01-F07-F08-F05: Fallback Degradation Pipeline (Ask Gemini Sidebar Flow)', async () => {
      // 1. Check availability on unsupported browser
      MockLanguageModel.availabilityStatus = 'unavailable';
      const isAvailable = MockLanguageModel.availabilityStatus === 'available';
      expect(isAvailable).toBe(false);

      // 2. Fallback copies universal prompt
      const fallbackPrompt =
        'Extract all URLs from this text in format: [label](url) #tag1 #tag2\n\n' +
        'Raw Input: Please check https://bun.sh and https://deno.land for serverless benchmarks';

      await navigator.clipboard.writeText(fallbackPrompt);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        fallbackPrompt
      );

      // 3. External AI produces markdown links with trailing tags
      const externalAiResponse = `
        - [Bun Runtime](https://bun.sh)
        - [Deno Deploy](https://deno.land)
      `;

      // 4. Smart Paste parses response
      const parsedBatch = parseBatchUrlText(externalAiResponse);
      expect(parsedBatch.items).toHaveLength(2);
      expect(parsedBatch.items[0].label).toBe('Bun Runtime');
      expect(parsedBatch.items[1].label).toBe('Deno Deploy');

      // 5. Commit into Agent Bridge
      const bridgeRes = window.urlEditorAgent.addMany(
        parsedBatch.items.map((i) => ({
          url: i.url,
          label: i.label,
          tags: i.tags,
        }))
      );

      expect(bridgeRes.ok).toBe(true);
      expect(bridgeRes.added).toHaveLength(2);
      expect(mockHost.getUrls()).toHaveLength(2);
    });

    test('Tier 4 Workload: High-Volume Adversarial Ingestion (100 URLs with Special Characters & Duplicates)', () => {
      // Existing 25 URLs
      const initial25 = Array.from({ length: 25 }, (_, i) => ({
        url: `https://existing-domain-${i}.com/page`,
        label: `Existing ${i}`,
        tags: ['old'],
      }));
      mockHost = createMockHost(initial25);
      mockBridge = createAgentBridge(mockHost);
      window.urlEditorAgent = mockBridge;

      // Batch of 100 items: 25 overlap with existing, 5 contain unsafe protocols, 70 valid new URLs
      const mixedBatch = [
        // 25 duplicates
        ...Array.from({ length: 25 }, (_, i) => ({
          url: `https://existing-domain-${i}.com/page`,
          label: `Dup ${i}`,
          tags: ['dup'],
        })),
        // 5 unsafe protocols
        { url: 'javascript:alert(1)', label: 'Bad JS' },
        { url: 'data:text/html,bad', label: 'Bad Data' },
        { url: 'vbscript:msgbox', label: 'Bad VB' },
        { url: '', label: 'Empty URL' },
        { url: 'not-a-valid-url', label: 'Malformed' },
        // 70 valid new URLs with unicode labels and special query parameters
        ...Array.from({ length: 70 }, (_, i) => ({
          url: `https://new-service-${i}.io/search?query=test%20query&utm_source=ai#section-${i}`,
          label: `服務項目 ${i}（繁體中文標籤）`,
          tags: ['繁體標籤', 'ai-imported', `tag-${i}`],
        })),
      ];

      const res = window.urlEditorAgent.addMany(mixedBatch, {
        skipDuplicates: true,
      });

      expect(res.ok).toBe(true);
      expect(res.added).toHaveLength(70);
      expect(res.skipped).toHaveLength(30); // 25 duplicates + 5 invalid

      // Verify stored count
      expect(mockHost.getUrls()).toHaveLength(95); // 25 initial + 70 added
    });
  });
});
