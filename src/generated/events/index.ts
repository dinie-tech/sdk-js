/**
 * Webhook events barrel — the 15-member `WebhookEvent` discriminated union + the
 * `EVENT_DESERIALIZERS` per-type dispatch table (architecture §3.3, §5.6, §7.7, D10/R6).
 * Hand-authored in V0.2 to mirror future generator output (D1; V0.4 overwrites in place).
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * DS-EVENT — the per-type webhook deserialization shape (story 009 → `principles.md`;
 * the template V0.3 Ruby + V0.4 generator reproduce). Full rule in `./customer-created.ts`.
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * 15 event `type`s, covered by 11 `WebhookEvent_*` schemas — three schemas carry a `type`
 * `enum` and so back several union members (architecture §3.3):
 *
 *   schema (openapi)                 → event `type`(s)                                    │ data deserializer
 *   ─────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────
 *   WebhookEvent_CustomerCreated     → customer.created                                   │ deserializeCustomerCreatedData
 *   WebhookEvent_CustomerStatus      → customer.under_review · customer.active            │ deserializeCustomerStatusData
 *   WebhookEvent_CustomerDenied      → customer.denied                                    │ deserializeCustomerDeniedData
 *   WebhookEvent_CustomerKycUpdated  → customer.kyc_updated                               │ deserializeCustomerKycUpdatedData
 *   WebhookEvent_CreditOffer         → credit_offer.available · credit_offer.expired      │ deserializeCreditOfferEventData
 *   WebhookEvent_LoanCreated         → loan.created                                       │ deserializeLoanCreatedData
 *   WebhookEvent_LoanSignatureReceived → loan.signature_received                          │ deserializeLoanSignatureReceivedData
 *   WebhookEvent_LoanProcessing      → loan.processing                                    │ deserializeLoanProcessingData
 *   WebhookEvent_LoanActive          → loan.active                                        │ deserializeLoanActiveData
 *   WebhookEvent_LoanPaymentReceived → loan.payment_received                              │ deserializeLoanPaymentReceivedData
 *   WebhookEvent_LoanStatus          → loan.finished · loan.cancelled · loan.error        │ deserializeLoanStatusData
 *                                      ───────────────────────────────────────────────────┘
 *                                      8×1 + 1×2 + 1×2 + 1×3 = 15 members from 11 schemas.
 *
 * ── No openapi `discriminator` keyword ──
 * The `WebhookEvent_*` schemas use a `const`/`enum` `type` field, NOT an explicit
 * `discriminator.propertyName` (verified @3fcfd83 — unlike `KycRequirement`/`KycUpload`, which
 * DO have one). DS-IMPLICIT (§7.8) applies: the literal `const` `type` is the discriminant. A
 * candidate openapi PR (**P6**, NOT authorized this round) would add `discriminator: type`; the
 * implicit-const dispatch below is sound and tracked. The completeness of the dispatch is
 * pinned at compile time by `Record<WebhookEventType, …>` (a missing `type` fails `tsc`).
 *
 * ── runtime ↔ generated boundary (the forcing-function — §6.4) ──
 * `runtime/webhooks.ts` imports `WebhookEvent`, `WebhookEventType`, `WebhookEventWire`, and
 * `EVENT_DESERIALIZERS` from HERE — one of the two declared inverse imports (the other is
 * `http.ts → generated/errors`). If an event `type` is not in openapi it is not in this table,
 * `extract` cannot dispatch it, and the unknown-type guard throws — forcing the openapi-SoT
 * conversation. The generated barrel (`../index.ts`) re-exports only the PUBLIC `*Event`/`*Data`
 * model types; the `*Wire` types + table + `deserialize*` stay internal (this module).
 */

