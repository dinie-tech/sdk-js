/**
 * `ConflictError` (409) — generated server-response error marker.
 *
 * Minimal typed marker: it extends the runtime `APIStatusError` and self-registers with the
 * dispatcher at import time. The base class carries `code`/`status`/`body`/`headers`/`request_id`.
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

export class ConflictError extends APIStatusError {}

registerErrorType('https://docs.dinie.com/errors/conflict', ConflictError);
registerErrorStatus(409, ConflictError);
