/**
 * `WebhookEventBase` — the common webhook ENVELOPE shared by all 11 `WebhookEvent_*`
 * schemas (architecture §3.3, §4 R5). Hand-authored in V0.2 to mirror what the generator
 * will emit from `components.schemas.WebhookEventBase` (V0.4 overwrites in place — D1).
 *
 * ── Why a dedicated module (a small deviation from the §13 file manifesto) ──
 * Every event schema is an openapi `allOf: [WebhookEventBase, {type, data}]`. The base must
 * live somewhere both the 11 event modules AND the `index.ts` union/table can import without
 * a cycle (`index.ts` imports the events; the events import the base). `index.ts` cannot host
 * it (the events would then import from the barrel that imports them). So the shared envelope
 * lives here — the one file the manifesto's "events/" list does not name explicitly.
 *
 * ── Envelope field map (openapi `components.schemas.WebhookEventBase` @ 3fcfd83) ──
 *   wire (snake_case)   → model (camelCase)   → type
 *   id                  → id                  → EventId            (`evt_…`)
 *   type                → type                → <literal>          (narrowed per member)
 *   api_version         → apiVersion          → string             (e.g. `2026-03-01`)
 *   created_at          → createdAt           → number (epoch seconds, R-EPOCH)
 *   delivery_id         → deliveryId          → string             (`dlv_…`, plain string)
 *   timestamp           → timestamp           → number (epoch seconds, R-EPOCH)
 *   data                → data                → <event-specific>   (narrowed per member)
 *
 * ⚠️ Reconciliation R5 (architecture §4): the V0.1 sketch typed an event as
 * `{ id, type, createdAt, data }` — MISSING `apiVersion`, `deliveryId`, `timestamp`. V0.2
 * freezes the full envelope. `createdAt`/`timestamp` are integer epoch seconds (R-EPOCH),
 * NEVER `Date`. `delivery_id` has no `*Id` schema in the contract (no pattern), so it is a
 * plain `string`, not a branded id (see `ids.ts`).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only the sibling generated id type (`./ids.js`) — never
 * `runtime/`. The base type is generic over the discriminant + payload so each member
 * (`./customer-created.ts`, …) extends it with a `const` `type` literal and its concrete
 * `data`, yielding the 15-member discriminated `WebhookEvent` union in `./index.ts`.
 */

import type { EventId } from '../types/ids.js';

/**
 * The Standard Webhooks envelope, generic over the discriminant `TType` (a `const` `type`
 * literal) and the event-specific `TData` payload. Each of the 15 union members extends this
 * with its own `type` literal + `data` shape (architecture §3.3). The seven fields match the
 * acceptance criterion `{ id, type, apiVersion, createdAt, deliveryId, timestamp, data }`.
 */
export interface WebhookEventBase<TType extends string, TData> {
  /** Stable event id, `evt_…`. */
  id: EventId;
  /** Discriminant — the event `type` (narrowed to a literal per member). */
  type: TType;
  /** API version that generated this event (e.g. `2026-03-01`). Wire: `api_version`. */
  apiVersion: string;
  /** Event creation instant, epoch seconds (R-EPOCH). Wire: `created_at`. */
  createdAt: number;
  /** Unique delivery-attempt id, `dlv_…` (plain string — no contract pattern). Wire: `delivery_id`. */
  deliveryId: string;
  /** Instant the event occurred, epoch seconds (R-EPOCH). */
  timestamp: number;
  /** Event-specific payload (narrowed per member). */
  data: TData;
}

/**
 * Snake_case wire mirror of the envelope fields {@link WebhookEventBase} shares. Each event's
 * `*EventWire` extends this and narrows `type` + adds its `data` wire shape. Decoded field-by-
 * field inside every `deserialize<EventName>` (the envelope is inlined per member — what a
 * generator emits when flattening the `allOf`, keeping each deserializer self-contained).
 */
export interface WebhookEventBaseWire {
  id: string;
  type: string;
  api_version: string;
  created_at: number;
  delivery_id: string;
  timestamp: number;
}
