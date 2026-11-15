/**
 * Unit tests for Chrome Built-in AI Gemini Nano Prompt API module.
 * Tests availability checks, session lifecycle, download progress,
 * defensive output parsing, and agent bridge data ingestion.
 */

import {
  checkLocalAiAvailability,
  extractUrlsWithGeminiNano,
  parseAiResponse,
  ingestExtractedUrls,
  LOCAL_AI_SCHEMA,
  SYSTEM_PROMPT,
} from './localAiAssistant';

// Custom progress event helper
function dispatchDownloadProgress(target, loaded, total) {
  const event = new Event('downloadprogress');
  event.loaded = loaded;
  event.total = total;
  target.dispatchEvent(event);
}

function setupMockLanguageModel(options = {}) {
  const {
    availability = 'available',
    availabilityError = null,
    availabilitySyncThrow = false,
    promptResponse = JSON.stringify([
      { url: 'https://example.com', label: 'Example', tags: ['sample'] },
    ]),
    promptError = null,
    createError = null,
    onMonitor = null,
  } = options;

  const mockSession = {
    prompt: jest.fn().mockImplementation(async () => {
      if (promptError) throw promptError;
      return typeof promptResponse === 'function'
        ? promptResponse()
        : promptResponse;
    }),
    destroy: jest.fn(),
  };

  const mockCreate = jest
    .fn()
    .mockImplementation(async (createOptions = {}) => {
      if (createError) throw createError;
      if (
        createOptions.monitor &&
        typeof createOptions.monitor === 'function'
      ) {
        const monitorTarget = new EventTarget();
        createOptions.monitor(monitorTarget);
        if (onMonitor) {
          onMonitor(monitorTarget);
        }
      }
      return mockSession;
    });

  const mockAvailability = jest.fn().mockImplementation(async () => {
    if (availabilitySyncThrow) {
      throw new Error('Synchronous availability failure');
    }
    if (availabilityError) {
      return Promise.reject(availabilityError);
    }
    return availability;
  });

  const mockLM = {
    availability: mockAvailability,
    create: mockCreate,
  };

  global.LanguageModel = mockLM;
  if (typeof window !== 'undefined') {
    window.LanguageModel = mockLM;
  }

  return {
    mockLM,
    mockSession,
    mockCreate,
    mockAvailability,
  };
}

