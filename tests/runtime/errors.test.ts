/**
 * Error mechanism (runtime) + server-response catalog (generated) — story 011.
 *
 * The base hierarchy + client-side errors + the RFC 9457 dispatch registry live in
 * `src/runtime/errors.ts`. The typed catalog (one class per openapi `type` URL) lives in
 * `src/generated/errors/` and self-registers on import — so importing the catalog below
 * is what populates `APIError.fromResponse`'s registry (the openapi-SoT seam).
 */

import {
  AuthError,
  BadRequestError,
  ConflictError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  ValidationError,
} from '../../src/generated/errors/index.js';
import {
  APIConnectionError,
  APIError,
  APIStatusError,
  APITimeoutError,
  DinieError,
  OAuthError,
  WebhookSignatureError,
  WebhookTimestampError,
} from '../../src/runtime/errors.js';
import type {
  APIErrorResponse,
  ProblemDetails,
  ResponseHeaders,
} from '../../src/runtime/errors.js';

// openapi.yaml is the SoT: `https://docs.dinie.com/errors/<slug>` (note: `docs.dinie.com`,
// not `docs.dinie.com.br` — the old hand-authored guess).
const ERRORS = 'https://docs.dinie.com/errors';

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
});

describe('APIError.fromResponse — dispatch by openapi `type` URL', () => {
  // The 7 wired openapi type URLs + `forbidden` (orphan in openapi, registered anyway).
  const cases: ReadonlyArray<[string, number, new (...a: never[]) => APIStatusError]> = [
    [`${ERRORS}/invalid-request`, 400, BadRequestError],
    [`${ERRORS}/authentication-failed`, 401, AuthError],
    [`${ERRORS}/forbidden`, 403, PermissionError],
    [`${ERRORS}/not-found`, 404, NotFoundError],
    [`${ERRORS}/conflict`, 409, ConflictError],
    [`${ERRORS}/validation-failed`, 422, ValidationError],
    [`${ERRORS}/rate-limit-exceeded`, 429, RateLimitError],
    [`${ERRORS}/internal`, 500, ServerError],
  ];

  it.each(cases)('maps %s → correct subclass', async (type, status, ctor) => {
    const res = makeResponse({ statusCode: status, body: problem({ type, status }) });
    const err = await APIError.fromResponse(res);
    expect(err).toBeInstanceOf(ctor);
    expect(err).toBeInstanceOf(APIStatusError);
    expect((err as APIStatusError).status).toBe(status);
    expect((err as APIStatusError).type).toBe(type);
  });

  it('folds 503 into ServerError via the `internal` type URL (no ServiceUnavailableError)', async () => {
    const res = makeResponse({
      statusCode: 503,
      body: problem({ type: `${ERRORS}/internal`, status: 503 }),
    });
    expect(await APIError.fromResponse(res)).toBeInstanceOf(ServerError);
  });

  it('lets the type URL win over the HTTP status', async () => {
    // type says auth (401) while the transport reports 403 — type must take precedence.
    const res = makeResponse({
      statusCode: 403,
      body: problem({ type: `${ERRORS}/authentication-failed`, status: 401 }),
    });
    const err = await APIError.fromResponse(res);
    expect(err).toBeInstanceOf(AuthError);
    expect((err as APIStatusError).status).toBe(403);
  });
});

describe('APIError.fromResponse — status fallback (registry-driven)', () => {
  const cases: ReadonlyArray<[number, new (...a: never[]) => APIStatusError]> = [
    [400, BadRequestError],
    [401, AuthError],
    [403, PermissionError],
    [404, NotFoundError],
    [409, ConflictError],
    [422, ValidationError],
    [429, RateLimitError],
    [500, ServerError],
    [503, ServerError], // 503 folds into ServerError (story 011)
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

  it('treats unmapped 5xx (502/504) as a ServerError — body-less gateway errors (§6.2)', async () => {
    expect(await APIError.fromResponse(makeResponse({ statusCode: 502 }))).toBeInstanceOf(
      ServerError,
    );
    expect(await APIError.fromResponse(makeResponse({ statusCode: 504 }))).toBeInstanceOf(
      ServerError,
    );
  });

  it('routes 410 Gone (no type URL) to a generic APIStatusError carrying code/request_id (§6.2)', async () => {
    // 410 has no openapi `type` URL and no dedicated class (no GoneError this round) — it
    // must fall back to a generic APIStatusError, not a subclass, while still surfacing
    // `code` and `request_id`.
    const res = makeResponse({
      statusCode: 410,
      headers: { 'x-request-id': 'req_gone_1' },
      body: { title: 'Gone', status: 410, code: 'credential_revoked' },
    });
    const err = (await APIError.fromResponse(res)) as APIStatusError;
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.constructor).toBe(APIStatusError);
    expect(err.status).toBe(410);
    expect(err.code).toBe('credential_revoked');
    expect(err.request_id).toBe('req_gone_1');
  });
});

describe('APIStatusError base — `code` extraction (uniform across the catalog)', () => {
  // `code` is read once in the base ctor (story 012), so every catalog class inherits it
  // without a per-class getter. One test via a subclass covers the whole catalog.
  it('surfaces the openapi `code` extension on any catalog class', async () => {
    const res = makeResponse({
      statusCode: 422,
      body: problem({
        type: `${ERRORS}/validation-failed`,
        status: 422,
        code: 'missing_required_field',
      }),
    });
    const err = (await APIError.fromResponse(res)) as ValidationError;
    expect(err).toBeInstanceOf(ValidationError);
    expect(err).toBeInstanceOf(APIStatusError);
    expect(err.code).toBe('missing_required_field');
  });

  it('leaves `code` undefined when the payload omits it', async () => {
    const err = (await APIError.fromResponse(
      makeResponse({
        statusCode: 401,
        body: problem({ type: `${ERRORS}/authentication-failed`, status: 401 }),
      }),
    )) as AuthError;
    expect(err.code).toBeUndefined();
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
        type: `${ERRORS}/validation-failed`,
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
      body: problem({ type: `${ERRORS}/validation-failed`, status: 422, request_id: 'req_body' }),
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
      type: `${ERRORS}/validation-failed`,
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
