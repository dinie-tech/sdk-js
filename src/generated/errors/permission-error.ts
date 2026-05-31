/**
 * `PermissionError` (403) — `type` URL `forbidden`.
 * Hand-authored in V0.1 to mirror future generator output (D1).
 *
 * Server-response error (lives in `generated/`). Extends the runtime base `APIStatusError`
 * and self-registers at module top-level — import IS registration (story 011).
 *
 * ⚠️ The `forbidden` `type` URL is ORPHAN in `openapi.yaml`: the human-readable doc exists
 * (`api-docs/errors/forbidden.md`) but the 403 `responses` refs are missing in openapi.
 * We register the class anyway so a 403 carrying this `type` dispatches correctly. Wiring
 * the openapi refs is a V0.2 follow-up (PROGRESS.md fix-cycle 1).
 *
 * ── runtime ↔ generated boundary ──
 * Imports only from `runtime/errors.js` (generated → runtime, the normal direction).
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

/**
 * Authenticated, but the account lacks permission for the action (403). Minimal typed
 * marker — `code`, `status`, `body`, `headers`, `request_id` come from the base
 * {@link APIStatusError}.
 */
export class PermissionError extends APIStatusError {}

registerErrorType('https://docs.dinie.com/errors/forbidden', PermissionError);
registerErrorStatus(403, PermissionError);
