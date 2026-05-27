// Curated public barrel — the single entry point consumers import from
// (`import { Dinie, Webhooks } from '@dinie/sdk'`). It selects what is public: the
// client + typed Webhooks, the resource/event types, the error catalog, pagination, and
// config/option types. Internals (`HttpClient`, `TokenManager`, the case-agnostic runtime
// `Webhooks`, internal request/envelope types) are deliberately NOT exported
// (architecture §6, §9.1).

// Client + typed Webhooks + resource/event types (generated layer — D1).
export { Dinie, Webhooks } from './generated/index.js';
export type {
  Customer,
  CustomerCreateParams,
  CustomerCreatedEvent,
  CustomerListParams,
  WebhookEvent,
} from './generated/index.js';

// Error catalog — the full typed hierarchy (classes + RFC 9457 types) is public.
export * from './runtime/errors.js';

// Pagination — `Page`/`PagePromise` are public surface (`list()` returns a `PagePromise`).
export { Page, PagePromise } from './runtime/index.js';

// Config / option types.
export type { DinieConfig, Logger, LogLevel, RateLimit, RequestOptions } from './runtime/index.js';
