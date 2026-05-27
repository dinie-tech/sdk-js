// Stable runtime re-exports: error classes, `Webhooks`, config/option types
// (DinieConfig, RequestOptions, RateLimit, LogLevel, Logger), Page/PagePromise.
// Internal HttpClient / TokenManager are NOT re-exported.
// Module stories populate this barrel incrementally.

// Errors — typed hierarchy + RFC 9457 dispatch (story 002).
export * from './errors.js';
