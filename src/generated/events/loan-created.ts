/**
 * `loan.created` event (`WebhookEvent_LoanCreated`) — architecture §3.3. Fires when the loan is
 * created with the CCB generated synchronously; the loan starts in `awaiting_signatures`. Hand-
 * authored in V0.2 (D1); follows DS-EVENT (see `./customer-created.ts`).
 *
 * `data` is the bespoke creation payload (`{ id, credit_offer_id, customer_id, status,
 * requested_amount, installment_count, signing_url }`) — NOT the 21-field `Loan` read-model
 * (`types/loan.ts`). `deserializeLoan` is NOT reused.
 *
 * ── runtime ↔ generated boundary ── see `./customer-created.ts`. Imports `./base.js`,
 * `../types/ids.js`, `../types/money.js`.
 */

import type { CreditOfferId, CustomerId, LoanId } from '../types/ids.js';
import type { Money } from '../types/money.js';
import type { WebhookEventBase, WebhookEventBaseWire } from './base.js';

/** Payload of a `loan.created` event. `status` pinned to `awaiting_signatures`. */
export interface LoanCreatedData {
  /** Loan id, `ln_…`. */
  id: LoanId;
  /** Originating credit offer. Wire: `credit_offer_id`. */
  creditOfferId: CreditOfferId;
  /** Owning customer. Wire: `customer_id`. */
  customerId: CustomerId;
  /** Lifecycle status — pinned to `awaiting_signatures`. */
  status: 'awaiting_signatures';
  /** Amount requested by the partner, BRL. Wire: `requested_amount`. */
  requestedAmount: Money;
  /** Number of installments. Wire: `installment_count`. */
  installmentCount: number;
  /** ClickSign widget URL for customer signing. Wire: `signing_url`. */
  signingUrl: string;
}

/** Snake_case wire mirror of {@link LoanCreatedData}. */
export interface LoanCreatedDataWire {
  id: string;
  credit_offer_id: string;
  customer_id: string;
  status: 'awaiting_signatures';
  requested_amount: Money;
  installment_count: number;
  signing_url: string;
}

/** A verified `loan.created` event. */
export interface LoanCreatedEvent extends WebhookEventBase<'loan.created', LoanCreatedData> {}

/** Snake_case wire mirror of {@link LoanCreatedEvent}. */
export interface LoanCreatedEventWire extends WebhookEventBaseWire {
  type: 'loan.created';
  data: LoanCreatedDataWire;
}

/** Decode the `loan.created` payload (snake→camel). */
export function deserializeLoanCreatedData(raw: LoanCreatedDataWire): LoanCreatedData {
  return {
    creditOfferId: raw.credit_offer_id,
    customerId: raw.customer_id,
    id: raw.id,
    installmentCount: raw.installment_count,
    requestedAmount: raw.requested_amount,
    signingUrl: raw.signing_url,
    status: raw.status,
  };
}

/** Decode a full `loan.created` event (envelope inlined, `data` delegated). */
export function deserializeLoanCreated(raw: LoanCreatedEventWire): LoanCreatedEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeLoanCreatedData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'loan.created',
  };
}
