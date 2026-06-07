/**
 * `BadRequestError` (400) — generated server-response error marker.
 *
 * Minimal typed marker: it extends the runtime `APIStatusError` and self-registers with the
 * dispatcher at import time. The base class carries `code`/`status`/`body`/`headers`/`request_id`.
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

export class BadRequestError extends APIStatusError {}

registerErrorType('https://docs.dinie.com/errors/invalid-request', BadRequestError);
registerErrorStatus(400, BadRequestError);
