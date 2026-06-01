// Curated public barrel — the single entry point consumers import from
// (`import { Dinie, Webhooks } from '@dinie/sdk'`). It RE-EXPORTS; it never RESTATES
// (story 011). Everything derived from `openapi.yaml` — the client, the resource/event
// types, and the server-response error catalog — flows out automatically via
// `export * from './generated/index.js'`. The runtime contributes a curated set of
// mechanism exports: the webhook verifier, pagination, the error base hierarchy + the
// client-side errors, and the config/option types. Internals (`HttpClient`,
// `TokenManager`, the case-agnostic transport-shape types, the error registry) are
// deliberately NOT exported (architecture §6, §7, §9.1).

// openapi-derived surface — `Dinie`, resource/event types, the server-response error
// catalog (the 8 typed classes). Importing the package registers the catalog with
// `APIError.fromResponse` (each class self-registers — story 011).
export * from './generated/index.js';

// Webhooks lives in runtime (it owns the verification mechanism); `Webhooks.extract`
// returns the generated `WebhookEvent` union, typed inside `runtime/webhooks.ts` via the
// controlled inverse import. So it is re-exported from runtime, not generated.
export { Webhooks } from './runtime/index.js';

// Pagination — `Page`/`PagePromise` are public surface (`list()` returns a `PagePromise`).
export { Page, PagePromise } from './runtime/index.js';

// APIPromise — dual-natured return of every non-list method (D15): `await` for the parsed
// body, or `.asResponse()`/`.withResponse()` for the underlying HTTP response.
export { APIPromise } from './runtime/index.js';
export type { APIResponse, HttpResponse } from './runtime/index.js';

// Error MECHANISM — the base hierarchy + the client-side errors (no server response to
// describe). The server-response catalog is part of the generated surface above.
export {
  DinieError,
  APIError,
  APIStatusError,
  APIConnectionError,
  APITimeoutError,
  OAuthError,
  WebhookSignatureError,
  WebhookTimestampError,
  UnknownWebhookEventError,
} from './runtime/index.js';

// Retry helper — `parseRetryAfter` (story 012): parse `err.headers['retry-after']` after
// catching a `RateLimitError` for custom post-catch logic (the retry loop already respects
// it internally). The generated catalog classes stay minimal typed markers.
export { parseRetryAfter } from './runtime/index.js';

// Config / option types.
export type { DinieConfig, Logger, LogLevel, RateLimit, RequestOptions } from './runtime/index.js';
