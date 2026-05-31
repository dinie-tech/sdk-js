/**
 * `customer.created` event + the `WebhookEvent` union (architecture §4.4).
 * Hand-authored in V0.1 to mirror future generator output (D1); the union has a single
 * member now and grows to 15 events in V0.2.
 *
 * The concrete `WebhookEvent` union lives HERE (in `generated/`) because `openapi.yaml`
 * (`webhooks:`) is its source of truth. `runtime/webhooks.ts` imports it directly (the
 * controlled inverse import — story 011) and `Webhooks.extract` returns it, so a verified
 * event narrows by `type` (`event.type === 'customer.created'` ⇒ `event.data: Customer`).
 * If an event is not in openapi it is not defined here, and `runtime/webhooks.ts` will not
 * compile — the openapi-SoT forcing function (architecture §4.4 / §6, §13 #10).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only a sibling generated type (`Customer`) — never
 * `runtime/`. Re-exported as public surface via the generated barrel and `src/index.ts`.
 * NOTE: `runtime/webhooks.ts` imports `WebhookEvent` from here — the one declared exception
 * to "runtime never imports generated" (the forcing function described above).
 */

import type { Customer } from '../types/customer.js';

/** Emitted when a customer is created (`evt_…`). */
export interface CustomerCreatedEvent {
  /** Stable event id, `evt_…`. */
  id: string;
  /** Discriminant. */
  type: 'customer.created';
  /** Creation instant, ISO 8601. */
  createdAt: string;
  /** The created customer. */
  data: Customer;
}

/**
 * Discriminated union of every Dinie webhook event. One member in V0.1; grows with each
 * event in V0.2. `src/index.ts` binds `Webhooks.extract` to this so `event.type` narrows.
 */
export type WebhookEvent = CustomerCreatedEvent;
