// Barrel for the generated layer (hand-authored in V0.1, generated from V0.4 — D1).
// Mirrors `openapi.yaml`: the client, generated types/events, and the server-response
// error catalog. This layer imports only from runtime/ — never the reverse (architecture
// §6, §9.1; the two controlled inverse imports live in runtime/http.ts and
// runtime/webhooks.ts — story 011).
//
// Entries are ordered alphabetically by module path so the V0.4 generator produces a
// minimal diff (determinism — architecture §7/§12).
//
// Intentionally ABSENT:
//   - `Customers` — composed internally by `Dinie`, not public surface (criterion A).
//   - `Webhooks` — lives in runtime/ (which owns the verification mechanism); re-exported
//     from `src/index.ts` directly (criterion C).
//   - the `*Wire` types + `serialize*`/`deserialize*` functions (story 002) — the casing
//     bridge is an implementation detail consumed by resources/conformance via direct
//     module import, not partner surface. Only the camelCase model + request types ship.

export { Dinie } from './client.js';
export * from './errors/index.js';
export type { CustomerCreatedEvent, WebhookEvent } from './events/customer-created.js';
export type { CreditOffer, CreditOfferStatus } from './types/credit-offer.js';
export type {
  CreateCustomerRequest,
  Customer,
  CustomerListParams,
  CustomerStatus,
  UpdateCustomerRequest,
} from './types/customer.js';
export type {
  ApiClientId,
  BankAccountId,
  CreditOfferId,
  CustomerId,
  EventId,
  LoanId,
  SimulationId,
  TransactionId,
  WebhookEndpointId,
} from './types/ids.js';
export type { Money } from './types/money.js';
