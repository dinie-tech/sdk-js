/**
 * `BadRequestError` (400) — openapi `type` URL `invalid-request`.
 * Hand-authored in V0.1 to mirror future generator output (D1); openapi.yaml is the SoT.
 *
 * Server-response error (lives in `generated/`). Extends the runtime base `APIStatusError`
 * and self-registers at module top-level — import IS registration (story 011).
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

/** The request was malformed (400). `code` identifies the specific validation in openapi. */
export class BadRequestError extends APIStatusError {
  /** Machine-readable code from the openapi `invalid-request` catalog, when present. */
  get code(): string | undefined {
    return problemString(this.body, 'code');
  }
}

registerErrorType('https://docs.dinie.com/errors/invalid-request', BadRequestError);
registerErrorStatus(400, BadRequestError);
