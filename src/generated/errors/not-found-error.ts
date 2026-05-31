/**
 * `NotFoundError` (404) — openapi `type` URL `not-found`.
 * Hand-authored in V0.1 to mirror future generator output (D1); openapi.yaml is the SoT.
 *
 * Server-response error (lives in `generated/`). Extends the runtime base `APIStatusError`
 * and self-registers at module top-level — import IS registration (story 011).
 *
 * ── runtime ↔ generated boundary ──
 * Imports only from `runtime/errors.js` (generated → runtime, the normal direction).
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

/** The requested resource does not exist (404). */
export class NotFoundError extends APIStatusError {}

registerErrorType('https://docs.dinie.com/errors/not-found', NotFoundError);
registerErrorStatus(404, NotFoundError);
