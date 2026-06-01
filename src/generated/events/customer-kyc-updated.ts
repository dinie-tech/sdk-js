/**
 * `customer.kyc_updated` event (`WebhookEvent_CustomerKycUpdated`) — architecture §3.3. Carries
 * the full current state of all KYC requirements after a delta. Hand-authored in V0.2 (D1);
 * follows DS-EVENT (see `./customer-created.ts`).
 *
 * `data` is the bespoke KYC-update payload (`{ id, external_id, status, kyc }`). Like
 * `customer.created`, its `kyc` array reuses {@link deserializeKycRequirement} — the only
 * shared sub-object deserializer (§7.7). NOT the `Customer` read-model.
 *
 * ── runtime ↔ generated boundary ── see `./customer-created.ts`. Imports `./base.js`,
 * `../types/ids.js`, `../types/kyc/`.
 */

import {
  deserializeKycRequirement,
  type KycRequirement,
  type KycRequirementWire,
} from '../types/kyc/index.js';
import type { CustomerId } from '../types/ids.js';
import type { WebhookEventBase, WebhookEventBaseWire } from './base.js';

/** Payload of a `customer.kyc_updated` event — the full current KYC state plus status. */
export interface CustomerKycUpdatedData {
  /** Customer id, `cust_…`. */
  id: CustomerId;
  /** Partner external reference, or `null` (required, nullable). Wire: `external_id`. */
  externalId: string | null;
  /** Lifecycle status at the time of the update. */
  status: 'pending_kyc' | 'under_review' | 'active';
  /** Full current state of all KYC requirements. Each is a {@link KycRequirement}. */
  kyc: KycRequirement[];
}

/** Snake_case wire mirror of {@link CustomerKycUpdatedData}. */
export interface CustomerKycUpdatedDataWire {
  id: string;
  external_id: string | null;
  status: 'pending_kyc' | 'under_review' | 'active';
  kyc: KycRequirementWire[];
}

/** A verified `customer.kyc_updated` event. */
export interface CustomerKycUpdatedEvent extends WebhookEventBase<
  'customer.kyc_updated',
  CustomerKycUpdatedData
> {}

/** Snake_case wire mirror of {@link CustomerKycUpdatedEvent}. */
export interface CustomerKycUpdatedEventWire extends WebhookEventBaseWire {
  type: 'customer.kyc_updated';
  data: CustomerKycUpdatedDataWire;
}

/** Decode the `customer.kyc_updated` payload (snake→camel); `kyc` via {@link deserializeKycRequirement}. */
export function deserializeCustomerKycUpdatedData(
  raw: CustomerKycUpdatedDataWire,
): CustomerKycUpdatedData {
  return {
    externalId: raw.external_id,
    id: raw.id,
    kyc: raw.kyc.map(deserializeKycRequirement),
    status: raw.status,
  };
}

/** Decode a full `customer.kyc_updated` event (envelope inlined, `data` delegated). */
export function deserializeCustomerKycUpdated(
  raw: CustomerKycUpdatedEventWire,
): CustomerKycUpdatedEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeCustomerKycUpdatedData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'customer.kyc_updated',
  };
}
