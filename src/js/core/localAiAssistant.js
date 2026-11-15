/* global LanguageModel */
/**
 * @file localAiAssistant.js
 * Chrome Built-in AI (Gemini Nano Prompt API) core assistant.
 * Handles availability inspection, model download progress monitoring,
 * constrained JSON schema prompting, defensive output sanitization,
 * session lifecycle memory management, and data ingestion via agentBridge.
 */

import {
  isSafeUrl,
  generateSuggestedLabel,
  generateSuggestedTags,
} from './urlParser.js';

export const LOCAL_AI_ERROR_CODE = 'unavailable';
export const MAX_INGESTION_BATCH = 200;

/**
 * Standard JSON Schema constraint for Gemini Nano structured output.
 */
export const LOCAL_AI_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      label: { type: 'string' },
      tags: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['url', 'label', 'tags'],
  },
};

export const URL_EXTRACTION_SCHEMA = LOCAL_AI_SCHEMA;

/**
 * System prompt guiding on-device Gemini Nano to extract URLs with metadata.
 */
export const SYSTEM_PROMPT = `You are a URL extraction assistant.
Extract all valid HTTP and HTTPS URLs from the provided text.
For each URL found, provide:
- "url": The complete, valid URL string (must start with http:// or https://).
- "label": A concise, descriptive human-readable label or title for the page or service.
- "tags": An array of 1 to 3 relevant lowercase category/service tags (e.g., ["tools", "api", "docs"]).
Output MUST strictly conform to the provided JSON Schema array format.
Do not include any additional commentary or markdown wrappers outside the JSON array.`;

/**
 * Resolves the global LanguageModel object across browser, node, and test environments.
 * Safely wraps property lookups in try/catch to protect against security restrictions
 * or throwing property getters in restricted sandboxes.
 * @returns {object|undefined}
 */
export function getLanguageModelGlobal() {
  try {
    if (typeof window !== 'undefined' && window.LanguageModel) {
      return window.LanguageModel;
    }
  } catch {
    // Suppress security restriction exceptions
  }

  try {
    if (typeof globalThis !== 'undefined' && globalThis.LanguageModel) {
      return globalThis.LanguageModel;
    }
  } catch {
    // Suppress security restriction exceptions
  }

  try {
    if (typeof LanguageModel !== 'undefined' && LanguageModel) {
      return LanguageModel;
    }
  } catch {
    // Suppress ReferenceError or security restriction exceptions
  }

  return undefined;
}

/**
 * Inspects local Gemini Nano model availability on the user's device.
 * @returns {Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>}
 */
export async function checkLocalAiAvailability() {
  let LM;
  try {
    LM = getLanguageModelGlobal();
  } catch {
    return 'unavailable';
  }

  if (!LM || typeof LM.availability !== 'function') {
    return 'unavailable';
  }

  try {
    const rawStatus = await LM.availability();
    const normalized =
      typeof rawStatus === 'string' ? rawStatus.toLowerCase().trim() : '';

    switch (normalized) {
      case 'available':
      case 'readily':
        return 'available';
      case 'downloadable':
      case 'after-download':
        return 'downloadable';
      case 'downloading':
        return 'downloading';
      case 'unavailable':
      case 'no':
      default:
        return 'unavailable';
    }
  } catch {
    return 'unavailable';
  }
}

/**
 * Normalizes diverse parsed JSON outputs into an array of candidate URL items.
 * Handles arrays, single objects with .url, and wrapper objects ({ urls, items, data }).
 * @param {unknown} parsed
 * @returns {Array<object>|null}
 */
export function normalizeParsedAiOutput(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === 'object') {
    if (typeof parsed.url === 'string' && parsed.url.trim()) {
      return [parsed];
    }
    if (Array.isArray(parsed.urls)) {
      return parsed.urls;
    }
    if (Array.isArray(parsed.items)) {
      return parsed.items;
    }
    if (Array.isArray(parsed.data)) {
      return parsed.data;
    }
  }
  return null;
}

/**
 * Validates, filters, deduplicates, and sanitizes an array of raw URL items.
 * @param {Array<object>} rawItems
 * @returns {Array<{ url: string, label: string, tags: string[] }>}
 */
