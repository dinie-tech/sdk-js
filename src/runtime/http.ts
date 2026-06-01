/**
 * `HttpClient` — the request-lifecycle orchestrator (story 007).
 *
 * This is the module that *stitches the runtime together*. It owns the
 * `undici.Dispatcher` (default a real `Pool`; tests inject a `MockAgent` — D3) and,
 * for every logical request, runs the full lifecycle:
 *
 *   1. mint an Idempotency-Key ONCE, before the loop, for non-GET requests (D9) so
 *      every retry of the same logical request reuses it (never a duplicate resource);
 *   2. obtain a Bearer token from the `TokenManager` (lazy + concurrency-safe — D6);
 *   3. assemble headers (auth, telemetry, idempotency, retry-count, content-type);
 *   4. dispatch through the injected `Dispatcher`;
 *   5. fold rate-limit headers into the tracker `client.rate_limit` reads (story 009);
 *   6. on success, parse and return the typed body;
 *   7. on 401, run the one-shot re-auth (`invalidate()` + fresh token), then give up
 *      with `AuthError` if a second 401 follows (D6 — no loop);
 *   8. on a retryable status (`{408,429,500,502,503,504}` — D8) or a transient transport
 *      error, back off (`retryDelay`) and retry while attempts remain, bumping
 *      `X-Dinie-Retry-Count`;
 *   9. otherwise map the response to a typed error via `APIError.fromResponse`.
 *
 * The browser guard and env-var resolution live in `client.ts` (story 009); this
 * module is pure transport. Mirrors `openai-node/src/client.ts` (makeRequest/
 * buildRequest/retry).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `runtime/`, imports sibling runtime modules + `undici`, plus ONE controlled
 * inverse import (see below). `HttpClient`, `InternalRequest` and `ListEnvelope` are
 * runtime-internal and consumed directly by `generated/` (client/resources/paginator) —
 * deliberately NOT re-exported from the runtime barrel. Only the config/option *types*
 * (`DinieConfig`, `RequestOptions`) are public (re-exported via `runtime/index.ts`).
 *
 * ── controlled inverse import (openapi-SoT forcing function — story 011) ──
 * The general rule is "runtime/ never imports generated/". `http.ts` is one of two
 * declared exceptions (the other is `webhooks.ts`). It EMITS the typed server-response
 * errors whose source of truth is `openapi.yaml`, so those classes live in
 * `generated/errors/`. Importing them here does two things:
 *   1. registers the whole catalog with `APIError.fromResponse` at load time (each class
 *      self-registers its `type` URL + status), so dispatch works whenever the transport
 *      is used, regardless of how the consumer reached it; and
 *   2. is the forcing function: if an error is not in openapi, `generated/errors` does
 *      not define it, this import does not resolve, and `tsc` fails — forcing the openapi
 *      conversation before any new server-response error can be thrown.
 */

import type { Dispatcher } from 'undici';
import { Pool } from 'undici';

import { APIPromise, type RawResponse } from './api-promise.js';
import { APIError, APIConnectionError, APITimeoutError } from './errors.js';
// Controlled inverse import — see the boundary note above. `AuthError` is thrown directly
// on a persistent 401; importing the barrel also registers the full catalog.
import { AuthError } from '../generated/errors/index.js';
import { generateIdempotencyKey } from './idempotency.js';
import { RuntimeLogger, newRequestLogID, type LogLevel, type Logger } from './logger.js';
import { RateLimitTracker, type RateLimit } from './rate-limit.js';
import { isRetryableNetworkError, retryDelay, shouldRetry } from './retry.js';
import { TokenManager } from './token-manager.js';

// ── Public config / options (re-exported via runtime barrel — architecture §4.1) ──

/**
 * Construction config for the SDK. Defined here (the transport owns it) and
 * re-exported as public surface via `src/index.ts` (story 009). Credential/env-var
 * resolution and the browser guard happen in `client.ts`; this type is the resolved
 * shape `HttpClient` consumes.
 */
