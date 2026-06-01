/**
 * `customer.under_review` + `customer.active` events (`WebhookEvent_CustomerStatus`) —
 * architecture §3.3. ONE openapi schema, TWO union members (the `type` `enum` carries both).
 * Hand-authored in V0.2 to mirror future generator output (D1). Follows DS-EVENT (the
 * determinism shape documented in `./customer-created.ts`).
 *
 * ── DS-EVENT, multi-type schema ──
 * A schema whose `type` is an `enum` of N values yields N union members that SHARE one `data`
 * shape + one `deserialize<Schema>Data`, but each gets its own `deserialize<EventName>` pinning
 * its `type` literal (so the return type is the exact member — no cast, no mislabel: the
 * `EVENT_DESERIALIZERS` table guarantees the right deserializer runs for the right key).
 *
 * `data` is the bespoke status payload (`{ id, external_id, status }`) — a minimal subset, NOT
 * the `Customer` read-model (no name/timestamps/kyc). See `./customer-created.ts` for why the
 * resource deserializers are not reused.
 *
 * ── runtime ↔ generated boundary ── see `./customer-created.ts`. Imports only `./base.js` +
 * `../types/ids.js`.
 */

import type { CustomerId } from '../types/ids.js';
import type { WebhookEventBase, WebhookEventBaseWire } from './base.js';

/**
 * Payload shared by `customer.under_review` and `customer.active` — the minimal status change
 * the Core emits (`WebhookEvent_CustomerStatus.data`). `status` carries the schema enum; it is
 * NOT narrowed per member (the wire schema does not pin it per `type`).
 */
export interface CustomerStatusData {
  /** Customer id, `cust_…`. */
  id: CustomerId;
  /** Partner external reference, or `null` (required, nullable). Wire: `external_id`. */
  externalId: string | null;
  /** New lifecycle status. */
  status: 'under_review' | 'active';
}

/** Snake_case wire mirror of {@link CustomerStatusData}. */
export interface CustomerStatusDataWire {
  id: string;
  external_id: string | null;
  status: 'under_review' | 'active';
}

/** A verified `customer.under_review` event. */
export interface CustomerUnderReviewEvent extends WebhookEventBase<
  'customer.under_review',
  CustomerStatusData
> {}

/** A verified `customer.active` event. */
export interface CustomerActiveEvent extends WebhookEventBase<
  'customer.active',
  CustomerStatusData
> {}

/** Snake_case wire mirror of the customer-status events (both `type` values). */
export interface CustomerStatusEventWire extends WebhookEventBaseWire {
  type: 'customer.under_review' | 'customer.active';
  data: CustomerStatusDataWire;
}

/** Decode the shared customer-status payload (snake→camel). */
export function deserializeCustomerStatusData(raw: CustomerStatusDataWire): CustomerStatusData {
  return {
    externalId: raw.external_id,
    id: raw.id,
    status: raw.status,
  };
}

/** Decode a full `customer.under_review` event (envelope inlined, `data` delegated). */
export function deserializeCustomerUnderReview(
  raw: CustomerStatusEventWire,
): CustomerUnderReviewEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeCustomerStatusData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'customer.under_review',
  };
}

/** Decode a full `customer.active` event (envelope inlined, `data` delegated). */
export function deserializeCustomerActive(raw: CustomerStatusEventWire): CustomerActiveEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeCustomerStatusData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'customer.active',
  };
}
