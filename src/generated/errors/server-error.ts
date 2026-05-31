/**
 * `ServerError` (500) — openapi `type` URL `internal`.
 * Hand-authored in V0.1 to mirror future generator output (D1); openapi.yaml is the SoT.
 *
 * Server-response error (lives in `generated/`). Extends the runtime base `APIStatusError`
 * and self-registers at module top-level — import IS registration (story 011).
 *
 * Covers BOTH 500 and 503: V0.1 folds service-unavailable into `ServerError` (no separate
 * `ServiceUnavailableError` — human decision at sign-off; revisit at V0.2 freeze). It also
 * backs `fromResponse`'s generic 5xx fallback (it owns status 500 in the registry).
 *
 * ── runtime ↔ generated boundary ──
 * Imports only from `runtime/errors.js` (generated → runtime, the normal direction).
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

/** The server failed to fulfill a valid request (500; also 503 service-unavailable in V0.1). */
export class ServerError extends APIStatusError {}

registerErrorType('https://docs.dinie.com/errors/internal', ServerError);
registerErrorStatus(500, ServerError);
registerErrorStatus(503, ServerError);
