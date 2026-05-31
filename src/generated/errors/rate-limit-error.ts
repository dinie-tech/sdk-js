/**
 * `RateLimitError` (429) — openapi `type` URL `rate-limit-exceeded`.
 * Hand-authored in V0.1 to mirror future generator output (D1); openapi.yaml is the SoT.
 *
 * Server-response error (lives in `generated/`). Extends the runtime base `APIStatusError`
 * and self-registers at module top-level — import IS registration (story 011). 429 is
 * retryable; the HTTP loop honors `Retry-After` (capped ≤60s — retry.ts) before this is
 * ever thrown.
 *
 * Minimal typed marker — empty body, like `openai-node`'s `RateLimitError`. The
 * `Retry-After` header is NOT parsed by this class (header parsing isn't template-emittable
 * from openapi): the retry loop already honors it internally, and for custom post-catch
 * logic use the public `parseRetryAfter(err.headers['retry-after'])` runtime helper.
 *
 * ── runtime ↔ generated boundary ──
 * Imports only from `runtime/errors.js` (generated → runtime, the normal direction).
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

/** Too many requests (429). `status`, `body`, `headers`, `code`, `request_id` from the base. */
export class RateLimitError extends APIStatusError {}

registerErrorType('https://docs.dinie.com/errors/rate-limit-exceeded', RateLimitError);
registerErrorStatus(429, RateLimitError);
