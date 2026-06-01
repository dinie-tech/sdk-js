/**
 * Branded resource ID types — the 9 prefixed string IDs of the Dinie API
 * (architecture §3.2). Hand-authored in V0.2 to mirror what the generator will emit
 * from the V3 OpenAPI `*Id` schemas (V0.4 overwrites this file in place — D1).
 *
 * ── Branding (light, by design) ──
 * Each ID is a plain `string` alias (`type CustomerId = string`), NOT a heavy nominal
 * brand. The prefix is part of the *contract*, not the *type system*: the regex below
 * comes verbatim from each schema's `pattern` and is asserted in tests (and, later, by
 * the conformance harness — story 008), never enforced at the type level. This keeps the
 * surface ergonomic (an ID is assignable from any `string`) while the real shape stays
 * documented and test-checked. Architecture §3.2 / story acceptance: light branding only.
 *
 * ── Patterns come from the schema, never invented ──
 * The `*_ID_PATTERN` constants are the literal `pattern` of each `components.schemas.*Id`
 * in `openapi.yaml` (read at `3fcfd83`). The customer prefix is `cust_` (NOT `cus_` — the
 * V0.1 sketch was wrong; architecture §4 R2). `delivery_id` (the `dlv_…` seen in webhook
 * examples) has NO schema/pattern in the contract — it is a plain string on the event
 * envelope (story 007), so there is deliberately no `DeliveryId` here.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Pure declarations + literal regexes; depends on nothing (and
 * never on `runtime/`). The ID *types* are re-exported as public surface via the generated
 * barrel; the `*_ID_PATTERN` constants stay module-local (consumed by tests / future
 * runtime validation), kept off the partner barrel to keep the surface minimal.
 */

/** A Dinie customer id, `cust_` + 32 hex. Wire + surface are the same string. */
export type CustomerId = string;
/** A credit-offer id, `co_` + 32 hex. */
export type CreditOfferId = string;
/** A loan id, `ln_` + 32 hex. */
export type LoanId = string;
/** A loan-transaction id, `tx_` + 32 hex. */
export type TransactionId = string;
/** A simulation id, `sim_` + 32 hex. */
export type SimulationId = string;
/** A webhook-endpoint id, `we_` + 32 hex. */
export type WebhookEndpointId = string;
/** An API-credential (client) id, `dinie_ci_` + 32 hex. */
export type ApiClientId = string;
/** A customer bank-account id, `ba_` + 32 hex. */
export type BankAccountId = string;
/** A webhook-event id, `evt_` + 32 hex. */
export type EventId = string;

// ── ID patterns (verbatim from `components.schemas.*Id.pattern` @ openapi 3fcfd83) ──
//
// schema            → SDK type          → prefix      → pattern
// CustomerId        → CustomerId        → cust_       → ^cust_[0-9a-f]{32}$   (NOT cus_)
// CreditOfferId     → CreditOfferId     → co_         → ^co_[0-9a-f]{32}$
// LoanId            → LoanId            → ln_         → ^ln_[0-9a-f]{32}$
// TransactionId     → TransactionId     → tx_         → ^tx_[0-9a-f]{32}$
// SimulationId      → SimulationId      → sim_        → ^sim_[0-9a-f]{32}$
// WebhookEndpointId → WebhookEndpointId → we_         → ^we_[0-9a-f]{32}$
// ApiClientId       → ApiClientId       → dinie_ci_   → ^dinie_ci_[0-9a-f]{32}$
// BankAccountId     → BankAccountId     → ba_         → ^ba_[0-9a-f]{32}$
// EventId           → EventId           → evt_        → ^evt_[0-9a-f]{32}$

/** Pattern of a {@link CustomerId} (`cust_` + 32 hex). */
export const CUSTOMER_ID_PATTERN = /^cust_[0-9a-f]{32}$/;
/** Pattern of a {@link CreditOfferId} (`co_` + 32 hex). */
export const CREDIT_OFFER_ID_PATTERN = /^co_[0-9a-f]{32}$/;
/** Pattern of a {@link LoanId} (`ln_` + 32 hex). */
export const LOAN_ID_PATTERN = /^ln_[0-9a-f]{32}$/;
/** Pattern of a {@link TransactionId} (`tx_` + 32 hex). */
export const TRANSACTION_ID_PATTERN = /^tx_[0-9a-f]{32}$/;
/** Pattern of a {@link SimulationId} (`sim_` + 32 hex). */
export const SIMULATION_ID_PATTERN = /^sim_[0-9a-f]{32}$/;
/** Pattern of a {@link WebhookEndpointId} (`we_` + 32 hex). */
export const WEBHOOK_ENDPOINT_ID_PATTERN = /^we_[0-9a-f]{32}$/;
/** Pattern of an {@link ApiClientId} (`dinie_ci_` + 32 hex). */
export const API_CLIENT_ID_PATTERN = /^dinie_ci_[0-9a-f]{32}$/;
/** Pattern of a {@link BankAccountId} (`ba_` + 32 hex). */
export const BANK_ACCOUNT_ID_PATTERN = /^ba_[0-9a-f]{32}$/;
/** Pattern of an {@link EventId} (`evt_` + 32 hex). */
export const EVENT_ID_PATTERN = /^evt_[0-9a-f]{32}$/;
