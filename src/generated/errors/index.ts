/**
 * Barrel for the server-response error catalog (hand-authored in V0.1, generated from V0.4
 * — D1). Mirrors the `openapi.yaml` error catalog: one class per `type` URL, each
 * extending the runtime base `APIStatusError` and self-registering with the dispatcher.
 *
 * Re-exported by `src/generated/index.ts` (`export * from './errors/index.js'`), so the
 * package's public surface carries the typed catalog and importing it registers every
 * class with `APIError.fromResponse`.
 *
 * Entries are ordered alphabetically by module path so the V0.4 generator produces a
 * minimal diff (determinism — architecture §7/§12).
 */

export { AuthError } from './auth-error.js';
export { BadRequestError } from './bad-request-error.js';
export { ConflictError } from './conflict-error.js';
export { NotFoundError } from './not-found-error.js';
export { PermissionError } from './permission-error.js';
export { RateLimitError } from './rate-limit-error.js';
export { ServerError } from './server-error.js';
export { ValidationError } from './validation-error.js';
