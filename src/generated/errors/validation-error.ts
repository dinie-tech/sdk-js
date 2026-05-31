/**
 * `ValidationError` (422) — openapi `type` URL `validation-failed`.
 * Hand-authored in V0.1 to mirror future generator output (D1); openapi.yaml is the SoT.
 *
 * Server-response error (lives in `generated/`). Extends the runtime base `APIStatusError`
 * and self-registers at module top-level — import IS registration (story 011).
 *
 * Also covers idempotency-key reuse: V0.1 folds it into `ValidationError` (no separate
 * `IdempotencyKeyReuseError` — human decision at sign-off; revisit at V0.2 freeze).
 *
 * ── runtime ↔ generated boundary ──
 * Imports only from `runtime/errors.js` (generated → runtime, the normal direction).
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

/**
 * A semantically invalid request (422). Minimal typed marker — `code` (the failed rule),
 * `status`, `body`, `headers`, `request_id` come from the base {@link APIStatusError}.
 */
export class ValidationError extends APIStatusError {}

registerErrorType('https://docs.dinie.com/errors/validation-failed', ValidationError);
registerErrorStatus(422, ValidationError);
