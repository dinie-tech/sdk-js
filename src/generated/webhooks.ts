/**
 * Public `Webhooks` — the runtime verifier with the concrete event union bound.
 * Hand-authored in V0.1 to mirror future generator output (D1).
 *
 * The runtime `Webhooks.extract<E>` is generic about the event shape so that `runtime/`
 * never imports `generated/` (the story-005 boundary tension). This thin wrapper binds
 * the type parameter to the concrete {@link WebhookEvent} union (a `generated/` type), so
 * a verified event narrows by `type` (`event.type === 'customer.created'` ⇒
 * `event.data: Customer`). Runtime behavior is unchanged — only the static return type
 * is sharpened (architecture §4.4 / §6, D8).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports the runtime verifier + input type (allowed: generated →
 * runtime) and a sibling generated event union — never the reverse.
 */

import type { WebhookExtractInput } from '../runtime/index.js';
import { Webhooks as RuntimeWebhooks } from '../runtime/index.js';

import type { WebhookEvent } from './events/customer-created.js';

/**
 * Verify a Standard Webhooks v1 payload and return the parsed, typed event.
 *
 * @throws {import('../runtime/index.js').WebhookSignatureError} No signature matched (or a
 *   required header / secret is missing).
 * @throws {import('../runtime/index.js').WebhookTimestampError} The timestamp is missing,
 *   malformed, or outside the tolerance window.
 *
 * @example
 * const event = Webhooks.extract({ headers, body, secret });
 * if (event.type === 'customer.created') {
 *   event.data; // Customer
 * }
 */
export const Webhooks = {
  extract(input: WebhookExtractInput): WebhookEvent {
    return RuntimeWebhooks.extract<WebhookEvent>(input);
  },
};
