/**
 * `customer.created` event (`WebhookEvent_CustomerCreated`) — architecture §3.3, §5.6, §7.7.
 * Hand-authored in V0.2 to mirror future generator output (D1; V0.4 overwrites in place). The
 * single V0.1 event grew into the 15-member `WebhookEvent` union (assembled in `./index.ts`).
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * DETERMINISM SHAPE — DS-EVENT (per-type webhook deserialization, D10/R6/§7.7).
 * The single most important shape this story freezes; story 009 lifts it into
 * `principles.md` and V0.3 (Ruby) / V0.4 (generator) must reproduce it.
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * For each `WebhookEvent_*` schema the generator emits, in order:
 *   1. `interface <Name>Data`        — the camelCase payload model (the `data` field);
 *   2. `interface <Name>DataWire`    — its snake_case wire mirror;
 *   3. `interface <Name>Event`       — `extends WebhookEventBase<'<type>', <Name>Data>`;
 *   4. `interface <Name>EventWire`   — `extends WebhookEventBaseWire` + `type`/`data` wire;
 *   5. `deserialize<Name>Data(raw)`  — wire payload → model payload (snake→camel);
 *   6. `deserialize<EventName>(raw)` — full event: envelope (inlined) + `data` (delegated).
 * The 15 `deserialize<EventName>` are aggregated in `./index.ts` into `EVENT_DESERIALIZERS`
 * (`Record<WebhookEventType, …>`), and `runtime/webhooks.ts` dispatches `[raw.type](raw)`.
 *
 * ── ⚠️ The `data` is a BESPOKE event payload, NOT the resource read-model ──
 * The openapi `WebhookEvent_CustomerCreated.data` (@3fcfd83) is a SLIMMER, event-specific
 * shape — it is NOT the `Customer` from `types/customer.ts`: it has NO `created_at`/`updated_at`,
 * `name`/`trading_name` are required (non-null), `kyc` is REQUIRED, and `status` is pinned to
 * `pending_kyc`. So this story does NOT reuse `deserializeCustomer`/`-CreditOffer`/`-Loan`
 * (their wires read fields the events do not carry). The ONLY shared sub-object deserializer is
 * `deserializeKycRequirement` — the discriminated union (story 004) reused for `data.kyc` here
 * and in `customer.kyc_updated`. This is the "recursive into sub-objects via the data types'
 * deserializers" of §7.7, made precise: per-type, never a generic deep snake→camel transform
 * (which would corrupt free-form maps). See the report / PROGRESS for the full 15→11 mapping.
 *
 * ── The four field rules (see `../types/customer.ts` header) ──
 *   R-EXPLICIT field-by-field, never reflective key-casing · R-ORDER keys alphabetical by
 *   target name · R-OPTIONAL absent optional omitted, required-but-nullable kept as `T | null`
 *   · R-EPOCH integer epoch-second timestamps stay `number`.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only sibling generated types (`./base.js`, `../types/ids.js`,
 * `../types/kyc/`) — never `runtime/`. The `*Event` model + `*Data` model are public surface
 * (generated barrel + `src/index.ts`); the `*Wire` types and the `deserialize*` are internal
 * (consumed by `runtime/webhooks.ts` via `./index.ts`, and by the conformance harness — 008).
 */

import {
  deserializeKycRequirement,
  type KycRequirement,
  type KycRequirementWire,
} from '../types/kyc/index.js';
import type { CustomerId } from '../types/ids.js';
import type { WebhookEventBase, WebhookEventBaseWire } from './base.js';

/**
 * Payload of a `customer.created` event — fires after co-owner enrichment populates the KYC
 * requirements; the customer is at `pending_kyc`. A bespoke subset of the customer (see the
 * module header) — notably no timestamps, and `kyc` is required.
 */
export interface CustomerCreatedData {
  /** Customer id, `cust_…`. */
  id: CustomerId;
  /** Partner external reference, or `null` (required, nullable). Wire: `external_id`. */
  externalId: string | null;
  /** Display name (always present on this event). */
  name: string;
  /** Contact email. */
  email: string;
  /** Contact phone, E.164. */
  phone: string;
  /** Customer CPF, formatted. */
  cpf: string;
  /** Company CNPJ, formatted, or `null`. Optional on the wire. */
  cnpj?: string | null;
  /** Company trading name (always present on this event). Wire: `trading_name`. */
  tradingName: string;
  /** Lifecycle status — pinned to `pending_kyc` for this event. */
  status: 'pending_kyc';
  /** KYC requirements populated after enrichment (required here). Each is a {@link KycRequirement}. */
  kyc: KycRequirement[];
}

/** Snake_case wire mirror of {@link CustomerCreatedData}. */
export interface CustomerCreatedDataWire {
  id: string;
  external_id: string | null;
  name: string;
  email: string;
  phone: string;
  cpf: string;
  cnpj?: string | null;
  trading_name: string;
  status: 'pending_kyc';
  kyc: KycRequirementWire[];
}

/** A verified `customer.created` event. */
export interface CustomerCreatedEvent extends WebhookEventBase<
  'customer.created',
  CustomerCreatedData
> {}

/** Snake_case wire mirror of {@link CustomerCreatedEvent}. */
export interface CustomerCreatedEventWire extends WebhookEventBaseWire {
  type: 'customer.created';
  data: CustomerCreatedDataWire;
}

/**
 * Decode the bespoke `customer.created` payload (snake→camel). `cnpj` is omitted when absent
 * (R-OPTIONAL); `kyc` is required and each entry runs through {@link deserializeKycRequirement}
 * (the discriminated dispatch — story 004), the one reused sub-object deserializer (§7.7).
 */
export function deserializeCustomerCreatedData(raw: CustomerCreatedDataWire): CustomerCreatedData {
  return {
    ...(raw.cnpj !== undefined ? { cnpj: raw.cnpj } : {}),
    cpf: raw.cpf,
    email: raw.email,
    externalId: raw.external_id,
    id: raw.id,
    kyc: raw.kyc.map(deserializeKycRequirement),
    name: raw.name,
    phone: raw.phone,
    status: raw.status,
    tradingName: raw.trading_name,
  };
}

/** Decode a full `customer.created` event: envelope inlined (R-ORDER), `data` delegated. */
export function deserializeCustomerCreated(raw: CustomerCreatedEventWire): CustomerCreatedEvent {
  return {
    apiVersion: raw.api_version,
    createdAt: raw.created_at,
    data: deserializeCustomerCreatedData(raw.data),
    deliveryId: raw.delivery_id,
    id: raw.id,
    timestamp: raw.timestamp,
    type: 'customer.created',
  };
}
