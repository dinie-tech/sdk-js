/**
 * Retry policy — pure decision + delay functions (no I/O, no state).
 *
 * Two jobs, both consumed by `http.ts` (the retry loop itself — sleeping, attempt
 * counting, the `X-Dinie-Retry-Count` header, the 401 one-shot re-auth — lives
 * there, story 007):
 *
 *   - `shouldRetry(status)` / `isRetryableNetworkError(err)` — should this attempt
 *     be retried?
 *   - `retryDelay(attempt, retryAfter?)` — how long to wait before the next one?
 *
 * Backoff is exponential with subtractive jitter: `min(0.5 · 2^attempt, 8) s`,
 * then minus up to 25%. A `Retry-After` header (delta-seconds or HTTP-date) takes
 * precedence over the computed backoff, capped at 60 s. Mirrors the algorithm
 * shared across the Dinie SDKs (runtime-patterns §2).
 *
 * The decision/backoff functions (`shouldRetry`/`retryDelay`/`isRetryableNetworkError`)
 * are internal to the runtime and imported directly by `http.ts` — NOT part of the public
 * SDK surface, so they stay out of the barrel. The one exception is `parseRetryAfter`,
 * promoted to the public runtime barrel (story 012) for custom post-catch logic.
 */

// ── Retryable HTTP status (D8) ────────────────────────────────────────────────

/**
 * HTTP status codes the SDK retries (V0.2 freeze decision D8).
 *
 * The set is `{408, 429, 500, 502, 503, 504}` plus timeouts/connection errors (handled
 * by `isRetryableNetworkError`) — reconciled from the V0.1 sketch (`429/502/503/504`) to
 * align with `runtime-patterns.md`/OpenAI. `408` (request timeout) and `500` (internal)
 * were added; retrying `500` on a non-GET is safe because the stable `X-Idempotency-Key`
 * (minted once before the loop — D9) guarantees a retry never creates a duplicate
 * resource. `409` (Dinie semantic conflict) and `410` (gone) never retry; `401` is a
 * one-shot re-auth handled in `http.ts`, orthogonal to this set.
 */
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 429, 500, 502, 503, 504]);

/** True only for the retryable status set (`{408, 429, 500, 502, 503, 504}` — D8). */
export function shouldRetry(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

// ── Backoff + jitter ──────────────────────────────────────────────────────────

/** Initial backoff, in seconds (the `attempt = 0` base before jitter). */
const INITIAL_BACKOFF_SECONDS = 0.5;
/** Backoff ceiling, in seconds (reached at `attempt = 4`). */
const MAX_BACKOFF_SECONDS = 8;
/** Subtractive jitter fraction — the delay is reduced by up to this share. */
const JITTER_RATIO = 0.25;
/** Hard cap applied to a server-provided `Retry-After`, in ms (abuse guard). */
const RETRY_AFTER_CAP_MS = 60_000;

/**
 * Milliseconds to wait before the next attempt.
 *
 * A parseable `Retry-After` wins (clamped to `[0, 60s]`). Otherwise: exponential
 * backoff `min(0.5 · 2^attempt, 8) s` minus up to 25% subtractive jitter via
 * `Math.random()` (mock it for deterministic tests).
 */
export function retryDelay(attempt: number, retryAfter?: string | string[]): number {
  const fromHeader = parseRetryAfter(retryAfter);
  if (fromHeader !== null) {
    // Retry-After precedence: clamp to [0, 60s] (past HTTP-date → 0, abuse → cap).
    return Math.min(Math.max(fromHeader, 0), RETRY_AFTER_CAP_MS);
  }
  const backoffMs = Math.min(INITIAL_BACKOFF_SECONDS * 2 ** attempt, MAX_BACKOFF_SECONDS) * 1000;
  return backoffMs * (1 - JITTER_RATIO * Math.random());
}

/**
 * Parse a `Retry-After` header value to **milliseconds**, or `null` when absent or
 * unparseable. Accepts both forms RFC 7231 allows:
 *   - delta-seconds: a number of seconds (float tolerated) → `value · 1000`.
 *   - HTTP-date: an absolute timestamp → delta from now (may be negative for a
 *     past date; `retryDelay` clamps).
 *
 * This is the only place that reads the clock, and only for the HTTP-date form.
 *
 * Public helper (story 012). The SDK's retry loop already respects `Retry-After`
 * internally (capped ≤60s), so you do NOT need this for normal retries — it is for
 * **custom post-catch logic** after you catch a `RateLimitError`, e.g. surfacing the wait
 * to a user or scheduling your own backoff:
 *
 * ```typescript
 * import { parseRetryAfter, RateLimitError } from '@dinie/sdk';
 *
 * try {
 *   await client.customers.create(params);
 * } catch (err) {
 *   if (err instanceof RateLimitError) {
 *     const waitMs = parseRetryAfter(err.headers['retry-after']); // ms or null
 *     if (waitMs !== null) console.log(`rate limited — retry in ${waitMs}ms`);
 *   }
 * }
 * ```
 *
 * The parameter is widened to `string | string[]` (D11) so the JSDoc example above
 * type-checks in strict mode without a cast: `err.headers` is `ResponseHeaders`
 * (`Record<string, string | string[] | undefined>`), so `err.headers['retry-after']` is
 * `string | string[] | undefined`. A multi-valued header uses its first element.
 *
 * @param retryAfter - The raw `Retry-After` header value (e.g. `err.headers['retry-after']`),
 *   either a single value or undici's repeated-header array.
 * @returns Milliseconds to wait, or `null` when the header is absent or unparseable.
 */
export function parseRetryAfter(retryAfter?: string | string[]): number | null {
  // A repeated header arrives as `string[]` (undici `ResponseHeaders`) — use the first.
  const raw = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
  if (raw == null) return null;
  const value = raw.trim();
  if (value === '') return null;

  // delta-seconds: a bare number. `Number` rejects HTTP-dates (they start with a
  // weekday name) as `NaN`, so this branch never swallows a date.
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;

  // HTTP-date: absolute instant → relative delay from now.
  const whenMs = Date.parse(value);
  if (Number.isFinite(whenMs)) return whenMs - Date.now();

  return null;
}

// ── Network-level retryability ─────────────────────────────────────────────────

/**
 * Node/undici error codes treated as transient transport failures: connection
 * resets/refusals, broken pipes, transient DNS, and undici's own
 * connect/headers/body timeout + socket codes.
 */
const RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENETDOWN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Error `name`s that mean "the request timed out". `AbortSignal.timeout()` rejects
 * with a `TimeoutError`. A plain `AbortError` (a caller cancelling via its own
 * signal) is deliberately absent — `http.ts` must not feed user cancellations to
 * this function, and we never retry one.
 */
const RETRYABLE_ERROR_NAMES: ReadonlySet<string> = new Set(['TimeoutError']);

/**
 * Whether a thrown transport error (no HTTP response) is worth retrying: timeouts
 * and connection resets. Walks the `cause` chain (undici wraps the underlying
 * socket error) and keys off `code`/`name`, never the message.
 */
export function isRetryableNetworkError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current != null && typeof current === 'object'; depth++) {
    const candidate = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && RETRYABLE_ERROR_CODES.has(candidate.code)) {
      return true;
    }
    if (typeof candidate.name === 'string' && RETRYABLE_ERROR_NAMES.has(candidate.name)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
