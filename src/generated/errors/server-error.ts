/**
 * `ServerError` (500) — generated server-response error marker.
 *
 * Minimal typed marker: it extends the runtime `APIStatusError` and self-registers with the
 * dispatcher at import time. The base class carries `code`/`status`/`body`/`headers`/`request_id`.
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

export class ServerError extends APIStatusError {}

registerErrorType('https://docs.dinie.com/errors/internal', ServerError);
registerErrorStatus(500, ServerError);
