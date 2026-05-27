import {
  APIConnectionError,
  APIError,
  APIStatusError,
  APITimeoutError,
  AuthError,
  BadRequestError,
  ConflictError,
  DinieError,
  IdempotencyKeyReuseError,
  NotFoundError,
  OAuthError,
  PermissionError,
  RateLimitError,
  ServerError,
  ServiceUnavailableError,
  ValidationError,
  WebhookSignatureError,
  WebhookTimestampError,
} from '../../src/runtime/errors.js';
import type {
  APIErrorResponse,
  ProblemDetails,
  ResponseHeaders,
} from '../../src/runtime/errors.js';

const ERRORS = 'https://docs.dinie.com.br/errors';

function makeResponse(opts: {
  statusCode: number;
  body?: ProblemDetails | Record<string, unknown> | string;
  headers?: ResponseHeaders;
}): APIErrorResponse {
  const { statusCode, body, headers = {} } = opts;
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  return {
    statusCode,
    headers,
    body: { text: () => Promise.resolve(text) },
  };
}

function problem(
  overrides: Partial<ProblemDetails> & { type: string; status: number },
): ProblemDetails {
  return { title: 'Error', ...overrides };
}

describe('error hierarchy', () => {
  it('wires the prototype chain DinieError → APIError → APIStatusError → subclass', () => {
    const err = new BadRequestError(400, null, {}, null);
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err).toBeInstanceOf(APIError);
    expect(err).toBeInstanceOf(DinieError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BadRequestError');
  });

  it('places connection errors under APIError but not APIStatusError', () => {
    const conn = new APIConnectionError();
    const timeout = new APITimeoutError();
    expect(conn).toBeInstanceOf(APIError);
    expect(conn).not.toBeInstanceOf(APIStatusError);
    expect(timeout).toBeInstanceOf(APIConnectionError);
    expect(timeout).toBeInstanceOf(APIError);
    expect(timeout).not.toBeInstanceOf(APIStatusError);
  });

  it('propagates cause on connection errors', () => {
    const cause = new Error('socket hang up');
    const conn = new APIConnectionError({ cause });
    expect(conn.cause).toBe(cause);
  });

  it('keeps OAuthError / WebhookSignatureError / WebhookTimestampError out of the APIError tree', () => {
    for (const err of [
      new OAuthError('token refresh failed'),
      new WebhookSignatureError('bad signature'),
      new WebhookTimestampError('stale timestamp'),
    ]) {
      expect(err).toBeInstanceOf(DinieError);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(APIError);
      expect(err).not.toBeInstanceOf(APIStatusError);
    }
  });

  it('treats IdempotencyKeyReuseError as a ValidationError (422)', () => {
    const err = new IdempotencyKeyReuseError(422, null, {}, null);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toBeInstanceOf(APIStatusError);
  });
});

describe('APIError.fromResponse — dispatch by type URL (D#1 catalog)', () => {
  const cases: ReadonlyArray<[string, number, new (...a: never[]) => APIStatusError]> = [
    [`${ERRORS}/authentication-error`, 401, AuthError],
    [`${ERRORS}/permission-denied`, 403, PermissionError],
    [`${ERRORS}/not-found`, 404, NotFoundError],
    [`${ERRORS}/conflict`, 409, ConflictError],
    [`${ERRORS}/validation-error`, 422, ValidationError],
    [`${ERRORS}/idempotency-key-reuse`, 422, IdempotencyKeyReuseError],
    [`${ERRORS}/rate-limit-exceeded`, 429, RateLimitError],
    [`${ERRORS}/internal-error`, 500, ServerError],
    [`${ERRORS}/service-unavailable`, 503, ServiceUnavailableError],
  ];

  it.each(cases)('maps %s → correct subclass', async (type, status, ctor) => {
    const res = makeResponse({ statusCode: status, body: problem({ type, status }) });
    const err = await APIError.fromResponse(res);
    expect(err).toBeInstanceOf(ctor);
    expect(err).toBeInstanceOf(APIStatusError);
    expect((err as APIStatusError).status).toBe(status);
    expect((err as APIStatusError).type).toBe(type);
  });

  it('lets the type URL win over the HTTP status', async () => {
    // type says auth (401) while the transport reports 403 — type must take precedence.
    const res = makeResponse({
      statusCode: 403,
      body: problem({ type: `${ERRORS}/authentication-error`, status: 401 }),
    });
    const err = await APIError.fromResponse(res);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as APIStatusError).status).toBe(403);
  });
});

