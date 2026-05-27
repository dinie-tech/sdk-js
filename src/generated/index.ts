// Barrel for the generated layer (hand-authored in V0.1, generated from V0.4 — D1).
// Re-exports the client, resource classes, generated types/events, and the typed
// Webhooks binding. This layer imports only from runtime/ — never the reverse
// (architecture §6, §9.1).
//
// Entries are ordered alphabetically by module path so the V0.4 generator produces a
// minimal diff (determinism — architecture §7/§12).

export { Dinie } from './client.js';
export type { CustomerCreatedEvent, WebhookEvent } from './events/customer-created.js';
export { Customers } from './resources/customers.js';
export type { Customer, CustomerCreateParams, CustomerListParams } from './types/customer.js';
export { Webhooks } from './webhooks.js';
