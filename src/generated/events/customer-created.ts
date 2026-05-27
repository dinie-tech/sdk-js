/**
 * `customer.created` event + the `WebhookEvent` union (architecture §4.4).
 * Hand-authored in V0.1 to mirror future generator output (D1); the union has a single
 * member now and grows to 15 events in V0.2.
 *
 * The concrete `WebhookEvent` union lives HERE (in `generated/`), deliberately. The
 * runtime `Webhooks.extract` is generic over the event shape (`VerifiedWebhookEvent`);
 * `src/index.ts` binds it to this union so a verified event narrows by `type` — this
 * resolves the runtime↔generated webhook boundary without `runtime/` ever importing
 * `generated/` (story 005 tension; architecture §4.4 / §6).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only a sibling generated type (`Customer`) — never
 * `runtime/`. Re-exported as public surface via the generated barrel and `src/index.ts`.
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