describe('localAiAssistant - Core Test Suite', () => {
  afterEach(() => {
    delete global.LanguageModel;
    if (typeof window !== 'undefined') {
      delete window.LanguageModel;
      delete window.urlEditorAgent;
    }
    jest.clearAllMocks();
  });

  // =========================================================================
  // 1. Availability Checks
  // =========================================================================
  describe('checkLocalAiAvailability', () => {
    test.each([
      ['available', 'available'],
      ['downloadable', 'downloadable'],
      ['downloading', 'downloading'],
      ['unavailable', 'unavailable'],
    ])(
      'resolves to %p when LanguageModel.availability() returns %p',
      async (state, expected) => {
        setupMockLanguageModel({ availability: state });
        const status = await checkLocalAiAvailability();
        expect(status).toBe(expected);
      }
    );

    test('returns "unavailable" when LanguageModel is undefined', async () => {
      delete global.LanguageModel;
      if (typeof window !== 'undefined') {
        delete window.LanguageModel;
      }
      const status = await checkLocalAiAvailability();
      expect(status).toBe('unavailable');
    });

    test('returns "unavailable" when LanguageModel.availability is not a function', async () => {
      global.LanguageModel = {};
      const status = await checkLocalAiAvailability();
      expect(status).toBe('unavailable');
    });

    test('returns "unavailable" when LanguageModel.availability() rejects', async () => {
      setupMockLanguageModel({
        availabilityError: new Error('Model crashed'),
      });
      const status = await checkLocalAiAvailability();
      expect(status).toBe('unavailable');
    });

    test('returns "unavailable" when LanguageModel.availability() throws synchronously', async () => {
      setupMockLanguageModel({ availabilitySyncThrow: true });
      const status = await checkLocalAiAvailability();
      expect(status).toBe('unavailable');
    });

    test('returns "unavailable" when accessing LanguageModel getter throws (security sandbox)', async () => {
      Object.defineProperty(global, 'LanguageModel', {
        get() {
          throw new Error('Access denied to LanguageModel');
        },
        configurable: true,
      });
      if (typeof window !== 'undefined') {
        Object.defineProperty(window, 'LanguageModel', {
          get() {
            throw new Error('Access denied to LanguageModel');
          },
          configurable: true,
        });
      }

      const status = await checkLocalAiAvailability();
      expect(status).toBe('unavailable');
    });
  });

  // =========================================================================
  // 2. Session Creation & Prompt Execution
  // =========================================================================
  describe('extractUrlsWithGeminiNano - Session & Prompting', () => {
    test('throws LOCAL_AI_UNAVAILABLE error when status is unavailable', async () => {
      const { mockCreate } = setupMockLanguageModel({
        availability: 'unavailable',
      });

      await expect(
        extractUrlsWithGeminiNano('some input text')
      ).rejects.toThrow(/LOCAL_AI_UNAVAILABLE|unavailable/i);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    test('passes system initialPrompts to create and responseConstraint (JSON Schema) to prompt', async () => {
      const { mockCreate, mockSession } = setupMockLanguageModel({
        availability: 'available',
      });

      await extractUrlsWithGeminiNano('Extract https://example.com');

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const createOptions = mockCreate.mock.calls[0][0];

      expect(createOptions).toBeDefined();
      expect(createOptions.initialPrompts).toEqual([
        { role: 'system', content: SYSTEM_PROMPT },
      ]);
      expect(SYSTEM_PROMPT.length).toBeGreaterThan(10);
      // Stable Prompt API: constraint belongs to prompt(), not create().
      expect(createOptions.systemPrompt).toBeUndefined();
      expect(createOptions.responseConstraint).toBeUndefined();

      const promptOptions = mockSession.prompt.mock.calls[0][1];
      expect(promptOptions.responseConstraint.type).toBe('array');
      expect(promptOptions.responseConstraint.items.properties).toHaveProperty(
        'url'
      );
      expect(promptOptions.responseConstraint.items.properties).toHaveProperty(
        'label'
      );
      expect(promptOptions.responseConstraint.items.properties).toHaveProperty(
        'tags'
      );
      expect(LOCAL_AI_SCHEMA).toEqual(promptOptions.responseConstraint);
    });

    test('passes raw input text to session.prompt', async () => {
      const { mockSession } = setupMockLanguageModel({
        availability: 'available',
      });

      const rawInput =
        'Here are my bookmarks: https://vite.dev and https://react.dev';
      await extractUrlsWithGeminiNano(rawInput);

      expect(mockSession.prompt).toHaveBeenCalledTimes(1);
      expect(mockSession.prompt).toHaveBeenCalledWith(
        rawInput,
        expect.objectContaining({ responseConstraint: LOCAL_AI_SCHEMA })
      );
    });
  });

  // =========================================================================
  // 3. Download Progress Monitoring
  // =========================================================================
  describe('extractUrlsWithGeminiNano - Download Progress Monitoring', () => {
    test('attaches monitor and dispatches progress updates to onDownloadProgress', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const progressHistory = [];
      const onProgress = jest.fn((p) => progressHistory.push(p));

      // Trigger extraction with progress callback
      const extractionPromise = extractUrlsWithGeminiNano(
        'raw input',
        onProgress
      );

      // Wait for availability check microtask queue to reach LM.create
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Simulate download progress events
      expect(monitorTarget).toBeDefined();
      dispatchDownloadProgress(monitorTarget, 250, 1000);
      dispatchDownloadProgress(monitorTarget, 750, 1000);
      dispatchDownloadProgress(monitorTarget, 1000, 1000);

      await extractionPromise;

      expect(onProgress).toHaveBeenCalled();
      expect(progressHistory).toContainEqual(
        expect.objectContaining({ loaded: 250, total: 1000, percent: 25 })
      );
      expect(progressHistory).toContainEqual(
        expect.objectContaining({ loaded: 1000, total: 1000, percent: 100 })
      );
    });

    test('handles division by zero and fractional progress safely without NaN', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const progressHistory = [];
      const onProgress = jest.fn((p) => progressHistory.push(p));

      const extractionPromise = extractUrlsWithGeminiNano(
        'raw input',
        onProgress
      );

      // Wait for availability check microtask queue to reach LM.create
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Edge case 1: total = 0
      dispatchDownloadProgress(monitorTarget, 0, 0);
      // Edge case 2: fractional loaded = 0.65, total = 1
      dispatchDownloadProgress(monitorTarget, 0.65, 1);

      await extractionPromise;

      expect(progressHistory[0].percent).toBe(0);
      expect(Number.isNaN(progressHistory[0].percent)).toBe(false);
      expect(progressHistory[1].percent).toBe(65);
    });

    test('functions properly when onDownloadProgress is omitted', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const extractionPromise = extractUrlsWithGeminiNano('raw input');

      // Wait for availability check microtask queue to reach LM.create
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      dispatchDownloadProgress(monitorTarget, 500, 1000);
      const results = await extractionPromise;

      expect(results).toBeInstanceOf(Array);
      expect(results).toHaveLength(1);
    });

    test('handles corrupt progress event with loaded: NaN safely without emitting NaN', async () => {
      let monitorTarget;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorTarget = target;
        },
      });

      const progressHistory = [];
      const onProgress = jest.fn((p) => progressHistory.push(p));

      const extractionPromise = extractUrlsWithGeminiNano('input', onProgress);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // Dispatch corrupt event with loaded = NaN, total = 100
      const event = new Event('downloadprogress');
      event.loaded = NaN;
      event.total = 100;
      monitorTarget.dispatchEvent(event);

      await extractionPromise;

      expect(onProgress).toHaveBeenCalledTimes(1);
      const report = progressHistory[0];
      expect(Number.isNaN(report.percent)).toBe(false);
      expect(Number.isFinite(report.percent)).toBe(true);
      expect(report.percent).toBe(0);
      expect(report.loaded).toBe(0);
    });

    test('extractUrlsWithGeminiNano succeeds even if monitorTarget.addEventListener throws synchronously', async () => {
      let monitorCalled = false;
      setupMockLanguageModel({
        availability: 'downloadable',
        onMonitor: (target) => {
          monitorCalled = true;
          target.addEventListener = () => {
            throw new Error('Blocked by sandbox security policy');
          };
        },
      });

      const onProgress = jest.fn();
      const results = await extractUrlsWithGeminiNano('some text', onProgress);
      expect(results).toHaveLength(1);
      expect(monitorCalled).toBe(true);
      expect(onProgress).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. Defensive Parsing & Sanitization
  // =========================================================================
  describe('extractUrlsWithGeminiNano & parseAiResponse - Parsing & Sanitization', () => {
    test('parses clean JSON array output', async () => {
      const jsonOutput = JSON.stringify([
        { url: 'https://example.com/a', label: 'Example A', tags: ['alpha'] },
      ]);
      setupMockLanguageModel({ promptResponse: jsonOutput });

      const items = await extractUrlsWithGeminiNano('text');
      expect(items).toEqual([
        { url: 'https://example.com/a', label: 'Example A', tags: ['alpha'] },
      ]);
    });

    test('strips markdown code fences (```json ... ```)', async () => {
      const fencedOutput =
        '```json\n[\n  {"url": "https://developer.mozilla.org", "label": "MDN", "tags": ["docs"]}\n]\n```';
      setupMockLanguageModel({ promptResponse: fencedOutput });

      const items = await extractUrlsWithGeminiNano('text');
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({
        url: 'https://developer.mozilla.org',
        label: 'MDN',
        tags: ['docs'],
      });
    });

    test('strips plain markdown code fences without language tag (``` ... ```)', async () => {
      const fencedOutput =
        '```\n[\n  {"url": "https://vite.dev", "label": "Vite", "tags": ["bundler"]}\n]\n```';
      setupMockLanguageModel({ promptResponse: fencedOutput });

      const items = await extractUrlsWithGeminiNano('text');
      expect(items).toEqual([
        { url: 'https://vite.dev', label: 'Vite', tags: ['bundler'] },
      ]);
    });

    test('extracts JSON array when surrounded by conversational prefix and suffix text', async () => {
      const textOutput =
        'Sure! Here are the extracted URLs:\n\n' +
        '[{"url": "https://react.dev", "label": "React", "tags": ["frontend"]}]\n\n' +
        'Let me know if you need more help!';
      setupMockLanguageModel({ promptResponse: textOutput });

      const items = await extractUrlsWithGeminiNano('text');
      expect(items).toEqual([
        { url: 'https://react.dev', label: 'React', tags: ['frontend'] },
      ]);
    });

    test('filters out dangerous protocols such as javascript:, data:, and file:', async () => {
      const mixedOutput = JSON.stringify([
        { url: 'javascript:alert(1)', label: 'XSS Attack', tags: ['exploit'] },
        { url: 'https://safe.example.com', label: 'Safe', tags: ['prod'] },
        {
          url: 'data:text/html,<script>alert(1)</script>',
          label: 'Data URI',
          tags: ['exploit'],
        },
        { url: 'file:///etc/passwd', label: 'Local File', tags: ['leak'] },
        { url: 'not-a-valid-url', label: 'Invalid', tags: ['junk'] },
      ]);
      setupMockLanguageModel({ promptResponse: mixedOutput });

      const items = await extractUrlsWithGeminiNano('text');
      expect(items).toHaveLength(1);
      expect(items[0].url).toBe('https://safe.example.com');
    });

    test('auto-fills suggested label and tags when omitted or empty', async () => {
      const missingFields = JSON.stringify([
        { url: 'https://github.com/facebook/react', label: '', tags: [] },
      ]);
      setupMockLanguageModel({ promptResponse: missingFields });

      const items = await extractUrlsWithGeminiNano('text');
      expect(items).toHaveLength(1);
      expect(items[0].label).toBeTruthy();
      expect(items[0].tags).toBeInstanceOf(Array);
      expect(items[0].tags.length).toBeGreaterThan(0);
      expect(items[0].tags).toContain('github');
    });

    test('throws a descriptive error when output contains no parseable JSON array', async () => {
      setupMockLanguageModel({
        promptResponse: 'Sorry, I found no URLs in this text.',
      });

      await expect(extractUrlsWithGeminiNano('text')).rejects.toThrow(
        /PARSE_ERROR|invalid json|no valid array/i
      );
    });

    test('parseAiResponse accepts NDJSON / comma-separated objects without an array', () => {
      const ndjson =
        '{"url":"https://developer.mozilla.org/","label":"MDN","tags":["docs"]}\n' +
        '{"url":"https://github.com/","label":"GitHub","tags":[]}';
      const spaced =
        '{"url":"https://a.com/","label":"A","tags":[]}, {"url":"https://b.com/","label":"B {x}","tags":[]}';

      expect(parseAiResponse(ndjson).map((i) => i.url)).toEqual([
        'https://developer.mozilla.org/',
        'https://github.com/',
      ]);
      expect(parseAiResponse(spaced)).toHaveLength(2);
    });

    test('parseAiResponse directly handles structured output and throws on invalid content', () => {
      const valid = JSON.stringify([
        { url: 'https://example.com', label: 'Ex', tags: ['t'] },
      ]);
      const res = parseAiResponse(valid);
      expect(res).toHaveLength(1);
      expect(res[0].url).toBe('https://example.com');

      expect(() => parseAiResponse('')).toThrow(/PARSE_ERROR/i);
      expect(() => parseAiResponse('not json')).toThrow(/PARSE_ERROR/i);
    });

    test('correctly parses single JSON object with tags array preserving URL and metadata', () => {
      const singleObjPayload = JSON.stringify({
        url: 'https://single.example.com',
        label: 'Single Entry',
        tags: ['one'],
      });

      const results = parseAiResponse(singleObjPayload);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        url: 'https://single.example.com',
        label: 'Single Entry',
        tags: ['one'],
      });
    });

    test('correctly strips nested markdown code fences and ignores preceding non-JSON code blocks', () => {
      // Case A: Nested markdown fences
      const nestedFences =
        '```json\n```json\n[{"url": "https://nested.example.com", "label": "Nested", "tags": ["fence"]}]\n```\n```';
      const nestedResult = parseAiResponse(nestedFences);
      expect(nestedResult).toHaveLength(1);
      expect(nestedResult[0].url).toBe('https://nested.example.com');

      // Case B: Preceding commentary code block (e.g. curl / bash command)
      const precedingNonJson =
        'Here is how you fetch the page:\n' +
        '```sh\ncurl -s https://api.example.com/items\n```\n' +
        'And here is the extracted JSON array:\n' +
        '```json\n[{"url": "https://actual.example.com", "label": "Actual Item", "tags": ["api"]}]\n```';
      const precedingResult = parseAiResponse(precedingNonJson);
      expect(precedingResult).toHaveLength(1);
      expect(precedingResult[0].url).toBe('https://actual.example.com');
      expect(precedingResult[0].label).toBe('Actual Item');
    });

    test('does not allow conversational markdown links or footnote brackets to break JSON array extraction', () => {
      const conversationalText =
        'I found several links like [MDN Documentation](https://developer.mozilla.org) in the article.\n' +
        'Here is the structured JSON:\n' +
        '[{"url": "https://actual.example.com", "label": "Actual Page", "tags": ["docs"]}]\n' +
        'For more details, see reference [1] and [Appendix A].';

      const results = parseAiResponse(conversationalText);
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        url: 'https://actual.example.com',
        label: 'Actual Page',
        tags: ['docs'],
      });
    });

    test('preserves all items in multi-item JSON array surrounded by conversational text, markdown links, and footnotes', () => {
      const conversationalMultiItem =
        'I analyzed your text and extracted several reference links like [Developer Guide](https://example.com/guide).\n' +
        'Here are the structured URLs I discovered:\n' +
        '[\n' +
        '  {"url": "https://item1.example.com", "label": "Item 1", "tags": ["one", "first"]},\n' +
        '  {"url": "https://item2.example.com", "label": "Item 2", "tags": ["two"]},\n' +
        '  {"url": "https://item3.example.com", "label": "Item 3", "tags": ["three", "sample"]}\n' +
        ']\n' +
        'For additional context, please refer to citations [1] and [Appendix B].\n' +
        'Let me know if you would like me to process additional sources!';

      const results = parseAiResponse(conversationalMultiItem);
      expect(results).toHaveLength(3);
      expect(results).toEqual([
        {
          url: 'https://item1.example.com',
          label: 'Item 1',
          tags: ['one', 'first'],
        },
        { url: 'https://item2.example.com', label: 'Item 2', tags: ['two'] },
        {
          url: 'https://item3.example.com',
          label: 'Item 3',
          tags: ['three', 'sample'],
        },
      ]);
    });
  });

  // =========================================================================
  // 5. Guaranteed session.destroy() Resource Cleanup
  // =========================================================================
  describe('extractUrlsWithGeminiNano - Session Lifecycle & Destruction', () => {
    test('calls session.destroy() on normal successful prompt execution', async () => {
      const { mockSession } = setupMockLanguageModel({
        promptResponse: JSON.stringify([
          { url: 'https://example.com', label: 'Example', tags: ['sample'] },
        ]),
      });

      await extractUrlsWithGeminiNano('text');
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
    });

    test('calls session.destroy() when session.prompt() rejects', async () => {
      const { mockSession } = setupMockLanguageModel({
        promptError: new Error('Token context limit exceeded'),
      });

      await expect(extractUrlsWithGeminiNano('text')).rejects.toThrow(
        'Token context limit exceeded'
      );
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
    });

    test('calls session.destroy() when JSON parsing of prompt output fails', async () => {
      const { mockSession } = setupMockLanguageModel({
        promptResponse: 'Unparseable output { [ }',
      });

      await expect(extractUrlsWithGeminiNano('text')).rejects.toThrow();
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);
    });

    test('does not attempt session.destroy() when LanguageModel.create() rejects', async () => {
      const { mockSession } = setupMockLanguageModel({
        createError: new Error('Failed to initialize session'),
      });

      await expect(extractUrlsWithGeminiNano('text')).rejects.toThrow(
        'Failed to initialize session'
      );
      expect(mockSession.destroy).not.toHaveBeenCalled();
    });

    test('aborts prompt and calls session.destroy() when AbortSignal is triggered', async () => {
      let resolvePrompt;
      const hungPrompt = new Promise((resolve) => {
        resolvePrompt = resolve;
      });

      const { mockSession } = setupMockLanguageModel({
        promptResponse: () => hungPrompt,
      });

      const controller = new AbortController();
      const extractionPromise = extractUrlsWithGeminiNano('text', null, {
        signal: controller.signal,
      });

      controller.abort();

      await expect(extractionPromise).rejects.toThrow(/aborted/i);
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);

      resolvePrompt('[]');
    });

    test('times out and destroys session when timeoutMs is exceeded', async () => {
      let resolvePrompt;
      const hungPrompt = new Promise((resolve) => {
        resolvePrompt = resolve;
      });

      const { mockSession } = setupMockLanguageModel({
        promptResponse: () => hungPrompt,
      });

      const extractionPromise = extractUrlsWithGeminiNano('text', null, {
        timeoutMs: 15,
      });

      await expect(extractionPromise).rejects.toThrow(/PROMPT_TIMEOUT/i);
      expect(mockSession.destroy).toHaveBeenCalledTimes(1);

      resolvePrompt('[]');
    });
  });

  // =========================================================================
  // 6. Agent Bridge Integration (window.urlEditorAgent.addMany)
  // =========================================================================
  describe('ingestExtractedUrls - Agent Bridge Integration', () => {
    test('passes extracted items to window.urlEditorAgent.addMany with skipDuplicates: true', async () => {
      const mockBridge = {
        addMany: jest.fn().mockReturnValue({
          ok: true,
          added: [
            {
              id: 'url-1',
              url: 'https://example.com',
              label: 'Example',
              tags: ['ai'],
            },
          ],
          skipped: [],
        }),
      };
      window.urlEditorAgent = mockBridge;

      const items = [
        { url: 'https://example.com', label: 'Example', tags: ['ai'] },
      ];
      const result = await ingestExtractedUrls(items);

      expect(mockBridge.addMany).toHaveBeenCalledTimes(1);
      expect(mockBridge.addMany).toHaveBeenCalledWith(items, {
        skipDuplicates: true,
      });
      expect(result.ok).toBe(true);
      expect(result.added).toHaveLength(1);
    });

    test('handles skipped duplicates reported by agentBridge', async () => {
      const mockBridge = {
        addMany: jest.fn().mockReturnValue({
          ok: true,
          added: [],
          skipped: [{ index: 0, reason: 'duplicate' }],
        }),
      };
      window.urlEditorAgent = mockBridge;

      const items = [
        { url: 'https://example.com', label: 'Example', tags: ['ai'] },
      ];
      const result = await ingestExtractedUrls(items);

      expect(result.ok).toBe(true);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].reason).toBe('duplicate');
    });

    test('throws or returns an error when window.urlEditorAgent is unavailable', async () => {
      delete window.urlEditorAgent;
      const items = [
        { url: 'https://example.com', label: 'Example', tags: ['ai'] },
      ];

      await expect(ingestExtractedUrls(items)).rejects.toThrow(
        /AGENT_BRIDGE_NOT_AVAILABLE|Agent bridge unavailable/i
      );
    });

    test('chunks payloads exceeding 200 items into multiple addMany calls and aggregates results', async () => {
      const totalItems = 450; // Requires 3 chunks: 200, 200, 50
      const mockItems = Array.from({ length: totalItems }, (_, i) => ({
        url: `https://item-${i}.example.com`,
        label: `Item ${i}`,
        tags: ['bulk'],
      }));

      const callChunks = [];
      const mockBridge = {
        addMany: jest.fn().mockImplementation((chunk, options) => {
          callChunks.push({ size: chunk.length, options });
          return {
            ok: true,
            added: chunk.map((item, idx) => ({
              id: `id-${idx}`,
              url: item.url,
              label: item.label,
              tags: item.tags,
            })),
            skipped: [],
          };
        }),
      };
      window.urlEditorAgent = mockBridge;

      const result = await ingestExtractedUrls(mockItems);

      expect(mockBridge.addMany).toHaveBeenCalledTimes(3);
      expect(callChunks[0].size).toBe(200);
      expect(callChunks[1].size).toBe(200);
      expect(callChunks[2].size).toBe(50);
      expect(callChunks[0].options).toEqual({ skipDuplicates: true });

      expect(result.ok).toBe(true);
      expect(result.added).toHaveLength(450);
      expect(result.skipped).toEqual([]);
    });

    test('correctly offsets skipped indices across multiple chunks during large ingestion', async () => {
      const totalItems = 250; // Chunk 1: 200 items, Chunk 2: 50 items
      const mockItems = Array.from({ length: totalItems }, (_, i) => ({
        url: `https://item-${i}.example.com`,
        label: `Item ${i}`,
        tags: ['chunk'],
      }));

      const mockBridge = {
        addMany: jest.fn().mockImplementation((chunk) => {
          if (chunk.length === 200) {
            return {
              ok: true,
              added: chunk.slice(1),
              skipped: [{ index: 5, reason: 'duplicate' }],
            };
          } else {
            return {
              ok: true,
              added: chunk.slice(1),
              skipped: [{ index: 10, reason: 'duplicate' }],
            };
          }
        }),
      };
      window.urlEditorAgent = mockBridge;

      const result = await ingestExtractedUrls(mockItems);
      expect(result.ok).toBe(true);
      expect(result.skipped).toHaveLength(2);
      expect(result.skipped[0]).toEqual({ index: 5, reason: 'duplicate' });
      expect(result.skipped[1]).toEqual({ index: 210, reason: 'duplicate' }); // 200 + 10
    });
  });
});
