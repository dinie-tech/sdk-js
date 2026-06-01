/**
 * `loan.active` event (`WebhookEvent_LoanActive`) — architecture §3.3. Fires when disbursement
 * completes and the loan becomes active. Hand-authored in V0.2 (D1); follows DS-EVENT (see
 * `./customer-created.ts`).
 *
 * `data` is the bespoke active payload (`{ id, status, requested_amount, principal_amount }`) —
 * NOT the `Loan` read-model.
 *
 * ── runtime ↔ generated boundary ── see `./customer-created.ts`. Imports `./base.js`,
 * `../types/ids.js`, `../types/money.js`.
 */

import type { LoanId } from '../types/ids.js';
import type { Money } from '../types/money.js';
import type { WebhookEventBase, WebhookEventBaseWire } from './base.js';

/** Payload of a `loan.active` event. `status` pinned to `active`. */
export interface LoanActiveData {
  /** Loan id, `ln_…`. */
  id: LoanId;
  /** Lifecycle status — pinned to `active`. */
  status: 'active';
  /** Amount requested by the partner, BRL. Wire: `requested_amount`. */
  requestedAmount: Money;
  /** Principal (requested + financed fees), BRL. Wire: `principal_amount`. */
  principalAmount: Money;
}

/** Snake_case wire mirror of {@link LoanActiveData}. */
export interface LoanActiveDataWire {
  id: string;
  status: 'active';
  requested_amount: Money;
  principal_amount: Money;
}

/** A verified `loan.active` event. */
export interface LoanActiveEvent extends WebhookEventBase<'loan.active', LoanActiveData> {}

/** Snake_case wire mirror of {@link LoanActiveEvent}. */
export interface LoanActiveEventWire extends WebhookEventBaseWire {
  type: 'loan.active';
  data: LoanActiveDataWire;
}

/** Decode the `loan.active` payload (snake→camel). */
export function deserializeLoanActiveData(raw: LoanActiveDataWire): LoanActiveData {
  return {
    id: raw.id,
    principalAmount: raw.principal_amount,
    requestedAmount: raw.requested_amount,
    status: raw.status,
  };
}

/** Decode a full `loan.active` event (envelope inlined, `data` delegated). */
export function deserializeLoanActive(raw: LoanActiveEventWire): LoanActiveEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeLoanActiveData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'loan.active',
  };
}