describe('APIError.fromResponse — status fallback', () => {
  const cases: ReadonlyArray<[number, new (...a: never[]) => APIStatusError]> = [
    [400, BadRequestError],
    [401, AuthError],
    [403, PermissionError],
    [404, NotFoundError],
    [409, ConflictError],
    [422, ValidationError],
    [429, RateLimitError],
    [500, ServerError],
    [503, ServiceUnavailableError],
  ];

  it.each(cases)('falls back to status %i → correct subclass', async (status, ctor) => {
    const res = makeResponse({ statusCode: status });
    const err = await APIError.fromResponse(res);
    expect(err).toBeInstanceOf(ctor);
  });

  it('falls back to status when the type URL is unknown', async () => {
    const res = makeResponse({
      statusCode: 404,
      body: problem({ type: `${ERRORS}/some-future-error`, status: 404 }),
    });
    const err = await APIError.fromResponse(res);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('uses a generic APIStatusError for unmapped 4xx', async () => {
    const err = await APIError.fromResponse(makeResponse({ statusCode: 418 }));
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.constructor).toBe(APIStatusError);
    expect((err as APIStatusError).status).toBe(418);
  });

  it('treats unmapped 5xx as a ServerError', async () => {
    const err = await APIError.fromResponse(makeResponse({ statusCode: 502 }));
    expect(err).toBeInstanceOf(ServerError);
  });
});

describe('APIError.fromResponse — request_id', () => {
  it('extracts request_id from the x-request-id header', async () => {
    const res = makeResponse({
      statusCode: 500,
      headers: { 'x-request-id': 'req_abc123' },
    });
    const err = (await APIError.fromResponse(res)) as APIStatusError;
    expect(err.request_id).toBe('req_abc123');
    expect(err.message).toContain('req_abc123');
  });

  it('handles array-valued headers', async () => {
    const res = makeResponse({
      statusCode: 500,
      headers: { 'x-request-id': ['req_first', 'req_second'] },
    });
    const err = (await APIError.fromResponse(res)) as APIStatusError;
    expect(err.request_id).toBe('req_first');
  });

  it('falls back to a request_id carried in the body', async () => {
    const res = makeResponse({
      statusCode: 422,
      body: problem({
        type: `${ERRORS}/validation-error`,
        status: 422,
        request_id: 'req_from_body',
      }),
    });
    const err = (await APIError.fromResponse(res)) as APIStatusError;
    expect(err.request_id).toBe('req_from_body');
  });

  it('prefers the header over the body', async () => {
    const res = makeResponse({
      statusCode: 422,
      headers: { 'x-request-id': 'req_header' },
      body: problem({ type: `${ERRORS}/validation-error`, status: 422, request_id: 'req_body' }),
    });
    const err = (await APIError.fromResponse(res)) as APIStatusError;
    expect(err.request_id).toBe('req_header');
  });

  it('is null when no request_id is present', async () => {
    const err = (await APIError.fromResponse(makeResponse({ statusCode: 500 }))) as APIStatusError;
    expect(err.request_id).toBeNull();
  });
});

describe('APIError.fromResponse — body preservation', () => {
  it('preserves the full Problem Details payload, including extensions', async () => {
    const violations = [{ field: 'taxId', message: 'invalid CPF' }];
    const pd = problem({
      type: `${ERRORS}/validation-error`,
      status: 422,
      title: 'Validation failed',
      detail: 'The taxId field is invalid.',
      instance: '/v3/customers',
      violations,
    });
    const err = (await APIError.fromResponse(
      makeResponse({ statusCode: 422, body: pd }),
    )) as APIStatusError;

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.title).toBe('Validation failed');
    expect(err.detail).toBe('The taxId field is invalid.');
    expect(err.instance).toBe('/v3/customers');

    const body = err.body as ProblemDetails;
    expect(body.title).toBe('Validation failed');
    expect(body['violations']).toEqual(violations);
    // Message prefers `detail`, then prefixes the status.
    expect(err.message).toBe('422 The taxId field is invalid.');
  });

  it('keeps headers accessible on the error', async () => {
    const headers: ResponseHeaders = { 'retry-after': '30', 'x-request-id': 'req_1' };
    const err = (await APIError.fromResponse(
      makeResponse({ statusCode: 429, headers }),
    )) as APIStatusError;
    expect(err.headers['retry-after']).toBe('30');
  });

  it('preserves a non-JSON body as raw text', async () => {
    const err = (await APIError.fromResponse(
      makeResponse({ statusCode: 503, body: 'upstream timeout' }),
    )) as APIStatusError;
    expect(err.body).toBe('upstream timeout');
    expect(err.type).toBeUndefined();
    expect(err.message).toBe('503 upstream timeout');
  });

  it('sets body to null and a clear message when the body is empty', async () => {
    const err = (await APIError.fromResponse(makeResponse({ statusCode: 500 }))) as APIStatusError;
    expect(err.body).toBeNull();
    expect(err.message).toBe('500 status code (no body)');
  });

  it('survives a malformed JSON body', async () => {
    const err = (await APIError.fromResponse(
      makeResponse({ statusCode: 500, body: '{not json' }),
    )) as APIStatusError;
    expect(err.body).toBe('{not json');
    expect(err).toBeInstanceOf(ServerError);
  });
});