import {
  deserializeCustomerCreated,
  type CustomerCreatedData,
  type CustomerCreatedEvent,
  type CustomerCreatedEventWire,
} from './customer-created.js';
import {
  deserializeCustomerActive,
  deserializeCustomerUnderReview,
  type CustomerActiveEvent,
  type CustomerStatusData,
  type CustomerStatusEventWire,
  type CustomerUnderReviewEvent,
} from './customer-status.js';
import {
  deserializeCustomerDenied,
  type CustomerDeniedData,
  type CustomerDeniedEvent,
  type CustomerDeniedEventWire,
} from './customer-denied.js';
import {
  deserializeCustomerKycUpdated,
  type CustomerKycUpdatedData,
  type CustomerKycUpdatedEvent,
  type CustomerKycUpdatedEventWire,
} from './customer-kyc-updated.js';
import {
  deserializeCreditOfferAvailable,
  deserializeCreditOfferExpired,
  type CreditOfferAvailableEvent,
  type CreditOfferEventData,
  type CreditOfferEventWire,
  type CreditOfferExpiredEvent,
} from './credit-offer.js';
import {
  deserializeLoanCreated,
  type LoanCreatedData,
  type LoanCreatedEvent,
  type LoanCreatedEventWire,
} from './loan-created.js';
import {
  deserializeLoanSignatureReceived,
  type LoanSignatureReceivedData,
  type LoanSignatureReceivedEvent,
  type LoanSignatureReceivedEventWire,
  type LoanSigner,
} from './loan-signature-received.js';
import {
  deserializeLoanProcessing,
  type LoanProcessingData,
  type LoanProcessingEvent,
  type LoanProcessingEventWire,
} from './loan-processing.js';
import {
  deserializeLoanActive,
  type LoanActiveData,
  type LoanActiveEvent,
  type LoanActiveEventWire,
} from './loan-active.js';
import {
  deserializeLoanPaymentReceived,
  type LoanPayment,
  type LoanPaymentReceivedData,
  type LoanPaymentReceivedEvent,
  type LoanPaymentReceivedEventWire,
} from './loan-payment-received.js';
import {
  deserializeLoanCancelled,
  deserializeLoanErrorEvent,
  deserializeLoanFinished,
  type LoanCancelledEvent,
  type LoanError,
  type LoanErrorEvent,
  type LoanFinishedEvent,
  type LoanStatusData,
  type LoanStatusEventWire,
} from './loan-status.js';

// ── Public re-exports (model + data types; the partner-facing surface) ───────────

export type { WebhookEventBase } from './base.js';
export type { CustomerCreatedData, CustomerCreatedEvent } from './customer-created.js';
export type {
  CustomerActiveEvent,
  CustomerStatusData,
  CustomerUnderReviewEvent,
} from './customer-status.js';
export type { CustomerDeniedData, CustomerDeniedEvent } from './customer-denied.js';
export type { CustomerKycUpdatedData, CustomerKycUpdatedEvent } from './customer-kyc-updated.js';
export type {
  CreditOfferAvailableEvent,
  CreditOfferEventData,
  CreditOfferExpiredEvent,
} from './credit-offer.js';
export type { LoanCreatedData, LoanCreatedEvent } from './loan-created.js';
export type {
  LoanSignatureReceivedData,
  LoanSignatureReceivedEvent,
  LoanSigner,
} from './loan-signature-received.js';
export type { LoanProcessingData, LoanProcessingEvent } from './loan-processing.js';
export type { LoanActiveData, LoanActiveEvent } from './loan-active.js';
export type {
  LoanPayment,
  LoanPaymentReceivedData,
  LoanPaymentReceivedEvent,
} from './loan-payment-received.js';
export type {
  LoanCancelledEvent,
  LoanError,
  LoanErrorEvent,
  LoanFinishedEvent,
  LoanStatusData,
} from './loan-status.js';

// ── The discriminated union (15 members, keyed by the literal `type`) ────────────

/**
 * Every Dinie webhook event — a discriminated union over the literal `type`. `Webhooks.extract`
 * returns this; `event.type` narrows `event.data` to the matching payload (architecture §3.3,
 * §7.8). 15 members from 11 openapi schemas (see the module header / mapping table).
 */
