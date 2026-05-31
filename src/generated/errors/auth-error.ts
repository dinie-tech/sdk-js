/**
 * `AuthError` (401) — openapi `type` URL `authentication-failed`.
 * Hand-authored in V0.1 to mirror future generator output (D1); openapi.yaml is the SoT.
 *
 * Server-response error: the API describes it in `openapi.yaml`, so the class lives in
 * `generated/` (not `runtime/`). It extends the runtime base `APIStatusError` and
 * self-registers with the dispatcher at module top-level — importing this file IS the
 * registration (story 011).
 *
 * ── runtime ↔ generated boundary ──
 * Imports only from `runtime/errors.js` (generated → runtime, the normal direction).
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

/**
 * Authentication failed (401). Minimal typed marker — `code`
 * (∈ `missing_token | invalid_token | token_expired`), `status`, `body`, `headers`,
 * `request_id` come from the base {@link APIStatusError}.
 */
export class AuthError extends APIStatusError {}

registerErrorType('https://docs.dinie.com/errors/authentication-failed', AuthError);
registerErrorStatus(401, AuthError);
