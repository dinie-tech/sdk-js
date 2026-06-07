/**
 * `ValidationError` (422) — generated server-response error marker.
 *
 * Minimal typed marker: it extends the runtime `APIStatusError` and self-registers with the
 * dispatcher at import time. The base class carries `code`/`status`/`body`/`headers`/`request_id`.
 */

import { APIStatusError, registerErrorStatus, registerErrorType } from '../../runtime/errors.js';

export class ValidationError extends APIStatusError {}

registerErrorType('https://docs.dinie.com/errors/validation-failed', ValidationError);
registerErrorStatus(422, ValidationError);
