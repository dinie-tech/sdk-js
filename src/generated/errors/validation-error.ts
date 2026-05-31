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

import {
  APIStatusError,
  problemString,
  registerErrorStatus,
  registerErrorType,
} from '../../runtime/errors.js';

/** A semantically invalid request (422). `code` names the failed rule in openapi. */
export class ValidationError extends APIStatusError {
  /** Machine-readable code from the openapi `validation-failed` catalog, when present. */
  get code(): string | undefined {
    return problemString(this.body, 'code');
  }
}

registerErrorType('https://docs.dinie.com/errors/validation-failed', ValidationError);
registerErrorStatus(422, ValidationError);
