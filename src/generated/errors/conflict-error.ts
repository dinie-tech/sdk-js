/**
 * `ConflictError` (409) — openapi `type` URL `conflict`.
 * Hand-authored in V0.1 to mirror future generator output (D1); openapi.yaml is the SoT.
 *
 * Server-response error (lives in `generated/`). Extends the runtime base `APIStatusError`
 * and self-registers at module top-level — import IS registration (story 011). 409 is
 * never retried (semantic conflict — D5).
 *
 * ── runtime ↔ generated boundary ──
 * Imports only from `runtime/errors.js` (generated → runtime, the normal direction).
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

/** The request conflicts with the current state of the resource (409). */
export class ConflictError extends APIStatusError {}

registerErrorType('https://docs.dinie.com/errors/conflict', ConflictError);
registerErrorStatus(409, ConflictError);
