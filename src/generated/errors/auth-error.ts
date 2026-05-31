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

import {
  APIStatusError,
  problemString,
  registerErrorStatus,
  registerErrorType,
} from '../../runtime/errors.js';

/** Authentication failed (401). `code` ∈ `missing_token | invalid_token | token_expired`. */
export class AuthError extends APIStatusError {
  /** Machine-readable code from the openapi `authentication-failed` catalog, when present. */
  get code(): string | undefined {
    return problemString(this.body, 'code');
  }
}

registerErrorType('https://docs.dinie.com/errors/authentication-failed', AuthError);
registerErrorStatus(401, AuthError);
