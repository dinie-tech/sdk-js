/**
 * Typed error hierarchy + RFC 9457 dispatch factory.
 *
 *   DinieError (base, extends Error)
 *   ├── APIError
 *   │   ├── APIConnectionError
 *   │   │   └── APITimeoutError
 *   │   └── APIStatusError (carries status, headers, body, request_id)
 *   │       ├── BadRequestError (400)
 *   │       ├── AuthError (401)
 *   │       ├── PermissionError (403)
 *   │       ├── NotFoundError (404)
 *   │       ├── ConflictError (409)
 *   │       ├── ValidationError (422)
 *   │       │   └── IdempotencyKeyReuseError (422)
 *   │       ├── RateLimitError (429)
 *   │       ├── ServerError (500)
 *   │       └── ServiceUnavailableError (503)
 *   └── OAuthError / WebhookSignatureError / WebhookTimestampError (outside the APIError tree)
 *
 * `APIError.fromResponse()` reads the RFC 9457 Problem Details body and dispatches
 * by `type` URL (D#1 catalog), falling back to the HTTP status. `request_id` is a
 * first-class attribute on every `APIStatusError` (from the response header, or the
 * body as a fallback) for the support flow. Mirrors `openai-node/src/core/error.ts`.
 */

/**
 * RFC 9457 Problem Details (wire shape). `type` is a URL — the dispatch key to the
 * typed subclass. Extensions (e.g. `violations`, `retry_after`, `request_id`) ride
 * along on the index signature.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
}

/** Response headers as undici delivers them (lowercased keys). */
export type ResponseHeaders = Record<string, string | string[] | undefined>;

/**
 * Minimal structural view of an HTTP error response. Matches undici's
 * `Dispatcher.ResponseData` (statusCode/headers/body with a `text()` reader), so
 * `APIError.fromResponse` works both against the live transport and synthetic test
 * objects — no network required.
 */
export interface APIErrorResponse {
  statusCode: number;
  headers: ResponseHeaders;
  body: { text(): Promise<string> };
}

/** Header carrying the per-request correlation id, surfaced as `error.request_id`. */
const REQUEST_ID_HEADER = 'x-request-id';

// ── Base ────────────────────────────────────────────────────────────────────

/** Root of every error thrown by the SDK. */
export class DinieError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

/** Base for everything that originates from talking to the Dinie API. */
export class APIError extends DinieError {
  /**
   * Build the right error from an HTTP error response: dispatch by Problem Details
   * `type` URL (D#1 catalog), fall back to the HTTP status. Reads the body once.
   */
  static async fromResponse(res: APIErrorResponse): Promise<APIError> {
    const status = res.statusCode;
    const raw = await readBodyText(res.body);
    const parsed = parseJson(raw);
    const record = asRecord(parsed);

    // Preserve the full Problem Details payload (title/detail/instance/violations…),
    // or the raw text when the body is not a JSON object.
    const body: ProblemDetails | string | null =
      record !== null ? (record as ProblemDetails) : raw.length > 0 ? raw : null;

    const typeUrl =
      record !== null && typeof record['type'] === 'string' ? record['type'] : undefined;
    const bodyRequestId =
      record !== null && typeof record['request_id'] === 'string' ? record['request_id'] : null;
    const requestId = headerRequestId(res.headers) ?? bodyRequestId;

    const ctor =
      (typeUrl !== undefined ? TYPE_URL_TO_CLASS[typeUrl] : undefined) ??
      STATUS_TO_CLASS[status] ??
      fallbackCtor(status);

    return new ctor(status, body, res.headers, requestId);
  }
}

// ── Transport-level (no HTTP response) ────────────────────────────────────────

/** A request never produced a response (DNS failure, socket reset, abort…). */
export class APIConnectionError extends APIError {
  constructor({ message, cause }: { message?: string; cause?: unknown } = {}) {
    super(message ?? 'Connection error.', { cause });
  }
}

/** The request exceeded the configured timeout. */
export class APITimeoutError extends APIConnectionError {
  constructor({ message }: { message?: string } = {}) {
    super({ message: message ?? 'Request timed out.' });
  }
}

// ── HTTP status errors ────────────────────────────────────────────────────────

/** The API returned a non-2xx response. Carries the full error envelope. */
export class APIStatusError extends APIError {
  /** HTTP status code of the response. */
  readonly status: number;
  /** Raw response headers (lowercased keys). */
  readonly headers: ResponseHeaders;
  /** Parsed Problem Details payload, the raw body text, or null. */
  readonly body: ProblemDetails | string | null;
  /** Per-request correlation id, from the response header or body. */
  readonly request_id: string | null;

