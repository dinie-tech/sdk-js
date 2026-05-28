/**
 * Generated-surface E2E (story 010) — the WEBHOOK half of the public surface. Proves the
 * public, type-bound `Webhooks.extract` (from `@dinie/sdk`) turns a signed Standard
 * Webhooks v1 payload into a typed `CustomerCreatedEvent` whose `data` narrows to
 * `Customer` on the `type` discriminant, and rejects a tampered signature with
 * `WebhookSignatureError` — NEVER returning an unverified event (§Demo, §5.2, §9.3, D8).
 *
 * Network-free by construction (verification is pure crypto — no transport at all). The
 * signing fixtures (`webhook-fixtures.ts`) carry their OWN independent HMAC, so this is a
 * real contract test, not a tautology against the runtime's own signer. The exhaustive
 * verifier cases (timestamp window, multi-sig/rotation, constant-time, whsec_ decoding)
 * live in the runtime webhooks test; here we prove the PUBLIC binding and narrowing.
 */

import { Webhooks, WebhookSignatureError } from '../../src/index.js';
import type { Customer, CustomerCreatedEvent, WebhookEvent } from '../../src/index.js';
import { signWebhook } from '../_helpers/webhook-fixtures.js';

describe('Webhooks.extract — public typed CustomerCreatedEvent (D8)', () => {
  it('verifies a signed customer.created and narrows event.data to Customer', () => {
    const fixture = signWebhook();

    const event: WebhookEvent = Webhooks.extract({
      headers: fixture.headers,
      body: fixture.body,
      secret: fixture.secret,
    });

    expect(event.type).toBe('customer.created');
    // The discriminant narrows `event.data` to `Customer` at compile time AND runtime.
    if (event.type === 'customer.created') {
      // Compile-time proof: the narrowed event is exactly a CustomerCreatedEvent.
      expectTypeOf(event).toEqualTypeOf<CustomerCreatedEvent>();
      const created: Customer = event.data;
      expect(created.id).toBe('cus_test_123');
      expect(created.object).toBe('customer');
      expect(created.taxId).toBe('12345678000190');
      expect(created.name).toBe('Acme Pagamentos Ltda');
    }
  });

  it('throws WebhookSignatureError on a tampered signature — never returns an unverified event', () => {
    // Valid id/timestamp/body, but a forged (non-matching) signature value.
    const fixture = signWebhook({ forgeSignature: 'Zm9yZ2VkLXNpZ25hdHVyZQ==' });

    expect(() =>
      Webhooks.extract({ headers: fixture.headers, body: fixture.body, secret: fixture.secret }),
    ).toThrow(WebhookSignatureError);
  });
});
