/**
 * Rate-limit header parsing + tracker.
 *
 * Reads the `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`
 * headers off the *last* response and exposes them as a `RateLimit` snapshot, which
 * `http.ts` keeps current and `client.rate_limit` reads (story 009).
 *
 * Two pieces:
 *   - `parseRateLimit(headers)` — pure function: headers → `RateLimit | null`.
 *   - `RateLimitTracker` — thin mutable holder of the latest snapshot for `http.ts`.
 *
 * Leaf module: no dependencies on other runtime modules. `RateLimit` is the only
 * public symbol here (re-exported via the runtime barrel per architecture §4.1);
 * the parser and tracker are internal to the runtime.
 *
 * **All-or-nothing population (decision):** the public `RateLimit` type (§4.1) has
 * non-nullable `limit`/`remaining`/`resetAt`, so `parseRateLimit` returns the whole
 * object or `null` — never a partial with null fields. Any missing/garbage header
 * makes the parse return `null` (and the tracker keeps its previous snapshot rather
 * than clobbering a good value with a header-less response such as the token call).
 */

/** Response headers as undici delivers them (lowercased keys; arrays for repeats). */
type RateLimitHeaders = Record<string, string | string[] | undefined>;

/**
 * Parsed rate-limit state from the most recent response (architecture §4.1).
 * Surfaced as `client.rate_limit` (snake_case on the public surface — D4, provisional).
 */
export interface RateLimit {
  /** Ceiling for the current window (`X-RateLimit-Limit`). */
  limit: number;
  /** Requests left in the current window (`X-RateLimit-Remaining`). */
  remaining: number;
  /** When the window resets, normalized to a `Date` (`X-RateLimit-Reset`). */
  resetAt: Date;
}

const LIMIT_HEADER = 'x-ratelimit-limit';
const REMAINING_HEADER = 'x-ratelimit-remaining';
const RESET_HEADER = 'x-ratelimit-reset';

/**
 * `X-RateLimit-Reset` values at or above this (seconds) are read as an absolute Unix
 * epoch; anything below as a delta in seconds from now. `1e9` seconds is ~2001-09,
 * far above any plausible "seconds until reset" window yet below every real epoch.
 */
const EPOCH_THRESHOLD_SECONDS = 1_000_000_000;

/**
 * Parse the three `X-RateLimit-*` headers into a `RateLimit`, or `null` when any is
 * absent or unparseable. Never throws — resilient to missing/garbage headers.
 */
export function parseRateLimit(headers: RateLimitHeaders): RateLimit | null {
  const limit = parseCount(headerValue(headers, LIMIT_HEADER));
  const remaining = parseCount(headerValue(headers, REMAINING_HEADER));
  const resetAt = parseReset(headerValue(headers, RESET_HEADER));

  if (limit === null || remaining === null || resetAt === null) return null;
  return { limit, remaining, resetAt };
}

/**
 * Mutable holder of the latest `RateLimit`. `http.ts` calls `update(headers)` after
 * every response; `client.rate_limit` reads `snapshot`. `null` until the first
 * response that carries valid rate-limit headers.
 */
export class RateLimitTracker {
  #current: RateLimit | null = null;

  /** Latest parsed rate-limit, or `null` before any response carried valid headers. */
  get snapshot(): RateLimit | null {
    return this.#current;
  }

  /**
   * Fold a response's headers into the snapshot. A header-less or garbage response
   * leaves the previous snapshot untouched (does not reset it to `null`).
   */
  update(headers: RateLimitHeaders): void {
    const parsed = parseRateLimit(headers);
    if (parsed !== null) this.#current = parsed;
  }
}

/** A non-negative finite count, or `null` if absent/unparseable. */
function parseCount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * `X-RateLimit-Reset` → `Date`. Accepts a Unix epoch (seconds) or a delta (seconds
 * from now), disambiguated by `EPOCH_THRESHOLD_SECONDS`. `null` if unparseable.
 */
function parseReset(raw: string | undefined): Date | null {
  if (raw === undefined) return null;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const epochMs = seconds >= EPOCH_THRESHOLD_SECONDS ? seconds * 1000 : Date.now() + seconds * 1000;
  return new Date(epochMs);
}

/** Case-insensitive header lookup; first value of a repeated header. */
function headerValue(headers: RateLimitHeaders, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) {
      const single = Array.isArray(value) ? value[0] : value;
      return single ?? undefined;
    }
  }
  return undefined;
}