export interface DinieConfig {
  /** OAuth2 client id (or env `DINIE_CLIENT_ID`, resolved by `client.ts`). */
  clientId: string;
  /** OAuth2 client secret (or env `DINIE_CLIENT_SECRET`, resolved by `client.ts`). */
  clientSecret: string;
  /** API base URL. Defaults to production; or env `DINIE_BASE_URL`. */
  baseUrl?: string;
  /** Per-request timeout in ms. Default `30_000`. */
  timeout?: number;
  /** Max retry attempts after the first try. Default `3`. */
  maxRetries?: number;
  /** Log verbosity. Default `'off'`; or env `DINIE_LOG`. */
  logLevel?: LogLevel;
  /** Custom log sink. Defaults to `console`. */
  logger?: Logger;
  /**
   * Auto-generate an `X-Idempotency-Key` on every non-GET write. Default `true` (D9). Set
   * `false` to opt out globally — a documented foot-gun in a fintech SDK: without a stable
   * key a retried `POST` can create a duplicate resource. A per-call
   * `RequestOptions.idempotencyKey` is still honored even when this is `false`.
   */
  idempotency?: boolean;
  /** Injected transport (D3 test seam). Defaults to `new Pool(origin)`. */
  dispatcher?: Dispatcher;
}

/** Per-call overrides layered on top of `DinieConfig`. */
export interface RequestOptions {
  /** Override the auto-generated Idempotency-Key (non-GET only). */
  idempotencyKey?: string;
  /** Caller cancellation (sketch in V0.1; freezes in V0.2 — open question #14). */
  signal?: AbortSignal;
  /** Override the client timeout for this call (ms). */
  timeout?: number;
  /** Override the client `maxRetries` for this call. */
  maxRetries?: number;
  /** Extra headers; a `null` value *removes* a default header. */
  headers?: Record<string, string | null>;
}

// ── Internal request descriptor (consumed by generated/ resources + paginator) ──

/** Query-string parameters; `undefined`/`null` entries are dropped. */
export type QueryParams = Record<string, string | number | boolean | undefined | null>;

/**
 * What a resource/paginator hands to `request`/`requestPage`. `idempotent` flags a
 * non-GET that should carry an auto-generated Idempotency-Key (architecture §6).
 */
export interface InternalRequest {
  method: Dispatcher.HttpMethod;
  /** Path relative to the origin, e.g. `/v3/customers`. */
  path: string;
  /** Query params appended to the path (cursor pagination, list filters). */
  query?: QueryParams;
  /** Request body; objects are JSON-serialized. Absent for GET. */
  body?: unknown;
  /** True for non-GET writes that must carry a stable Idempotency-Key (D9). */
  idempotent: boolean;
  /** Per-call overrides. */
  options?: RequestOptions;
}

/**
 * Wire envelope of a list endpoint (architecture §4.3). Returned by `requestPage`
 * for the paginator (story 008) to build `Page<T>` from. `has_more` — never
 * `data.length` — is the source of truth for the end of pagination.
 */
export interface ListEnvelope<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
}

/**
 * Internal-only seams, kept off `DinieConfig` so the public surface stays clean.
 * `client.ts` constructs `new HttpClient(config)`; tests may inject a `sleep` spy to
 * assert backoff/`Retry-After` timing without real waiting.
 */
export interface HttpClientInternals {
  /** Override the backoff sleep (tests inject an instant, asserting spy). */
  sleep?: (ms: number) => Promise<void>;
}

/** Default production API base URL (overridable via config/env). */
export const DEFAULT_BASE_URL = 'https://api.dinie.com.br';
/** Default per-request timeout, in ms. */
const DEFAULT_TIMEOUT_MS = 30_000;
/** Default retry budget after the first attempt. */
const DEFAULT_MAX_RETRIES = 3;

/** SDK semver — hardcoded in V0.1 (comes from `generated/.metadata.json` at V0.4). */
const SDK_VERSION = '0.1.0';
/** API version pin — placeholder in V0.1 (also generator-sourced at V0.4). */
const API_VERSION = '2026-05-10';
/** Runtime version for telemetry (e.g. `20.11.0`). */
const NODE_VERSION = process.versions.node;
/** `User-Agent` sent on every request (architecture §5.1). */
const USER_AGENT = `Dinie-SDK-JS/${SDK_VERSION} (api-version=${API_VERSION}; node/${NODE_VERSION})`;

