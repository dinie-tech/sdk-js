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

// ── Retryable HTTP status (D5) ────────────────────────────────────────────────

/**
 * HTTP status codes the V0.1 retries.
 *
 * ⚠️ V0.1 set — the authoritative source is the version-spec DoD, which enumerates
 * exactly `429/502/503/504` (plus timeouts/connection errors, handled by
 * `isRetryableNetworkError`). This INTENTIONALLY excludes `500` and `408`,
 * diverging from `runtime-patterns.md` (which recommends `≥500`, aligned with
 * OpenAI). The divergence is isolated here in a single const for the V0.2 freeze
 * to reconcile (architecture D5 + "Nota sobre D5"). `409` never retries (Dinie
 * semantic conflict); `401` is a one-shot re-auth handled in `http.ts`, orthogonal
 * to this set.
 */
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/** True only for the V0.1 retryable status set (`429/502/503/504`). */
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
export function retryDelay(attempt: number, retryAfter?: string): number {
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
 *   await client.customers.create({ taxId, name });
 * } catch (err) {
 *   if (err instanceof RateLimitError) {
 *     const waitMs = parseRetryAfter(err.headers['retry-after']); // ms or null
 *     if (waitMs !== null) console.log(`rate limited — retry in ${waitMs}ms`);
 *   }
 * }
 * ```
 *
 * @param retryAfter - The raw `Retry-After` header value (e.g. `err.headers['retry-after']`).
 * @returns Milliseconds to wait, or `null` when the header is absent or unparseable.
 */
export function parseRetryAfter(retryAfter?: string): number | null {
  if (retryAfter == null) return null;
  const value = retryAfter.trim();
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
