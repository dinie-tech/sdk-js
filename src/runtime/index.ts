// Stable runtime re-exports: error classes, `Webhooks`, config/option types
// (DinieConfig, RequestOptions, RateLimit, LogLevel, Logger), Page/PagePromise.
// Internal HttpClient / TokenManager are NOT re-exported.
// Module stories populate this barrel incrementally.

// Error MECHANISM — base hierarchy + client-side errors (story 002 / 011). The
// server-response catalog lives in `generated/errors/` (openapi-SoT) and reaches the
// public surface via `src/index.ts`'s `export * from './generated/index.js'`. The
// transport-shape types (`ProblemDetails`/`ResponseHeaders`/`APIErrorResponse`) and the
// registration mechanism (`registerErrorType`/`registerErrorStatus`/`problemString`) are
// deliberately NOT re-exported — they stay runtime-internal (criterion D).
export {
  DinieError,
  APIError,
  APIStatusError,
  APIConnectionError,
  APITimeoutError,
  OAuthError,
  WebhookSignatureError,
  WebhookTimestampError,
} from './errors.js';

// Webhooks — Standard Webhooks v1 verification (story 005). `Webhooks.extract` returns the
// concrete `WebhookEvent` union typed straight from `generated/events/` (story 011).
export { Webhooks } from './webhooks.js';
export type { WebhookExtractInput } from './webhooks.js';

// Leaf utilities — public types only (story 004). The generators/trackers/loggers
// themselves are runtime-internal (imported directly by http.ts), not public.
export type { RateLimit } from './rate-limit.js';
export type { LogLevel, Logger } from './logger.js';

// HTTP client config/options (story 007). Only the public config/option TYPES are
// re-exported — the internal `HttpClient`/`InternalRequest`/`ListEnvelope` are
// consumed directly from `./http.js` by the generated layer, never via this barrel.
export type { DinieConfig, RequestOptions } from './http.js';

// Pagination — `Page`/`PagePromise` ARE public surface (a `list()` returns a
// `PagePromise`; §6). The `FetchPage`/`HasId` contract is runtime-internal: the
// generated resource imports it directly from `./paginator.js` to build a `PagePromise`.
export { Page, PagePromise } from './paginator.js';
