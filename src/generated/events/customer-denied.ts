/**
 * `customer.denied` event (`WebhookEvent_CustomerDenied`) — architecture §3.3. Fires when the
 * customer is permanently blocked (fraud, closed company, other terminal condition). Hand-
 * authored in V0.2 (D1); follows DS-EVENT (see `./customer-created.ts`).
 *
 * `data` is the bespoke denied payload (`{ id, external_id, name, email, phone, cpf, cnpj?,
 * status: 'denied' }`) — NOT the `Customer` read-model (no timestamps/kyc/trading_name).
 *
 * ── runtime ↔ generated boundary ── see `./customer-created.ts`. Imports only `./base.js` +
 * `../types/ids.js`.
 */

import type { CustomerId } from '../types/ids.js';
import type { WebhookEventBase, WebhookEventBaseWire } from './base.js';

/** Payload of a `customer.denied` event. `status` is pinned to `denied`. */
export interface CustomerDeniedData {
  /** Customer id, `cust_…`. */
  id: CustomerId;
  /** Partner external reference, or `null` (required, nullable). Wire: `external_id`. */
  externalId: string | null;
  /** Display name. */
  name: string;
  /** Contact email. */
  email: string;
  /** Contact phone, E.164. */
  phone: string;
  /** Customer CPF, formatted. */
  cpf: string;
  /** Company CNPJ, formatted, or `null`. Optional on the wire. */
  cnpj?: string | null;
  /** Lifecycle status — pinned to `denied`. */
  status: 'denied';
}

/** Snake_case wire mirror of {@link CustomerDeniedData}. */
export interface CustomerDeniedDataWire {
  id: string;
  external_id: string | null;
  name: string;
  email: string;
  phone: string;
  cpf: string;
  cnpj?: string | null;
  status: 'denied';
}

/** A verified `customer.denied` event. */
export interface CustomerDeniedEvent extends WebhookEventBase<
  'customer.denied',
  CustomerDeniedData
> {}

/** Snake_case wire mirror of {@link CustomerDeniedEvent}. */
export interface CustomerDeniedEventWire extends WebhookEventBaseWire {
  type: 'customer.denied';
  data: CustomerDeniedDataWire;
}

/** Decode the `customer.denied` payload (snake→camel). `cnpj` omitted when absent (R-OPTIONAL). */
export function deserializeCustomerDeniedData(raw: CustomerDeniedDataWire): CustomerDeniedData {
  return {
    ...(raw.cnpj !== undefined ? { cnpj: raw.cnpj } : {}),
    cpf: raw.cpf,
    email: raw.email,
    externalId: raw.external_id,
    id: raw.id,
    name: raw.name,
    phone: raw.phone,
    status: raw.status,
  };
}

/** Decode a full `customer.denied` event (envelope inlined, `data` delegated). */
export function deserializeCustomerDenied(raw: CustomerDeniedEventWire): CustomerDeniedEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeCustomerDeniedData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'customer.denied',
  };
}
