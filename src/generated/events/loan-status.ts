/**
 * `loan.finished` + `loan.cancelled` + `loan.error` events (`WebhookEvent_LoanStatus`) —
 * architecture §3.3. ONE openapi schema, THREE union members (the `type` `enum`). Hand-authored
 * in V0.2 (D1); follows DS-EVENT (see `./customer-created.ts`).
 *
 * `data` is the bespoke terminal-status payload (`{ id, status, error? }`). The nested `error`
 * is OPTIONAL on the shared schema and present only for `loan.error` — the contract does not
 * split it into a per-`type` schema, so it is modeled as optional on the shared `data` (not
 * narrowed to required for the error member) and omitted when absent (R-OPTIONAL). NOT the
 * `Loan` read-model.
 *
 * ── runtime ↔ generated boundary ── see `./customer-created.ts`. Imports `./base.js`,
 * `../types/ids.js`.
 */

import type { LoanId } from '../types/ids.js';
import type { WebhookEventBase, WebhookEventBaseWire } from './base.js';

/** Error details, present only on `loan.error`. */
export interface LoanError {
  /** Machine-readable error code. */
  code: string;
  /** Human-readable error description. */
  message: string;
}

/** Snake_case wire mirror of {@link LoanError} (no renames; copied for symmetry). */
export interface LoanErrorWire {
  code: string;
  message: string;
}

/**
 * Payload shared by `loan.finished`, `loan.cancelled`, and `loan.error`
 * (`WebhookEvent_LoanStatus.data`). `status` carries the schema enum; `error` is present only on
 * `loan.error`.
 */
export interface LoanStatusData {
  /** Loan id, `ln_…`. */
  id: LoanId;
  /** Terminal lifecycle status. */
  status: 'finished' | 'cancelled' | 'error';
  /** Error details — present only for `loan.error`. Optional. */
  error?: LoanError;
}

/** Snake_case wire mirror of {@link LoanStatusData}. */
export interface LoanStatusDataWire {
  id: string;
  status: 'finished' | 'cancelled' | 'error';
  error?: LoanErrorWire;
}

/** A verified `loan.finished` event. */
export interface LoanFinishedEvent extends WebhookEventBase<'loan.finished', LoanStatusData> {}

/** A verified `loan.cancelled` event. */
export interface LoanCancelledEvent extends WebhookEventBase<'loan.cancelled', LoanStatusData> {}

/** A verified `loan.error` event. */
export interface LoanErrorEvent extends WebhookEventBase<'loan.error', LoanStatusData> {}

/** Snake_case wire mirror of the loan-status events (all three `type` values). */
export interface LoanStatusEventWire extends WebhookEventBaseWire {
  type: 'loan.finished' | 'loan.cancelled' | 'loan.error';
  data: LoanStatusDataWire;
}

/** Decode the nested error (snake→camel — no renames). */
export function deserializeLoanError(raw: LoanErrorWire): LoanError {
  return {
    code: raw.code,
    message: raw.message,
  };
}

/** Decode the shared loan-status payload (snake→camel); `error` omitted when absent (R-OPTIONAL). */
export function deserializeLoanStatusData(raw: LoanStatusDataWire): LoanStatusData {
  return {
    ...(raw.error !== undefined ? { error: deserializeLoanError(raw.error) } : {}),
    id: raw.id,
    status: raw.status,
  };
}

/** Decode a full `loan.finished` event (envelope inlined, `data` delegated). */
export function deserializeLoanFinished(raw: LoanStatusEventWire): LoanFinishedEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeLoanStatusData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'loan.finished',
  };
}

/** Decode a full `loan.cancelled` event (envelope inlined, `data` delegated). */
export function deserializeLoanCancelled(raw: LoanStatusEventWire): LoanCancelledEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeLoanStatusData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'loan.cancelled',
  };
}

/**
 * Decode a full `loan.error` event (envelope inlined, `data` delegated). Named with an `Event`
 * suffix to avoid colliding with {@link deserializeLoanError} (the nested error-object decoder)
 * — the one member deserializer that deviates from the bare `deserialize<Member>` convention.
 */
export function deserializeLoanErrorEvent(raw: LoanStatusEventWire): LoanErrorEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeLoanStatusData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'loan.error',
  };
}