/**
 * Owns the transport and orchestrates each request's lifecycle. Runtime-internal:
 * `client.ts`/resources/paginator construct and call it; it is not part of the public
 * SDK surface.
 */
export class HttpClient {
  /** API origin (scheme + host), derived from `baseUrl`; handed to the dispatcher. */
  readonly #origin: string;
  readonly #dispatcher: Dispatcher;
  readonly #tokenManager: TokenManager;
  readonly #logger: RuntimeLogger;
  readonly #rateLimit: RateLimitTracker;
  readonly #timeout: number;
  readonly #maxRetries: number;
  /** Auto-generate `X-Idempotency-Key` on non-GET writes (D9). Default `true`; opt-out via config. */
  readonly #idempotency: boolean;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(config: DinieConfig, internals: HttpClientInternals = {}) {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.#origin = new URL(baseUrl).origin;
    this.#timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this.#maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.#idempotency = config.idempotency ?? true;
    this.#sleep = internals.sleep ?? defaultSleep;

    // The client owns the dispatcher; the TokenManager rides the SAME transport so
    // token + resource calls share one connection pool / mock agent.
    this.#dispatcher = config.dispatcher ?? new Pool(this.#origin);
    this.#tokenManager = new TokenManager({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      baseUrl,
      dispatcher: this.#dispatcher,
    });
    this.#logger = new RuntimeLogger({
      ...(config.logLevel !== undefined ? { level: config.logLevel } : {}),
      ...(config.logger !== undefined ? { logger: config.logger } : {}),
    });
    this.#rateLimit = new RateLimitTracker();
  }

  /** Latest rate-limit snapshot (read by `client.rate_limit`); `null` before the first response. */
  get rateLimit(): RateLimit | null {
    return this.#rateLimit.snapshot;
  }

  /**
   * Run one logical request end-to-end. Returns a dual-natured {@link APIPromise} (D15):
   * `await` it for the parsed body `T`, or call `.asResponse()` / `.withResponse()` for the
   * underlying HTTP response. The body is read + parsed lazily and exactly once.
   *
   * The returned promise rejects with:
   * @throws {APIError} A typed subclass for any non-2xx response that is not retried.
   * @throws {AuthError} A 401 that persists after the one-shot re-auth.
   * @throws {APITimeoutError} The request timed out and the retry budget is exhausted.
   * @throws {APIConnectionError} A transport failure (or caller cancellation).
   */
  request<T>(req: InternalRequest): APIPromise<T> {
    return APIPromise.fromResponse<T>(this.#execute(req), (raw) => parseBody<T>(raw));
  }

  /**
   * Resolve the `X-Idempotency-Key` for a request (D9). A per-call override always wins —
   * even when auto-idempotency is opted out globally (`config.idempotency: false`), an
   * explicit `options.idempotencyKey` is an explicit opt-in. Otherwise a key is auto-minted
   * for non-GET writes unless opted out. Returns `undefined` when no key should be sent.
   */
  #resolveIdempotencyKey(req: InternalRequest): string | undefined {
    if (!req.idempotent) return undefined;
    if (req.options?.idempotencyKey !== undefined) return req.options.idempotencyKey;
    if (!this.#idempotency) return undefined;
    return generateIdempotencyKey();
  }

  /**
   * Run the request lifecycle — mint the Idempotency-Key once before the loop (D9), obtain a
   * Bearer token, assemble headers, dispatch, fold rate-limit headers, then retry/re-auth as
   * needed — and resolve to the raw successful response with its body UNREAD (the
   * {@link APIPromise} from {@link request} reads + parses it). Non-2xx responses that are
   * not retried reject here with a typed {@link APIError}.
   */
  async #execute(req: InternalRequest): Promise<RawResponse> {
    // Idempotency-Key ONCE, before the loop (D9): a non-GET reuses the same key
    // across every retry so a retry never creates a duplicate resource.
    const idempotencyKey = this.#resolveIdempotencyKey(req);
    const maxRetries = req.options?.maxRetries ?? this.#maxRetries;
    const timeout = req.options?.timeout ?? this.#timeout;
    const requestLogID = newRequestLogID();
    const path = buildPath(req.path, req.query);
    const url = `${this.#origin}${path}`;
    const serialized = serializeBody(req.body);

    let reauthed = false;

    for (let attempt = 0; ; attempt++) {
      const token = await this.#tokenManager.getAccessToken();
      const headers = this.buildHeaders(
        req,
        token,
        idempotencyKey,
        attempt,
        serialized?.contentType,
      );
      this.#logger.logRequest({
        method: req.method,
        url,
        headers,
        ...(serialized !== undefined ? { body: serialized.body } : {}),
        requestLogID,
        attempt,
        retryOf: attempt > 0 ? requestLogID : undefined,
      });

      const abort = makeAbort(timeout, req.options?.signal);
      const startedAt = Date.now();
      let res: Dispatcher.ResponseData;
      try {
        res = await this.#dispatcher.request({
          origin: this.#origin,
          path,
          method: req.method,
          headers,
          signal: abort.signal,
          ...(serialized !== undefined ? { body: serialized.body } : {}),
        });
      } catch (err) {
        // Caller cancellation (their own signal) is never retried — surface it.
        const userAborted = req.options?.signal?.aborted === true && !abort.timedOut();
        if (userAborted) {
          throw new APIConnectionError({
            message: 'Request was aborted by the caller.',
            cause: err,
          });
        }
        // Timeout or transient transport error → retry while attempts remain.
        const timedOut = abort.timedOut();
        if ((timedOut || isRetryableNetworkError(err)) && attempt < maxRetries) {
          await this.#sleep(retryDelay(attempt));
          continue;
        }
        throw timedOut ? new APITimeoutError() : asConnectionError(err);
      } finally {
        abort.cleanup();
      }

      this.#rateLimit.update(res.headers);
      this.#logger.logResponse({
        status: res.statusCode,
        url,
        headers: res.headers,
        durationMs: Date.now() - startedAt,
        requestLogID,
        attempt,
        retryOf: attempt > 0 ? requestLogID : undefined,
      });

      if (res.statusCode < 300) {
        // Success: hand the raw response back with its body UNREAD — APIPromise parses it
        // lazily (so `.asResponse()` works and the body is read at most once).
        return res;
      }

      // 401 one-shot (D6): drop the token, re-auth once, retry.
      if (res.statusCode === 401 && !reauthed) {
        this.#tokenManager.invalidate();
        reauthed = true;
        await drainBody(res);
        continue;
      }
      // Persistent 401 after the one-shot re-auth (D6): give up with a typed AuthError —
      // no loop. Forcing `AuthError` (from generated/errors) guarantees the type even if
      // the body lacks the openapi `type` URL.
      if (res.statusCode === 401) {
        throw await APIError.fromResponse(res, AuthError);
      }

      if (shouldRetry(res.statusCode) && attempt < maxRetries) {
        const retryAfter = headerValue(res.headers, 'retry-after');
        await drainBody(res);
        await this.#sleep(retryDelay(attempt, retryAfter));
        continue;
      }

      throw await APIError.fromResponse(res);
    }
  }

  /**
   * List variant consumed by the paginator (story 008) / `Customers.list`. Same lifecycle as
   * {@link request}; the body type is pinned to the wire list envelope so the paginator can
   * read `data`/`has_more` without re-casting. Returns an {@link APIPromise} (dual-natured):
   * `await` it for the envelope, or `.asResponse()`/`.withResponse()` for the response — the
   * paginator threads that response into `PagePromise.withResponse()`.
   */
  requestPage<T>(req: InternalRequest): APIPromise<ListEnvelope<T>> {
    return this.request<ListEnvelope<T>>(req);
  }

  /**
   * Assemble the outgoing header set: Bearer auth, telemetry (`User-Agent`,
   * `X-Dinie-SDK-*`), the Idempotency-Key (when present), `X-Dinie-Retry-Count` on
   * retries, and `Content-Type` when there is a body. A caller header with a `null`
   * value *removes* the matching default; any other value overrides it.
   */
  buildHeaders(
    req: InternalRequest,
    token: string,
    idempotencyKey: string | undefined,
    attempt: number,
    contentType: string | undefined,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'user-agent': USER_AGENT,
      'x-dinie-sdk-language': 'javascript',
      'x-dinie-sdk-version': SDK_VERSION,
      'x-dinie-sdk-runtime': `node/${NODE_VERSION}`,
    };
    if (contentType !== undefined) headers['content-type'] = contentType;
    // `X-Idempotency-Key` per the openapi `IdempotencyKey` parameter (R4/D9). Sent lowercased
    // on the wire; was `idempotency-key` in the V0.1 sketch.
    if (idempotencyKey !== undefined) headers['x-idempotency-key'] = idempotencyKey;
    if (attempt > 0) headers['x-dinie-retry-count'] = String(attempt);

    // Caller overrides: `null` removes a default header; any string replaces it.
    const overrides = req.options?.headers;
    if (overrides !== undefined) {
      for (const [key, value] of Object.entries(overrides)) {
        const lower = key.toLowerCase();
        if (value === null) delete headers[lower];
        else headers[lower] = value;
      }
    }
    return headers;
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Default backoff sleep. Swapped for an instant spy in tests via `HttpClientInternals`. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
  });
}