export type WebhookEvent =
  | CustomerCreatedEvent
  | CustomerUnderReviewEvent
  | CustomerActiveEvent
  | CustomerDeniedEvent
  | CustomerKycUpdatedEvent
  | CreditOfferAvailableEvent
  | CreditOfferExpiredEvent
  | LoanCreatedEvent
  | LoanSignatureReceivedEvent
  | LoanProcessingEvent
  | LoanActiveEvent
  | LoanPaymentReceivedEvent
  | LoanFinishedEvent
  | LoanCancelledEvent
  | LoanErrorEvent;

/** The 15 event `type` discriminants — the keys of {@link EVENT_DESERIALIZERS}. */
export type WebhookEventType = WebhookEvent['type'];

/**
 * Snake_case wire union accepted by {@link EVENT_DESERIALIZERS}. One member per schema (11);
 * the multi-`type` schemas (status/credit-offer/loan-status) each contribute a single wire type
 * whose `type` is the schema's `enum`. `extract` casts the parsed body to this after confirming
 * the `type` is known.
 */
export type WebhookEventWire =
  | CustomerCreatedEventWire
  | CustomerStatusEventWire
  | CustomerDeniedEventWire
  | CustomerKycUpdatedEventWire
  | CreditOfferEventWire
  | LoanCreatedEventWire
  | LoanSignatureReceivedEventWire
  | LoanProcessingEventWire
  | LoanActiveEventWire
  | LoanPaymentReceivedEventWire
  | LoanStatusEventWire;

// ── The per-type dispatch table (D10/§7.7) ───────────────────────────────────────

/**
 * Per-type webhook deserializers, keyed by the event `type` (D10/R6/§7.7). `runtime/webhooks.ts`
 * dispatches `EVENT_DESERIALIZERS[raw.type](raw)` AFTER verifying the signature — turning the
 * V0.1 blind cast into an honest, per-type snake→camel decode. `Record<WebhookEventType, …>`
 * makes the dispatch EXHAUSTIVE at compile time: omit a `type` and `tsc` fails.
 *
 * Each entry narrows the broad {@link WebhookEventWire} to its schema's wire type (the only cast
 * — localized, justified by the table key) and delegates to the member's `deserialize<EventName>`.
 * Multi-`type` schemas point several keys at distinct member deserializers that share one
 * `data` decoder; the member deserializer pins its `type` literal, so the returned member is
 * exact (no mislabel — the key guarantees the right entry runs). NOT a generic deep transform.
 */
export const EVENT_DESERIALIZERS: Record<
  WebhookEventType,
  (raw: WebhookEventWire) => WebhookEvent
> = {
  'customer.created': (raw) => deserializeCustomerCreated(raw as CustomerCreatedEventWire),
  'customer.under_review': (raw) => deserializeCustomerUnderReview(raw as CustomerStatusEventWire),
  'customer.active': (raw) => deserializeCustomerActive(raw as CustomerStatusEventWire),
  'customer.denied': (raw) => deserializeCustomerDenied(raw as CustomerDeniedEventWire),
  'customer.kyc_updated': (raw) =>
    deserializeCustomerKycUpdated(raw as CustomerKycUpdatedEventWire),
  'credit_offer.available': (raw) => deserializeCreditOfferAvailable(raw as CreditOfferEventWire),
  'credit_offer.expired': (raw) => deserializeCreditOfferExpired(raw as CreditOfferEventWire),
  'loan.created': (raw) => deserializeLoanCreated(raw as LoanCreatedEventWire),
  'loan.signature_received': (raw) =>
    deserializeLoanSignatureReceived(raw as LoanSignatureReceivedEventWire),
  'loan.processing': (raw) => deserializeLoanProcessing(raw as LoanProcessingEventWire),
  'loan.active': (raw) => deserializeLoanActive(raw as LoanActiveEventWire),
  'loan.payment_received': (raw) =>
    deserializeLoanPaymentReceived(raw as LoanPaymentReceivedEventWire),
  'loan.finished': (raw) => deserializeLoanFinished(raw as LoanStatusEventWire),
  'loan.cancelled': (raw) => deserializeLoanCancelled(raw as LoanStatusEventWire),
  'loan.error': (raw) => deserializeLoanErrorEvent(raw as LoanStatusEventWire),
};
