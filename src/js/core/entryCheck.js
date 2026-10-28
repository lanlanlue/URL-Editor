import { applyAssertions, normalizeAssertions } from './assertions.js';
import { recordCheck } from './checkHistory.js';

/**
 * Runs one health check for a URL entry with its assertions applied, and
 * records the outcome in the local history.
 * @param {{id: string, url: string, assertions?: object}} entry
 * @param {(url: string, timeoutMs?: number, options?: object) => Promise<object>} check
 * @returns {Promise<object>} HealthResult plus `regression` / `recovered`
 */
export async function runEntryCheck(entry, check) {
  const assertions = normalizeAssertions(entry.assertions);
  const raw = await check(
    entry.url,
    undefined,
    assertions?.keyword ? { keyword: assertions.keyword } : {}
  );
  const result = applyAssertions(raw, assertions);
  const { regression, recovered } = recordCheck(entry.id, result);
  return { ...result, regression, recovered };
}