export function sanitizeExtractedItems(rawItems) {
  const results = [];
  const seenUrls = new Set();

  for (const item of rawItems) {
    if (!item || typeof item !== 'object') continue;

    const rawUrl = typeof item.url === 'string' ? item.url.trim() : '';
    if (!rawUrl) continue;

    // Protocol & security validation: only http: and https: are allowed
    if (!isSafeUrl(rawUrl, new Set(['http:', 'https:']))) continue;

    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      continue;
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      continue;
    }

    if (seenUrls.has(rawUrl)) continue;
    seenUrls.add(rawUrl);

    // Label fallback
    let label = typeof item.label === 'string' ? item.label.trim() : '';
    if (!label) {
      label = generateSuggestedLabel(parsedUrl);
    }

    // Tags fallback
    let tags = [];
    if (Array.isArray(item.tags)) {
      tags = item.tags
        .filter((t) => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().toLowerCase());
    }
    if (tags.length === 0) {
      tags = generateSuggestedTags(parsedUrl);
    }
    // Deduplicate and cap tags to 5
    tags = Array.from(new Set(tags)).slice(0, 5);

    results.push({
      url: rawUrl,
      label,
      tags,
    });
  }

  return results;
}

/**
 * Unwraps outer and nested Markdown code fences (e.g. ```json ... ``` or nested ```...```).
 * @param {string} str
 * @returns {string}
 */