  /** Problem Details `type` URL, when present. */
  readonly type: string | undefined;
  /** Problem Details `title`, when present. */
  readonly title: string | undefined;
  /** Problem Details `detail`, when present. */
  readonly detail: string | undefined;
  /** Problem Details `instance`, when present. */
  readonly instance: string | undefined;

  constructor(
    status: number,
    body: ProblemDetails | string | null,
    headers: ResponseHeaders,
    request_id: string | null,
  ) {
    super(APIStatusError.makeMessage(status, body, request_id));
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.request_id = request_id;

    const pd = problemDetails(body);
    this.type = pd?.type;
    this.title = pd?.title;
    this.detail = pd?.detail;
    this.instance = pd?.instance;
  }

  private static makeMessage(
    status: number,
    body: ProblemDetails | string | null,
    request_id: string | null,
  ): string {
    const pd = problemDetails(body);
    const summary =
      pd?.detail ?? pd?.title ?? (typeof body === 'string' && body.length > 0 ? body : undefined);
    const suffix = request_id !== null ? ` (request_id: ${request_id})` : '';
    return summary !== undefined
      ? `${status} ${summary}${suffix}`
      : `${status} status code (no body)${suffix}`;
  }
}

export class BadRequestError extends APIStatusError {}
export class AuthError extends APIStatusError {}
export class PermissionError extends APIStatusError {}
export class NotFoundError extends APIStatusError {}
export class ConflictError extends APIStatusError {}
export class ValidationError extends APIStatusError {}
/** A 422 whose `type` URL marks an idempotency-key reuse. Subclass of ValidationError. */
export class IdempotencyKeyReuseError extends ValidationError {}
export class RateLimitError extends APIStatusError {}
export class ServerError extends APIStatusError {}
export class ServiceUnavailableError extends APIStatusError {}

// ── Outside the APIError tree (D11) ───────────────────────────────────────────

/** OAuth2 client-credentials token acquisition/refresh failed. */
export class OAuthError extends DinieError {}
/** A webhook payload failed signature verification. */
export class WebhookSignatureError extends DinieError {}
/** A webhook timestamp fell outside the tolerance window. */
export class WebhookTimestampError extends DinieError {}

// ── Dispatch tables ───────────────────────────────────────────────────────────

type APIStatusErrorConstructor = new (
  status: number,
  body: ProblemDetails | string | null,
  headers: ResponseHeaders,
  request_id: string | null,
) => APIStatusError;

/** D#1 error catalog: RFC 9457 `type` URL → typed subclass (checked before status). */
const TYPE_URL_TO_CLASS: Record<string, APIStatusErrorConstructor> = {
  'https://docs.dinie.com.br/errors/authentication-error': AuthError,
  'https://docs.dinie.com.br/errors/permission-denied': PermissionError,
  'https://docs.dinie.com.br/errors/not-found': NotFoundError,
  'https://docs.dinie.com.br/errors/conflict': ConflictError,
  'https://docs.dinie.com.br/errors/validation-error': ValidationError,
  'https://docs.dinie.com.br/errors/idempotency-key-reuse': IdempotencyKeyReuseError,
  'https://docs.dinie.com.br/errors/rate-limit-exceeded': RateLimitError,
  'https://docs.dinie.com.br/errors/internal-error': ServerError,
  'https://docs.dinie.com.br/errors/service-unavailable': ServiceUnavailableError,
};

/** HTTP status → typed subclass (fallback when the `type` URL is absent/unknown). */
const STATUS_TO_CLASS: Record<number, APIStatusErrorConstructor> = {
  400: BadRequestError,
  401: AuthError,
  403: PermissionError,
  404: NotFoundError,
  409: ConflictError,
  422: ValidationError,
  429: RateLimitError,
  500: ServerError,
  503: ServiceUnavailableError,
};

/** Last resort when neither the `type` URL nor the exact status is mapped. */
function fallbackCtor(status: number): APIStatusErrorConstructor {
  return status >= 500 ? ServerError : APIStatusError;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function problemDetails(body: ProblemDetails | string | null): ProblemDetails | undefined {
  return typeof body === 'object' && body !== null ? body : undefined;
}

function headerRequestId(headers: ResponseHeaders): string | null {
  const raw = headers[REQUEST_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? null;
}

async function readBodyText(body: { text(): Promise<string> }): Promise<string> {
  try {
    return await body.text();
  } catch {
    return '';
  }
}

function parseJson(raw: string): unknown {
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
