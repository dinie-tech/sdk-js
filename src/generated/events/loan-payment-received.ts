/**
 * `loan.payment_received` event (`WebhookEvent_LoanPaymentReceived`) — architecture §3.3. Fires
 * when an installment payment is received. Hand-authored in V0.2 (D1); follows DS-EVENT (see
 * `./customer-created.ts`).
 *
 * `data` carries a NESTED `payment` object — decoded by its own `deserializeLoanPayment`. The
 * §3.3 table labels this `Loan/Transaction`, but the contract @3fcfd83 carries NEITHER a `Loan`
 * NOR a `Transaction`: just `{ id, status, payment: { amount, paid_at, installment_number } }`.
 * So `deserializeTransaction` is NOT reused (no `Transaction` on the wire). Surfaced for 008/009.
 *
 * ── runtime ↔ generated boundary ── see `./customer-created.ts`. Imports `./base.js`,
 * `../types/ids.js`, `../types/money.js`.
 */

import type { LoanId } from '../types/ids.js';
import type { Money } from '../types/money.js';
import type { WebhookEventBase, WebhookEventBaseWire } from './base.js';

/** The payment captured for an installment. */
export interface LoanPayment {
  /** Amount paid, BRL. */
  amount: Money;
  /** When the payment was received, epoch seconds (R-EPOCH). Wire: `paid_at`. */
  paidAt: number;
  /** Which installment was paid. Wire: `installment_number`. */
  installmentNumber: number;
}

/** Snake_case wire mirror of {@link LoanPayment}. */
export interface LoanPaymentWire {
  amount: Money;
  paid_at: number;
  installment_number: number;
}

/** Payload of a `loan.payment_received` event. `status` pinned to `active`. */
export interface LoanPaymentReceivedData {
  /** Loan id, `ln_…`. */
  id: LoanId;
  /** Lifecycle status — pinned to `active`. */
  status: 'active';
  /** The payment that was just received. */
  payment: LoanPayment;
}

/** Snake_case wire mirror of {@link LoanPaymentReceivedData}. */
export interface LoanPaymentReceivedDataWire {
  id: string;
  status: 'active';
  payment: LoanPaymentWire;
}

/** A verified `loan.payment_received` event. */
export interface LoanPaymentReceivedEvent extends WebhookEventBase<
  'loan.payment_received',
  LoanPaymentReceivedData
> {}

/** Snake_case wire mirror of {@link LoanPaymentReceivedEvent}. */
export interface LoanPaymentReceivedEventWire extends WebhookEventBaseWire {
  type: 'loan.payment_received';
  data: LoanPaymentReceivedDataWire;
}

/** Decode the nested payment (snake→camel). */
export function deserializeLoanPayment(raw: LoanPaymentWire): LoanPayment {
  return {
    amount: raw.amount,
    installmentNumber: raw.installment_number,
    paidAt: raw.paid_at,
  };
}

/** Decode the `loan.payment_received` payload (snake→camel); `payment` via {@link deserializeLoanPayment}. */
export function deserializeLoanPaymentReceivedData(
  raw: LoanPaymentReceivedDataWire,
): LoanPaymentReceivedData {
  return {
    id: raw.id,
    payment: deserializeLoanPayment(raw.payment),
    status: raw.status,
  };
}

/** Decode a full `loan.payment_received` event (envelope inlined, `data` delegated). */
export function deserializeLoanPaymentReceived(
  raw: LoanPaymentReceivedEventWire,
): LoanPaymentReceivedEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeLoanPaymentReceivedData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'loan.payment_received',
  };
}
