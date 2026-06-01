/**
 * `loan.signature_received` event (`WebhookEvent_LoanSignatureReceived`) — architecture §3.3.
 * Fires each time an individual signer completes their signature on the CCB. Hand-authored in
 * V0.2 (D1); follows DS-EVENT (see `./customer-created.ts`).
 *
 * `data` carries a NESTED `signer` object — decoded by its own `deserializeLoanSigner`
 * (DS-EVENT recurses into nested objects via a per-object deserializer, never a generic
 * transform). NOT the `Loan` read-model.
 *
 * ── runtime ↔ generated boundary ── see `./customer-created.ts`. Imports `./base.js`,
 * `../types/ids.js`.
 */

import type { LoanId } from '../types/ids.js';
import type { WebhookEventBase, WebhookEventBaseWire } from './base.js';

/** The signer whose signature was just captured. */
export interface LoanSigner {
  /** Signer name. */
  name: string;
  /** Signer CPF. */
  cpf: string;
  /** When the signature was captured, epoch seconds (R-EPOCH). Wire: `signed_at`. */
  signedAt: number;
}

/** Snake_case wire mirror of {@link LoanSigner}. */
export interface LoanSignerWire {
  name: string;
  cpf: string;
  signed_at: number;
}

/** Payload of a `loan.signature_received` event. `status` pinned to `awaiting_signatures`. */
export interface LoanSignatureReceivedData {
  /** Loan id, `ln_…`. */
  id: LoanId;
  /** Lifecycle status — pinned to `awaiting_signatures`. */
  status: 'awaiting_signatures';
  /** The signer who just signed. */
  signer: LoanSigner;
  /** Number of signatures collected so far. Wire: `signatures_received`. */
  signaturesReceived: number;
  /** Total number of signatures required. Wire: `signatures_required`. */
  signaturesRequired: number;
}

/** Snake_case wire mirror of {@link LoanSignatureReceivedData}. */
export interface LoanSignatureReceivedDataWire {
  id: string;
  status: 'awaiting_signatures';
  signer: LoanSignerWire;
  signatures_received: number;
  signatures_required: number;
}

/** A verified `loan.signature_received` event. */
export interface LoanSignatureReceivedEvent extends WebhookEventBase<
  'loan.signature_received',
  LoanSignatureReceivedData
> {}

/** Snake_case wire mirror of {@link LoanSignatureReceivedEvent}. */
export interface LoanSignatureReceivedEventWire extends WebhookEventBaseWire {
  type: 'loan.signature_received';
  data: LoanSignatureReceivedDataWire;
}

/** Decode the nested signer (snake→camel). */
export function deserializeLoanSigner(raw: LoanSignerWire): LoanSigner {
  return {
    cpf: raw.cpf,
    name: raw.name,
    signedAt: raw.signed_at,
  };
}

/** Decode the `loan.signature_received` payload (snake→camel); `signer` via {@link deserializeLoanSigner}. */
export function deserializeLoanSignatureReceivedData(
  raw: LoanSignatureReceivedDataWire,
): LoanSignatureReceivedData {
  return {
    id: raw.id,
    signaturesReceived: raw.signatures_received,
    signaturesRequired: raw.signatures_required,
    signer: deserializeLoanSigner(raw.signer),
    status: raw.status,
  };
}

/** Decode a full `loan.signature_received` event (envelope inlined, `data` delegated). */
export function deserializeLoanSignatureReceived(
  raw: LoanSignatureReceivedEventWire,
): LoanSignatureReceivedEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeLoanSignatureReceivedData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'loan.signature_received',
  };
}
