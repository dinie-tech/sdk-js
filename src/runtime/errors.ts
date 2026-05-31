/**
 * Error MECHANISM — the transport-agnostic base hierarchy, the client-side errors, and
 * the RFC 9457 dispatch registry. The CATALOG of server-response error classes lives in
 * `generated/errors/` because `openapi.yaml` is its source of truth (story 011).
 *
 *   DinieError (base, extends Error)
 *   ├── APIError
 *   │   ├── APIConnectionError          ─┐ client-side: no server response to describe,
 *   │   │   └── APITimeoutError          │ so they live HERE, in runtime/.
 *   │   └── APIStatusError (status, headers, body, request_id, code)
 *   │       └── …server-response catalog (generated/errors/, registered at load time)
 *   └── OAuthError / WebhookSignatureError / WebhookTimestampError  ─┘ (also client-side)
 *
 * ── runtime ↔ generated boundary ──
 * This module NEVER imports `generated/`. It exposes `registerErrorType` /
 * `registerErrorStatus`: each class in `generated/errors/<name>.ts` self-registers at
 * module top-level, so `import = registration`. `APIError.fromResponse` consults the
 * registry (by `type` URL, then by status), falling back to a generic `APIStatusError`.
 * The generated layer (and `runtime/http.ts`, the one declared exception) import the
 * concrete classes — never the reverse for the rest of runtime.
 *
 * `APIError.fromResponse()` reads the RFC 9457 Problem Details body and dispatches by
 * `type` URL (the openapi catalog), falling back to the HTTP status. `request_id` is a
 * first-class attribute on every `APIStatusError` (response header, or body fallback) for
 * the support flow. Mirrors `openai-node/src/core/error.ts`.
 */

/**
 * RFC 9457 Problem Details (wire shape). `type` is a URL — the dispatch key to the typed
 * subclass. Catalog extensions (e.g. `code`, `request_id`) ride along on the index
 * signature.
 *
 * ── Transport-internal (story 011 / criterion D) ──
 * NOT part of the public surface. Consumed directly by this module and `http.ts`; never
 * re-exported from `runtime/index.ts` or `src/index.ts`, so swapping the transport later
 * cannot break consumers.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [extension: string]: unknown;
}

/**
 * Response headers as undici delivers them (lowercased keys). Transport-internal — see
 * {@link ProblemDetails}.
 */
export type ResponseHeaders = Record<string, string | string[] | undefined>;

/**
 * Minimal structural view of an HTTP error response. Matches undici's
 * `Dispatcher.ResponseData` (statusCode/headers/body with a `text()` reader), so
 * `APIError.fromResponse` works both against the live transport and synthetic test
 * objects — no network required. Transport-internal — see {@link ProblemDetails}.
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
   * `type` URL (the openapi catalog), then by HTTP status, then a generic
   * `APIStatusError`. Reads the body once.
   *
   * @param forceCtor - When provided, skip dispatch and build this exact class. Used by
   *   `http.ts` to guarantee an `AuthError` on a persistent 401 regardless of the body
   *   (the openapi-SoT forcing-function import — see `http.ts`).
   */
  static async fromResponse(
    res: APIErrorResponse,
    forceCtor?: APIStatusErrorCtor,
  ): Promise<APIError> {
    const status = res.statusCode;
    const raw = await readBodyText(res.body);
    const parsed = parseJson(raw);
    const record = asRecord(parsed);

    // Preserve the full Problem Details payload (title/detail/instance/code…), or the raw
    // text when the body is not a JSON object.
    const body: ProblemDetails | string | null =
      record !== null ? (record as ProblemDetails) : raw.length > 0 ? raw : null;

    const typeUrl =
      record !== null && typeof record['type'] === 'string' ? record['type'] : undefined;
    const bodyRequestId =
      record !== null && typeof record['request_id'] === 'string' ? record['request_id'] : null;
    const requestId = headerRequestId(res.headers) ?? bodyRequestId;

    const ctor =
      forceCtor ??
      (typeUrl !== undefined ? typeUrlRegistry.get(typeUrl) : undefined) ??
      statusRegistry.get(status) ??
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

/**
 * The API returned a non-2xx response. Carries the full error envelope and is the base
 * the openapi-mirrored catalog (`generated/errors/`) extends.
 */
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
  /**
   * Machine-readable `code` extension from the openapi error catalog, when present.
   * Extracted uniformly here in the base so every catalog class
   * (`generated/errors/`) inherits it without a per-class getter — the body-field
   * extraction the V0.4 generator emits once into the base, not per subclass. Mirrors
   * `code` on `openai-node`'s `APIError`.
   */
  readonly code: string | undefined;

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
    this.code = problemString(body, 'code');
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

// ── Outside the APIError tree (D11) — client-side, no server response ──────────

/** OAuth2 client-credentials token acquisition/refresh failed. */
export class OAuthError extends DinieError {}
/** A webhook payload failed signature verification. */
export class WebhookSignatureError extends DinieError {}
/** A webhook timestamp fell outside the tolerance window. */
export class WebhookTimestampError extends DinieError {}

// ── Dispatch registry (populated by generated/errors at load time) ────────────

/** Constructor shape every server-response error class (`generated/errors/`) satisfies. */
export type APIStatusErrorCtor = new (
  status: number,
  body: ProblemDetails | string | null,
  headers: ResponseHeaders,
  request_id: string | null,
) => APIStatusError;

/** openapi `type` URL → typed class (primary dispatch key, checked before status). */
const typeUrlRegistry = new Map<string, APIStatusErrorCtor>();
/** HTTP status → typed class (dispatch fallback when no `type` URL matches). */
const statusRegistry = new Map<number, APIStatusErrorCtor>();

/**
 * Register a server-response error class under its openapi `type` URL. Called at module
 * top-level by each `generated/errors/<name>.ts` so that importing a class registers it
 * with {@link APIError.fromResponse} — no manual ordering. This is the openapi-SoT seam:
 * the catalog lives in `generated/` (mirrors openapi), the mechanism lives here.
 */
export function registerErrorType(typeUrl: string, ctor: APIStatusErrorCtor): void {
  typeUrlRegistry.set(typeUrl, ctor);
}

/**
 * Register a server-response error class as the fallback for an HTTP status (used when a
 * response carries no `type` URL, or an unknown one). One class may claim several statuses
 * (e.g. `ServerError` registers 500 AND 503).
 */
export function registerErrorStatus(status: number, ctor: APIStatusErrorCtor): void {
  statusRegistry.set(status, ctor);
}

/**
 * Last resort when neither the `type` URL nor the exact status is registered: route any
 * 5xx to whatever class owns 500 (the catalog's `ServerError`), else a generic
 * `APIStatusError`. Keeps the pre-refactor behavior without naming a generated class.
 */
function fallbackCtor(status: number): APIStatusErrorCtor {
  if (status >= 500) return statusRegistry.get(500) ?? APIStatusError;
  return APIStatusError;
}

// ── Helpers (shared with generated/errors for openapi catalog attributes) ─────

/**
 * Read a string extension member from a parsed Problem Details body. Used by the base
 * {@link APIStatusError} constructor to surface openapi-defined attributes such as `code`
 * uniformly across the catalog — runtime-internal, never re-exported.
 */
function problemString(body: ProblemDetails | string | null, key: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = body[key];
  return typeof value === 'string' ? value : undefined;
}

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