/** Append serialized query params to a path, skipping `undefined`/`null` values. */
function buildPath(path: string, query?: QueryParams): string {
  if (query === undefined) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  if (qs === '') return path;
  return `${path}${path.includes('?') ? '&' : '?'}${qs}`;
}

/** Serialize a request body to a string + its `Content-Type`, or `undefined` when absent. */
function serializeBody(body: unknown): { body: string; contentType: string } | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return { body, contentType: 'application/json' };
  return { body: JSON.stringify(body), contentType: 'application/json' };
}

/** Read + parse a successful response body to `T` (JSON, or raw text fallback). */
async function parseBody<T>(res: RawResponse): Promise<T> {
  if (res.statusCode === 204) {
    await drainBody(res);
    return undefined as T;
  }
  const text = await res.body.text();
  if (text.length === 0) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** Drain + discard a response body so the connection is freed (retry/reauth paths). */
async function drainBody(res: RawResponse): Promise<void> {
  try {
    await res.body.dump();
  } catch {
    /* best-effort — nothing to release on a synthetic/aborted body */
  }
}

/** First value of a (possibly repeated) response header, case-sensitive lowercased key. */
function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Error `name`s/`code`s that mean "timed out" (vs. a generic connection failure). */
function isTimeoutError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const candidate = err as { name?: unknown; code?: unknown };
  if (candidate.name === 'TimeoutError') return true;
  return (
    typeof candidate.code === 'string' &&
    (candidate.code === 'UND_ERR_HEADERS_TIMEOUT' || candidate.code === 'UND_ERR_BODY_TIMEOUT')
  );
}

