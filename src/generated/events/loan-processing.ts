/**
 * `loan.processing` event (`WebhookEvent_LoanProcessing`) — architecture §3.3. Fires when all
 * required signatures are collected and disbursement is in progress. Hand-authored in V0.2 (D1);
 * follows DS-EVENT (see `./customer-created.ts`).
 *
 * `data` is the bespoke processing payload (`{ id, credit_offer_id, customer_id, status,
 * ccb_number, disbursement_method }`) — NOT the `Loan` read-model.
 *
 * ── runtime ↔ generated boundary ── see `./customer-created.ts`. Imports `./base.js`,
 * `../types/ids.js`.
 */

import type { CreditOfferId, CustomerId, LoanId } from '../types/ids.js';
import type { WebhookEventBase, WebhookEventBaseWire } from './base.js';

/** Payload of a `loan.processing` event. `status` pinned to `processing`. */
export interface LoanProcessingData {
  /** Loan id, `ln_…`. */
  id: LoanId;
  /** Originating credit offer. Wire: `credit_offer_id`. */
  creditOfferId: CreditOfferId;
  /** Owning customer. Wire: `customer_id`. */
  customerId: CustomerId;
  /** Lifecycle status — pinned to `processing`. */
  status: 'processing';
  /** CCB contract number. Wire: `ccb_number`. */
  ccbNumber: string;
  /** Disbursement method (e.g. `pix`). Wire: `disbursement_method`. */
  disbursementMethod: string;
}

/** Snake_case wire mirror of {@link LoanProcessingData}. */
export interface LoanProcessingDataWire {
  id: string;
  credit_offer_id: string;
  customer_id: string;
  status: 'processing';
  ccb_number: string;
  disbursement_method: string;
}

/** A verified `loan.processing` event. */
export interface LoanProcessingEvent extends WebhookEventBase<
  'loan.processing',
  LoanProcessingData
> {}

/** Snake_case wire mirror of {@link LoanProcessingEvent}. */
export interface LoanProcessingEventWire extends WebhookEventBaseWire {
  type: 'loan.processing';
  data: LoanProcessingDataWire;
}

/** Decode the `loan.processing` payload (snake→camel). */
export function deserializeLoanProcessingData(raw: LoanProcessingDataWire): LoanProcessingData {
  return {
    ccbNumber: raw.ccb_number,
    creditOfferId: raw.credit_offer_id,
    customerId: raw.customer_id,
    disbursementMethod: raw.disbursement_method,
    id: raw.id,
    status: raw.status,
  };
}

/** Decode a full `loan.processing` event (envelope inlined, `data` delegated). */
export function deserializeLoanProcessing(raw: LoanProcessingEventWire): LoanProcessingEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeLoanProcessingData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'loan.processing',
  };
}
