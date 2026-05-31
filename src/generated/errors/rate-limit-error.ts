/**
 * `RateLimitError` (429) — openapi `type` URL `rate-limit-exceeded`.
 * Hand-authored in V0.1 to mirror future generator output (D1); openapi.yaml is the SoT.
 *
 * Server-response error (lives in `generated/`). Extends the runtime base `APIStatusError`
 * and self-registers at module top-level — import IS registration (story 011). 429 is
 * retryable; the HTTP loop honors `Retry-After` (capped ≤60s — retry.ts) before this is
 * ever thrown.
 *
 * ── runtime ↔ generated boundary ──
 * Imports only from `runtime/errors.js` (generated → runtime, the normal direction).
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

/** Too many requests (429). The openapi `Retry-After` header surfaces as {@link retryAfter}. */
export class RateLimitError extends APIStatusError {
  /** Seconds until the limit resets, parsed from the openapi-defined `Retry-After` header. */
  get retryAfter(): number | undefined {
    const raw = this.headers['retry-after'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined) return undefined;
    const seconds = Number.parseInt(value, 10);
    return Number.isFinite(seconds) ? seconds : undefined;
  }
}

registerErrorType('https://docs.dinie.com/errors/rate-limit-exceeded', RateLimitError);
registerErrorStatus(429, RateLimitError);