/** Map an exhausted/non-retryable transport error to the right connection-error class. */
function asConnectionError(err: unknown): APIConnectionError {
  if (isTimeoutError(err)) return new APITimeoutError();
  const message = err instanceof Error ? err.message : undefined;
  return new APIConnectionError({
    ...(message !== undefined ? { message } : {}),
    cause: err,
  });
}

// ── Timeout / cancellation control (extracted to avoid closure leaks — §6 hint) ──

interface AbortControl {
  /** The combined signal handed to the dispatcher (timeout ∪ caller signal). */
  signal: AbortSignal;
  /** Whether the abort fired because of the per-request timeout. */
  timedOut(): boolean;
  /** Clear the timer + detach the caller-signal listener (must run on every path). */
  cleanup(): void;
}

/**
 * Build the combined abort for one attempt: a timeout timer plus the caller's optional
 * signal. Extracted to a standalone function (not an inline closure) so the listener
 * and timer are always detached via `cleanup()` — no memory leak across retries.
 */
function makeAbort(timeoutMs: number, userSignal?: AbortSignal): AbortControl {
  const controller = new AbortController();
  let timedOut = false;

  const onTimeout = (): void => {
    timedOut = true;
    controller.abort(new DOMException('Request timed out.', 'TimeoutError'));
  };
  const timer = setTimeout(onTimeout, timeoutMs);
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as { unref: () => void }).unref();
  }

  const onUserAbort = (): void => {
    controller.abort(userSignal?.reason);
  };
  if (userSignal !== undefined) {
    if (userSignal.aborted) controller.abort(userSignal.reason);
    else userSignal.addEventListener('abort', onUserAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      if (userSignal !== undefined) userSignal.removeEventListener('abort', onUserAbort);
    },
  };
}