export function unwrapCodeFences(str) {
  let s = str.trim();
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;
    const match = s.match(/^(`{3,}|~{3,})[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*\1$/);
    if (match) {
      s = match[2].trim();
      changed = true;
    }
  }
  return s;
}

/**
 * Extracts distinct code fence blocks from conversational text.
 * Requires closing fence to be on its own line without an info string.
 * @param {string} text
 * @returns {Array<{ fence: string, lang: string, body: string }>}
 */
export function extractFenceBlocks(text) {
  const blocks = [];
  const fenceRegex =
    /(?:^|\n)(`{3,}|~{3,})([a-zA-Z0-9_-]*)[^\n]*\n([\s\S]*?)\n\s*\1\s*(?=\n|$)/g;
  let match;
  while ((match = fenceRegex.exec(text)) !== null) {
    blocks.push({
      fence: match[1],
      lang: (match[2] || '').toLowerCase().trim(),
      body: match[3].trim(),
    });
  }
  return blocks;
}

/**
 * Robustly locates and extracts balanced JSON arrays or objects from text containing
 * markdown links, footnotes, or conversational commentary.
 * Handles nested brackets and escaped strings safely without regex backtracking.
 * @param {string} text
 * @returns {any|null}
 */
export function extractBalancedJson(text) {
  const startPattern = /(\[\s*[{[])|(\{\s*"(?:url|label|tags)")/g;
  let match;
  while ((match = startPattern.exec(text)) !== null) {
    const startIndex = match.index;
    const stack = [];
    let inString = false;
    let escape = false;

    for (let i = startIndex; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === '[') {
          stack.push(']');
        } else if (ch === '{') {
          stack.push('}');
        } else if (ch === ']' || ch === '}') {
          if (stack.length === 0 || stack[stack.length - 1] !== ch) {
            break;
          }
          stack.pop();
          if (stack.length === 0) {
            const candidate = text.slice(startIndex, i + 1);
            try {
              return JSON.parse(candidate);
            } catch {
              break;
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Collects every top-level balanced {...} object in free text (string-aware).
 * Handles models that emit NDJSON or comma/space separated objects without
 * an enclosing array.
 * @param {string} text
 * @returns {Array<object>}
 */
export function extractJsonObjects(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"' && depth > 0) {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1));
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            out.push(obj);
          }
        } catch {
          // skip malformed fragment
        }
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Defensively extracts and parses a structured JSON array or object from raw model output.
 * Protects against single-object tag slicing, nested code fences, preceding commentary blocks,
 * and conversational markdown links/citations.
 * @param {string} rawOutput
 * @returns {Array<{ url: string, label: string, tags: string[] }>}
 * @throws {Error} if output contains no parseable JSON array or object
 */
export function parseAiResponse(rawOutput) {
  if (!rawOutput) {
    throw new Error('PARSE_ERROR: Empty output from local AI');
  }

  let text =
    typeof rawOutput === 'string' ? rawOutput.trim() : String(rawOutput).trim();
  if (!text) {
    throw new Error('PARSE_ERROR: Empty output from local AI');
  }

  let lastSyntaxError = null;

  // Stage 1: Fast Path — Direct JSON parse on trimmed raw text
  try {
    const direct = JSON.parse(text);
    const normalized = normalizeParsedAiOutput(direct);
    if (normalized !== null) {
      return sanitizeExtractedItems(normalized);
    }
  } catch (err) {
    // Preserve RangeError (call stack overflow) immediately
    if (err instanceof RangeError || err.name === 'RangeError') {
      throw new Error(`PARSE_ERROR: Invalid JSON - ${err.message}`);
    }
    lastSyntaxError = err;
  }

  // Stage 2: Direct JSON parse on fully unwrapped code fences
  const fullyUnwrapped = unwrapCodeFences(text);
  if (fullyUnwrapped !== text) {
    try {
      const parsed = JSON.parse(fullyUnwrapped);
      const normalized = normalizeParsedAiOutput(parsed);
      if (normalized !== null) {
        return sanitizeExtractedItems(normalized);
      }
    } catch (err) {
      if (err instanceof RangeError || err.name === 'RangeError') {
        throw new Error(`PARSE_ERROR: Invalid JSON - ${err.message}`);
      }
      lastSyntaxError = err;
    }
  }

  // Stage 3: Inspect individual code fence blocks (prioritizing 'json' tagged blocks)
  const blocks = extractFenceBlocks(text);
  if (blocks.length > 0) {
    blocks.sort((a, b) => {
      if (a.lang === 'json' && b.lang !== 'json') return -1;
      if (b.lang === 'json' && a.lang !== 'json') return 1;
      return 0;
    });

    for (const b of blocks) {
      const cleaned = unwrapCodeFences(b.body);
      try {
        const parsed = JSON.parse(cleaned);
        const normalized = normalizeParsedAiOutput(parsed);
        if (normalized !== null) {
          return sanitizeExtractedItems(normalized);
        }
      } catch (err) {
        if (err instanceof RangeError || err.name === 'RangeError') {
          throw new Error(`PARSE_ERROR: Invalid JSON - ${err.message}`);
        }
        lastSyntaxError = err;
      }

      const balanced = extractBalancedJson(cleaned);
      if (balanced !== null) {
        const normalized = normalizeParsedAiOutput(balanced);
        if (normalized !== null) {
          return sanitizeExtractedItems(normalized);
        }
      }
    }
  }

  // Stage 3b: several top-level objects with no enclosing array (NDJSON etc.)
  const looseObjects = extractJsonObjects(fullyUnwrapped).filter(
    (o) => typeof o.url === 'string'
  );
  if (looseObjects.length > 1) {
    return sanitizeExtractedItems(looseObjects);
  }

  // Stage 4: Balanced bracket search in full text and unwrapped text
  for (const candidate of [fullyUnwrapped, text]) {
    const balanced = extractBalancedJson(candidate);
    if (balanced !== null) {
      const normalized = normalizeParsedAiOutput(balanced);
      if (normalized !== null) {
        return sanitizeExtractedItems(normalized);
      }
    }
  }

  // Stage 5: Fallback bracket slice [ ... ] with JSON.parse error preservation
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    const sliced = text.slice(firstBracket, lastBracket + 1);
    try {
      const parsed = JSON.parse(sliced);
      const normalized = normalizeParsedAiOutput(parsed);
      if (normalized !== null) {
        return sanitizeExtractedItems(normalized);
      }
    } catch (err) {
      if (err instanceof RangeError || err.name === 'RangeError') {
        throw new Error(`PARSE_ERROR: Invalid JSON - ${err.message}`);
      }
      throw new Error(`PARSE_ERROR: Invalid JSON - ${err.message}`);
    }
  }

  throw new Error(
    `PARSE_ERROR: Invalid JSON - ${
      lastSyntaxError
        ? lastSyntaxError.message
        : 'No valid JSON array or object found in AI output'
    }`
  );
}

export const parseAndSanitizeAiOutput = parseAiResponse;

/**
 * Extracts URLs and metadata from unstructured text using Chrome's on-device Gemini Nano.
 * @param {string} rawText
 * @param {((progress: { loaded: number, total: number, percent: number }) => void) | { onDownloadProgress?: (progress: { loaded: number, total: number, percent: number }) => void, signal?: AbortSignal, timeoutMs?: number }} [onDownloadProgress]
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<Array<{ url: string, label: string, tags: string[] }>>}
 */
export async function extractUrlsWithGeminiNano(
  rawText,
  onDownloadProgress,
  options = {}
) {
  let progressCallback =
    typeof onDownloadProgress === 'function' ? onDownloadProgress : undefined;
  let opts = options;
  if (
    onDownloadProgress &&
    typeof onDownloadProgress === 'object' &&
    typeof onDownloadProgress !== 'function'
  ) {
    opts = onDownloadProgress;
    progressCallback =
      typeof opts.onDownloadProgress === 'function'
        ? opts.onDownloadProgress
        : undefined;
  }

  const signal = opts?.signal;
  const timeoutMs =
    typeof opts?.timeoutMs === 'number' && opts.timeoutMs > 0
      ? opts.timeoutMs
      : 0;

  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }

  const availability = await checkLocalAiAvailability();
  if (availability === 'unavailable') {
    const error = new Error('LOCAL_AI_UNAVAILABLE');
    error.code = LOCAL_AI_ERROR_CODE;
    throw error;
  }

  if (typeof rawText !== 'string' || !rawText.trim()) {
    return [];
  }

  let LM;
  try {
    LM = getLanguageModelGlobal();
  } catch {
    LM = null;
  }

  if (!LM || typeof LM.create !== 'function') {
    const error = new Error('LOCAL_AI_UNAVAILABLE');
    error.code = LOCAL_AI_ERROR_CODE;
    throw error;
  }

  let session = null;

  try {
    const createOptions = {
      initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      ...(signal ? { signal } : {}),
      monitor: (monitorTarget) => {
        try {
          if (
            typeof progressCallback === 'function' &&
            monitorTarget &&
            typeof monitorTarget.addEventListener === 'function'
          ) {
            monitorTarget.addEventListener('downloadprogress', (event) => {
              const loaded = Number.isFinite(event?.loaded) ? event.loaded : 0;
              const total = Number.isFinite(event?.total) ? event.total : 0;

              let percent = 0;
              if (total > 0) {
                percent = Math.min(
                  100,
                  Math.max(0, Math.round((loaded / total) * 100))
                );
              } else if (loaded > 0 && loaded <= 1) {
                percent = Math.min(100, Math.max(0, Math.round(loaded * 100)));
              } else if (loaded > 1) {
                percent = Math.min(100, Math.round(loaded));
              }

              // Strict boundary clamp ensuring finite 0-100 integer
              if (!Number.isFinite(percent) || percent < 0) {
                percent = 0;
              } else if (percent > 100) {
                percent = 100;
              }

              try {
                progressCallback({ loaded, total, percent });
              } catch {
                // Monitor listener errors should not break creation flow
              }
            });
          }
        } catch {
          // Suppress addEventListener errors so session creation does not abort
        }
      },
    };

    session = await LM.create(createOptions);

    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    const promptPromise = signal
      ? session.prompt(rawText, {
          responseConstraint: LOCAL_AI_SCHEMA,
          signal,
        })
      : session.prompt(rawText, { responseConstraint: LOCAL_AI_SCHEMA });

    let rawOutput;
    if (signal || timeoutMs > 0) {
      let timer = null;
      let abortHandler = null;

      const racePromise = new Promise((_, reject) => {
        if (signal) {
          if (signal.aborted) {
            reject(
              new DOMException('The operation was aborted.', 'AbortError')
            );
            return;
          }
          abortHandler = () => {
            reject(
              new DOMException('The operation was aborted.', 'AbortError')
            );
          };
          signal.addEventListener('abort', abortHandler, { once: true });
        }
        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            reject(
              new Error(
                `PROMPT_TIMEOUT: AI prompt timed out after ${timeoutMs}ms`
              )
            );
          }, timeoutMs);
        }
      });

      try {
        rawOutput = await Promise.race([promptPromise, racePromise]);
      } finally {
        if (timer) clearTimeout(timer);
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
      }
    } else {
      rawOutput = await promptPromise;
    }

    return parseAiResponse(rawOutput);
  } finally {
    if (session && typeof session.destroy === 'function') {
      try {
        session.destroy();
      } catch {
        // Suppress cleanup exceptions so primary errors are preserved
      }
    }
  }
}

/**
 * Ingests extracted items into the application storage via agentBridge.
 * Chunks payloads exceeding MAX_INGESTION_BATCH (200) into sequential batches
 * and aggregates the results.
 * @param {Array<{ url: string, label?: string, tags?: string[] }>} items
 * @returns {Promise<{ ok: boolean, added?: any[], skipped?: any[], error?: any }>}
 */
export async function ingestExtractedUrls(items) {
  const agent =
    typeof window !== 'undefined' ? window.urlEditorAgent : undefined;
  if (!agent || typeof agent.addMany !== 'function') {
    throw new Error('AGENT_BRIDGE_NOT_AVAILABLE: Agent bridge unavailable.');
  }

  // Preserve native error handling for non-array / empty inputs
  if (!Array.isArray(items) || items.length === 0) {
    return agent.addMany(items, { skipDuplicates: true });
  }

  // Fast path for normal batches
  if (items.length <= MAX_INGESTION_BATCH) {
    return agent.addMany(items, { skipDuplicates: true });
  }

  // Chunking path for > 200 items
  const aggregatedAdded = [];
  const aggregatedSkipped = [];

  for (let i = 0; i < items.length; i += MAX_INGESTION_BATCH) {
    const chunk = items.slice(i, i + MAX_INGESTION_BATCH);
    const result = await agent.addMany(chunk, { skipDuplicates: true });

    if (!result || !result.ok) {
      return result;
    }

    if (Array.isArray(result.added)) {
      aggregatedAdded.push(...result.added);
    }

    if (Array.isArray(result.skipped)) {
      for (const skipItem of result.skipped) {
        aggregatedSkipped.push({
          ...skipItem,
          index:
            typeof skipItem.index === 'number'
              ? skipItem.index + i
              : skipItem.index,
        });
      }
    }
  }

  return {
    ok: true,
    added: aggregatedAdded,
    skipped: aggregatedSkipped,
  };
}
