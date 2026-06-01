/**
 * `APIPromise<T>` — the dual-natured return value of every non-list method (D15).
 *
 * A method like `customers.get(id)` returns an `APIPromise<Customer>`: it is a
 * `PromiseLike<T>` (so `await client.customers.get(id)` yields the `Customer`), and it
 * ALSO exposes the underlying HTTP response without a second round-trip:
 *
 *   - `await p`                → `T` (the parsed, camelCase body)
 *   - `await p.asResponse()`   → `HttpResponse` (status + headers, no body re-read)
 *   - `await p.withResponse()` → `{ data: T, response: HttpResponse }`
 *
 * V0.1 only had this dual nature on `list()` (via `PagePromise`). V0.2 generalizes the
 * pattern here so EVERY method has a consistent `.withResponse()`/`.asResponse()` surface
 * (architecture §7.6, D15); `paginator.ts` composes this module for the same reason.
 *
 * ── Deferred execution + single body read ──
 * The transport request is in flight by the time an `APIPromise` is constructed (the
 * `responsePromise` is already running), but the body is read + parsed LAZILY and exactly
 * ONCE: the first `.then()`/`.asResponse()`/`.withResponse()` triggers the read, and every
 * later consumer reuses the memoized result. `.asResponse()` still drains the body (via the
 * parser) so the connection is freed even when the caller only wants headers. This mirrors
 * `openai-node/src/core/api-promise.ts` adapted to undici's single-read body.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `runtime/`. Imports only the transport-shape `ResponseHeaders` type from
 * `errors.js` (erased at compile time). `APIPromise` + the `HttpResponse`/`APIResponse`
 * result types ARE public surface (re-exported via `runtime/index.ts`); `RawResponse` is a
 * transport-internal seam consumed by `http.ts` and is NOT re-exported.
 */

import type { ResponseHeaders } from './errors.js';

/**
 * Minimal structural view of a raw transport response — matches undici's
 * `Dispatcher.ResponseData` (statusCode/headers + a single-read `body` with `text()`/
 * `dump()`). Transport-internal: `http.ts` feeds these to {@link APIPromise.fromResponse};
 * never re-exported from the runtime barrel.
 */
export interface RawResponse {
  statusCode: number;
  headers: ResponseHeaders;
  body: { text(): Promise<string>; dump(): Promise<void> };
}

/**
 * The HTTP response as surfaced by `.asResponse()`/`.withResponse()`: status + headers.
 * The body is not exposed here — it was already consumed to produce the parsed `data`
 * (undici bodies are single-read). Read `data` for the body; read `headers` for transport
 * metadata (rate-limit, `x-request-id`, …).
 */
export interface HttpResponse {
  status: number;
  headers: ResponseHeaders;
}

/** The parsed body paired with its response metadata — the result of `.withResponse()`. */
export interface APIResponse<T> {
  data: T;
  response: HttpResponse;
}

/**
 * A `PromiseLike<T>` that defers body parsing and also exposes the raw HTTP response.
 * Construct via {@link APIPromise.fromResponse} (from a transport response + a body parser)
 * or {@link APIPromise.fromParsed} (from an already-parsed result, used by `_thenUnwrap`
 * and the paginator). `_thenUnwrap` maps the data while preserving the response.
 */
export class APIPromise<T> implements PromiseLike<T> {
  /** Produces the parsed `{ data, response }` lazily; memoized in {@link parse}. */
  readonly #produce: () => Promise<APIResponse<T>>;
  /** Memoized parse — the body is read at most once across every consumer. */
  #parsed: Promise<APIResponse<T>> | undefined;

  private constructor(produce: () => Promise<APIResponse<T>>) {
    this.#produce = produce;
  }

  /**
   * Build from a raw transport response promise + a body parser. The body read is deferred
   * to the first consumption and runs exactly once. Used by `HttpClient.request`.
   */
  static fromResponse<T>(
    responsePromise: Promise<RawResponse>,
    parseData: (raw: RawResponse) => T | Promise<T>,
  ): APIPromise<T> {
    return new APIPromise<T>(() =>
      responsePromise.then(async (raw) => ({
        data: await parseData(raw),
        response: { status: raw.statusCode, headers: raw.headers },
      })),
    );
  }

  /**
   * Build from an already-resolved `{ data, response }` thunk (deferred + memoized). Used by
   * {@link _thenUnwrap} and by `PagePromise` (paginator.ts) to compose the dual nature
   * around the first page.
   */
  static fromParsed<T>(produce: () => Promise<APIResponse<T>>): APIPromise<T> {
    return new APIPromise<T>(produce);
  }

  /** Run (once) and memoize the parse. */
  #parse(): Promise<APIResponse<T>> {
    this.#parsed ??= this.#produce();
    return this.#parsed;
  }

  /**
   * Map the parsed `data` to `U`, preserving the response. Returns a new `APIPromise<U>`
   * that shares this one's memoized body read — the body is never read twice. This is how a
   * resource turns a wire-shaped `APIPromise<Wire>` into a camelCase `APIPromise<Model>`
   * without losing `.withResponse()`.
   */
  _thenUnwrap<U>(transform: (data: T, response: HttpResponse) => U | Promise<U>): APIPromise<U> {
    return APIPromise.fromParsed<U>(() =>
      this.#parse().then(async ({ data, response }) => ({
        data: await transform(data, response),
        response,
      })),
    );
  }

  /** The raw HTTP response (status + headers). Drains the body so the connection is freed. */
  asResponse(): Promise<HttpResponse> {
    return this.#parse().then((parsed) => parsed.response);
  }

  /** Both the parsed body and the response metadata. */
  withResponse(): Promise<APIResponse<T>> {
    return this.#parse().then((parsed) => ({ data: parsed.data, response: parsed.response }));
  }

  // ── PromiseLike<T> surface (delegated to the memoized parse, unwrapping to `data`) ──

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this.#parse()
      .then((parsed) => parsed.data)
      .then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<T | TResult> {
    return this.#parse()
      .then((parsed) => parsed.data)
      .catch(onrejected);
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<T> {
    return this.#parse()
      .then((parsed) => parsed.data)
      .finally(onfinally);
  }

  get [Symbol.toStringTag](): string {
    return 'APIPromise';
  }
}
