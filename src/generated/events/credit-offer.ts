/**
 * `credit_offer.available` + `credit_offer.expired` events (`WebhookEvent_CreditOffer`) —
 * architecture §3.3. ONE openapi schema, TWO union members (the `type` `enum`). Hand-authored
 * in V0.2 (D1); follows DS-EVENT (see `./customer-created.ts`).
 *
 * `data` (`CreditOfferEventData`) is the bespoke offer payload — NOT the `CreditOffer`
 * read-model (`types/credit-offer.ts`): it has NO `created_at`/`updated_at`, no
 * `min_installments`/`max_installments`, `installments` is required, and `external_id` is
 * required-but-nullable here. So `deserializeCreditOffer` is NOT reused (its wire reads absent
 * fields). The name `CreditOfferEventData` is deliberate — it does not collide with `CreditOffer`.
 *
 * ── runtime ↔ generated boundary ── see `./customer-created.ts`. Imports `./base.js`,
 * `../types/ids.js`, `../types/money.js`.
 */

import type { CreditOfferId, CustomerId } from '../types/ids.js';
import type { Money } from '../types/money.js';
import type { WebhookEventBase, WebhookEventBaseWire } from './base.js';

/**
 * Payload shared by `credit_offer.available` and `credit_offer.expired`
 * (`WebhookEvent_CreditOffer.data`). `status` carries the schema enum (not narrowed per member).
 */
export interface CreditOfferEventData {
  /** Credit-offer id, `co_…`. */
  id: CreditOfferId;
  /** Owning customer. Wire: `customer_id`. */
  customerId: CustomerId;
  /** Partner external reference for the customer, or `null` (required, nullable). Wire: `external_id`. */
  externalId: string | null;
  /** Offer status. */
  status: 'available' | 'expired';
  /** Approved credit amount, BRL. Wire: `approved_amount`. */
  approvedAmount: Money;
  /** Minimum withdrawal amount, BRL. Wire: `min_amount`. */
  minAmount: number;
  /** Monthly interest rate, percent. Wire: `monthly_interest_rate`. */
  monthlyInterestRate: number;
  /** Number of installments. */
  installments: number;
  /** Due-date rule for installments (pending Core), or `null`. Optional. Wire: `due_date_rule`. */
  dueDateRule?: string | null;
  /** Offer expiration, epoch seconds. Wire: `valid_until`. */
  validUntil: number;
}

/** Snake_case wire mirror of {@link CreditOfferEventData}. */
export interface CreditOfferEventDataWire {
  id: string;
  customer_id: string;
  external_id: string | null;
  status: 'available' | 'expired';
  approved_amount: Money;
  min_amount: number;
  monthly_interest_rate: number;
  installments: number;
  due_date_rule?: string | null;
  valid_until: number;
}

/** A verified `credit_offer.available` event. */
export interface CreditOfferAvailableEvent extends WebhookEventBase<
  'credit_offer.available',
  CreditOfferEventData
> {}

/** A verified `credit_offer.expired` event. */
export interface CreditOfferExpiredEvent extends WebhookEventBase<
  'credit_offer.expired',
  CreditOfferEventData
> {}

/** Snake_case wire mirror of the credit-offer events (both `type` values). */
export interface CreditOfferEventWire extends WebhookEventBaseWire {
  type: 'credit_offer.available' | 'credit_offer.expired';
  data: CreditOfferEventDataWire;
}

/** Decode the shared credit-offer payload (snake→camel). `dueDateRule` omitted when absent. */
export function deserializeCreditOfferEventData(
  raw: CreditOfferEventDataWire,
): CreditOfferEventData {
  return {
    approvedAmount: raw.approved_amount,
    customerId: raw.customer_id,
    ...(raw.due_date_rule !== undefined ? { dueDateRule: raw.due_date_rule } : {}),
    externalId: raw.external_id,
    id: raw.id,
    installments: raw.installments,
    minAmount: raw.min_amount,
    monthlyInterestRate: raw.monthly_interest_rate,
    status: raw.status,
    validUntil: raw.valid_until,
  };
}

/** Decode a full `credit_offer.available` event (envelope inlined, `data` delegated). */
export function deserializeCreditOfferAvailable(
  raw: CreditOfferEventWire,
): CreditOfferAvailableEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeCreditOfferEventData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'credit_offer.available',
  };
}

/** Decode a full `credit_offer.expired` event (envelope inlined, `data` delegated). */
export function deserializeCreditOfferExpired(raw: CreditOfferEventWire): CreditOfferExpiredEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeCreditOfferEventData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'credit_offer.expired',
  };
}
