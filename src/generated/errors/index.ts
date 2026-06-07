/**
 * Barrel for the generated server-response error catalog.
 *
 * One class per error marker; re-exporting a module runs its top-level registration side-effect,
 * so importing this barrel registers the whole catalog with `APIError.fromResponse`. Ordered
 * alphabetically by module path for a minimal generator diff.
 */

export { AuthError } from './auth-error.js';
export { BadRequestError } from './bad-request-error.js';
export { ConflictError } from './conflict-error.js';
export { NotFoundError } from './not-found-error.js';
export { PermissionDeniedError } from './permission-denied-error.js';
export { RateLimitError } from './rate-limit-error.js';
export { ServerError } from './server-error.js';
export { ValidationError } from './validation-error.js';
