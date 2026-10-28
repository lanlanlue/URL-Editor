/**
 * Per-URL test assertions: expected HTTP status, required keyword, and a
 * response-time budget. Pure functions; no DOM or storage access.
 */

const MAX_KEYWORD_LENGTH = 200;

/**
 * Cleans untrusted assertion input. Returns null when nothing is configured.
 * @param {*} raw
 * @returns {{expectedStatus: string, keyword: string, maxTimeMs: number|null}|null}
 */
export function normalizeAssertions(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const expectedStatus =
    typeof raw.expectedStatus === 'string'
      ? raw.expectedStatus.replace(/\s+/g, '').slice(0, 50)
      : '';
  const keyword =
    typeof raw.keyword === 'string'
      ? raw.keyword.slice(0, MAX_KEYWORD_LENGTH)
      : '';
  const max = Number(raw.maxTimeMs);
  const maxTimeMs = Number.isFinite(max) && max > 0 ? Math.round(max) : null;
  if (!expectedStatus && !keyword && maxTimeMs === null) return null;
  return { expectedStatus, keyword, maxTimeMs };
}

/**
 * Status spec: comma-separated tokens. Each token is an exact code ("200"),
 * a class ("2xx"), or an inclusive range ("200-299").
 * @param {number} code
 * @param {string} spec
 * @returns {boolean}
 */
export function matchesStatus(code, spec) {
  return String(spec)
    .split(',')
    .filter(Boolean)
    .some((token) => {
      const cls = /^([1-5])xx$/i.exec(token);
      if (cls) return Math.floor(code / 100) === Number(cls[1]);
      const range = /^(\d{3})-(\d{3})$/.exec(token);
      if (range) return code >= Number(range[1]) && code <= Number(range[2]);
      return /^\d{3}$/.test(token) && code === Number(token);
    });
}

/**
 * Evaluates assertions against a health result.
 * Checks that cannot be evaluated in the current mode (e.g. status in limited
 * mode, keyword without a response body) are reported as `skipped`, never as
 * passed or failed.
 * `state` is 'failed' when any check failed, 'skipped' when checks were
 * configured but every one was skipped (nothing was verified), else 'passed'.
 * `passed` is true only for state 'passed', so a UI tick never appears for an
 * assertion that verified nothing.
 * @returns {{passed: boolean, state: 'passed'|'failed'|'skipped', failures: Array<object>, skipped: string[]}}
 */
export function evaluateAssertions(result, assertions) {
  const failures = [];
  const skipped = [];
  if (!assertions) return { passed: true, state: 'passed', failures, skipped };

  if (assertions.expectedStatus) {
    if (result.code != null) {
      if (!matchesStatus(result.code, assertions.expectedStatus)) {
        failures.push({
          type: 'status',
          expected: assertions.expectedStatus,
          actual: result.code,
        });
      }
    } else if (result.mode === 'limited') {
      skipped.push('status');
    } else {
      failures.push({
        type: 'status',
        expected: assertions.expectedStatus,
        actual: 'no response',
      });
    }
  }

  if (assertions.keyword) {
    if (typeof result.keywordFound === 'boolean') {
      if (!result.keywordFound) {
        failures.push({
          type: 'keyword',
          expected: assertions.keyword,
          actual: 'not found',
        });
      }
    } else if (result.status === 'offline' && result.mode !== 'limited') {
      failures.push({
        type: 'keyword',
        expected: assertions.keyword,
        actual: 'no response',
      });
    } else {
      skipped.push('keyword');
    }
  }

  if (assertions.maxTimeMs !== null && assertions.maxTimeMs !== undefined) {
    if (typeof result.timeMs === 'number') {
      if (result.timeMs > assertions.maxTimeMs) {
        failures.push({
          type: 'time',
          expected: assertions.maxTimeMs,
          actual: result.timeMs,
        });
      }
    } else {
      skipped.push('time');
    }
  }

  const configured =
    (assertions.expectedStatus ? 1 : 0) +
    (assertions.keyword ? 1 : 0) +
    (assertions.maxTimeMs !== null && assertions.maxTimeMs !== undefined
      ? 1
      : 0);
  let state = 'passed';
  if (failures.length > 0) state = 'failed';
  else if (configured > 0 && skipped.length === configured) state = 'skipped';
  return { passed: state === 'passed', state, failures, skipped };
}

function describeFailure(failure) {
  if (failure.type === 'status')
    return `Expected status ${failure.expected}, got ${failure.actual}`;
  if (failure.type === 'keyword')
    return `Keyword "${failure.expected}" ${failure.actual}`;
  return `Response ${failure.actual}ms exceeds ${failure.expected}ms`;
}

/**
 * Returns the result with `assertion` attached. When an expected status is
 * set and evaluable, it overrides the default 2xx/3xx = online rule (so an
 * expected 404 counts as passing); any failed assertion marks it offline.
 */
export function applyAssertions(result, rawAssertions) {
  const assertions = normalizeAssertions(rawAssertions);
  if (!assertions) return result;

  const assertion = evaluateAssertions(result, assertions);
  const next = { ...result, assertion };
  if (assertion.state === 'failed') {
    next.status = 'offline';
    next.error = assertion.failures.map(describeFailure).join('; ');
  } else if (
    assertions.expectedStatus &&
    !assertion.skipped.includes('status')
  ) {
    next.status = 'online';
    next.error = undefined;
  }
  return next;
}
