// Stable runtime re-exports: error classes, `Webhooks`, config/option types
// (DinieConfig, RequestOptions, RateLimit, LogLevel, Logger), Page/PagePromise.
// Internal HttpClient / TokenManager are NOT re-exported.
// Module stories populate this barrel incrementally.

// Errors — typed hierarchy + RFC 9457 dispatch (story 002).
export * from './errors.js';

// Webhooks — Standard Webhooks v1 verification (story 005). `Webhooks.extract` is
// public surface; the concrete `WebhookEvent` union is bound at the public barrel
// via the `E` type parameter (story 009).
export { Webhooks } from './webhooks.js';
export type { VerifiedWebhookEvent, WebhookExtractInput } from './webhooks.js';

// Leaf utilities — public types only (story 004). The generators/trackers/loggers
// themselves are runtime-internal (imported directly by http.ts), not public.
export type { RateLimit } from './rate-limit.js';
export type { LogLevel, Logger } from './logger.js';
