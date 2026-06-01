import * as nodeCrypto from 'node:crypto';

import { Webhooks } from '../../src/runtime/webhooks.js';
import {
  UnknownWebhookEventError,
  WebhookSignatureError,
  WebhookTimestampError,
} from '../../src/runtime/errors.js';
import {
  OTHER_WEBHOOK_SECRET,
  TEST_WEBHOOK_SECRET,
  computeSignature,
  defaultEventBody,
  signWebhook,
  signWebhookWithRotation,
} from '../_helpers/webhook-fixtures.js';

// `node:crypto` exports are non-configurable, so `vi.spyOn` can't wrap them. Mock
// the module with a pass-through spy on `timingSafeEqual` (real implementation kept)
// so the constant-time test can assert the comparison path without altering behavior.
vi.mock('node:crypto', async (importActual) => {
  const actual = await importActual<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

describe('Webhooks.extract', () => {
  describe('valid signature → typed event', () => {
    it('verifies and returns the parsed, discriminated event', () => {
      const { headers, body, secret } = signWebhook();

      const event = Webhooks.extract({ headers, body, secret });

      expect(event.type).toBe('customer.created');
      expect(event.id).toBe('evt_test_123');
      expect(event.data).toMatchObject({ id: 'cust_test_123', cpf: '123.456.789-00' });
    });

    it('deserializes the FULL envelope to camelCase (api_version/delivery_id/timestamp — R5)', () => {
      const { headers, body, secret } = signWebhook();

      const event = Webhooks.extract({ headers, body, secret });

      // V0.1 dropped these three; V0.2 freezes the full envelope, mapped snake→camel.
      expect(event.apiVersion).toBe('2026-03-01');
      expect(event.deliveryId).toBe('dlv_test_123');
      expect(event.createdAt).toBe(1775253600);
      expect(event.timestamp).toBe(1775253600);
      // epoch seconds stay `number` (R-EPOCH) — never coerced to Date.
      expect(typeof event.createdAt).toBe('number');
      // The wire snake_case keys must NOT leak onto the surface.
      expect(event).not.toHaveProperty('api_version');
      expect(event).not.toHaveProperty('delivery_id');
    });

    it('deserializes the data per type (snake_case wire → camelCase surface, not a blind cast)', () => {
      const { headers, body, secret } = signWebhook();

      const event = Webhooks.extract({ headers, body, secret });

      if (event.type === 'customer.created') {
        // `trading_name` → `tradingName`; nested `kyc` decoded via the discriminated union.
        expect(event.data.tradingName).toBe('Acme');
        expect(event.data).not.toHaveProperty('trading_name');
        expect(event.data.kyc[0]).toMatchObject({ requirementType: 'identity' });
        expect(event.data.kyc[0]).not.toHaveProperty('requirement_type');
      }
    });

    it('returns the concrete WebhookEvent union, narrowable by `type` (no generic)', () => {
      const { headers, body, secret } = signWebhook();

      // `extract` returns the openapi `WebhookEvent` union straight from generated/events
      // (story 011) — no `<E>` parameter. The discriminant narrows `data` to `Customer`.
      const event = Webhooks.extract({ headers, body, secret });

      expect(event.type).toBe('customer.created');
      if (event.type === 'customer.created') {
        expect(event.data.cpf).toBe('123.456.789-00');
      }
    });

    it('accepts a raw Buffer body (verifies the exact bytes received)', () => {
      const { headers, body, secret } = signWebhook();

      const event = Webhooks.extract({ headers, body: Buffer.from(body, 'utf-8'), secret });

      expect(event.type).toBe('customer.created');
    });
  });

  describe('invalid signature → WebhookSignatureError', () => {
    it('rejects a forged signature value', () => {
      const { headers, body } = signWebhook({ forgeSignature: 'Zm9yZ2VkLXNpZ25hdHVyZQ==' });

      expect(() => Webhooks.extract({ headers, body, secret: TEST_WEBHOOK_SECRET })).toThrow(
        WebhookSignatureError,
      );
    });

    it('rejects a payload signed with a different secret', () => {
      const { headers, body } = signWebhook({ secret: OTHER_WEBHOOK_SECRET });

      expect(() => Webhooks.extract({ headers, body, secret: TEST_WEBHOOK_SECRET })).toThrow(
        WebhookSignatureError,
      );
    });

    it('rejects a tampered body (signature no longer covers it)', () => {
      const { headers, secret } = signWebhook();
      const tamperedBody = defaultEventBody({ id: 'evt_attacker' });

      expect(() => Webhooks.extract({ headers, body: tamperedBody, secret })).toThrow(
        WebhookSignatureError,
      );
    });

    it('rejects a wrong-length signature without crashing (length-guarded compare)', () => {
      // base64 of 4 bytes — never 32, so the timingSafeEqual length guard short-circuits.
      const { headers, body } = signWebhook({
        forgeSignature: Buffer.from('abcd').toString('base64'),
      });

      expect(() => Webhooks.extract({ headers, body, secret: TEST_WEBHOOK_SECRET })).toThrow(
        WebhookSignatureError,
      );
    });

    it('never returns an unverified event', () => {
      const { headers, body } = signWebhook({ forgeSignature: 'bm9wZQ==' });

      let returned: unknown;
      try {
        returned = Webhooks.extract({ headers, body, secret: TEST_WEBHOOK_SECRET });
      } catch {
        returned = undefined;
      }
      expect(returned).toBeUndefined();
    });
  });

  describe('timestamp window (bidirectional) → WebhookTimestampError', () => {
    it('rejects a timestamp that is too old', () => {
      const { headers, body, secret } = signWebhook({
        timestampSeconds: Math.floor(Date.now() / 1000) - 10_000,
      });

      expect(() => Webhooks.extract({ headers, body, secret })).toThrow(WebhookTimestampError);
    });

    it('rejects a timestamp too far in the future', () => {
      const { headers, body, secret } = signWebhook({
        timestampSeconds: Math.floor(Date.now() / 1000) + 10_000,
      });

      expect(() => Webhooks.extract({ headers, body, secret })).toThrow(WebhookTimestampError);
    });

    it('honors a custom toleranceSeconds window', () => {
      const timestampSeconds = Math.floor(Date.now() / 1000) - 120;
      const { headers, body, secret } = signWebhook({ timestampSeconds });

      // Default 300s would accept; a tight 60s window rejects.
      expect(() => Webhooks.extract({ headers, body, secret, toleranceSeconds: 60 })).toThrow(
        WebhookTimestampError,
      );
      expect(Webhooks.extract({ headers, body, secret, toleranceSeconds: 600 }).type).toBe(
        'customer.created',
      );
    });

    it('rejects a malformed (non-numeric) timestamp', () => {
      const { headers, body, secret } = signWebhook();
      headers['webhook-timestamp'] = 'not-a-number';

      expect(() => Webhooks.extract({ headers, body, secret })).toThrow(WebhookTimestampError);
    });

    it('checks the timestamp before the signature (replay guard precedes HMAC)', () => {
      const { headers, body } = signWebhook({
        timestampSeconds: Math.floor(Date.now() / 1000) - 10_000,
        forgeSignature: 'bm90LWNoZWNrZWQ=',
      });

      expect(() => Webhooks.extract({ headers, body, secret: TEST_WEBHOOK_SECRET })).toThrow(
        WebhookTimestampError,
      );
    });
  });

  describe('multi-signature (rotation)', () => {
    it('passes when one of several signatures matches', () => {
      const { headers, body, secret } = signWebhookWithRotation();

      const event = Webhooks.extract({ headers, body, secret });

      expect(event.type).toBe('customer.created');
    });

    it('accepts secret as a list — passes if any secret verifies (rotation)', () => {
      const { headers, body } = signWebhook({ secret: TEST_WEBHOOK_SECRET });

      const event = Webhooks.extract({
        headers,
        body,
        secret: [OTHER_WEBHOOK_SECRET, TEST_WEBHOOK_SECRET],
      });

      expect(event.type).toBe('customer.created');
    });

    it('rejects when no secret in the list verifies', () => {
      const { headers, body } = signWebhook({ secret: TEST_WEBHOOK_SECRET });

      expect(() =>
        Webhooks.extract({ headers, body, secret: [OTHER_WEBHOOK_SECRET, 'whsec_unrelated'] }),
      ).toThrow(WebhookSignatureError);
    });
  });

  describe('secret decoding', () => {
    it('decodes a `whsec_` secret as base64 before HMAC', () => {
      // computeSignature decodes whsec_ itself; a successful verify proves the
      // runtime decoded identically (a raw-UTF-8 read of the secret would mismatch).
      const { headers, body, secret } = signWebhook({ secret: TEST_WEBHOOK_SECRET });

      expect(Webhooks.extract({ headers, body, secret }).type).toBe('customer.created');
    });

    it('accepts a raw (non-`whsec_`) secret as UTF-8', () => {
      const rawSecret = 'plain-utf8-secret';
      const { headers, body } = signWebhook({ secret: rawSecret });

      expect(Webhooks.extract({ headers, body, secret: rawSecret }).type).toBe('customer.created');
    });
  });

  describe('constant-time comparison', () => {
    it('compares via crypto.timingSafeEqual, not string ===', () => {
      const spy = vi.mocked(nodeCrypto.timingSafeEqual);
      spy.mockClear();
      const { headers, body, secret } = signWebhook();

      Webhooks.extract({ headers, body, secret });

      expect(spy).toHaveBeenCalled();
      const [a, b] = spy.mock.calls[0]!;
      expect(Buffer.isBuffer(a)).toBe(true);
      expect(Buffer.isBuffer(b)).toBe(true);
      // HMAC-SHA256 digests are 32 bytes; equal-length buffers feed timingSafeEqual.
      expect((a as Buffer).length).toBe(32);
      expect((b as Buffer).length).toBe(32);
    });
  });

  describe('missing headers', () => {
    it('throws WebhookSignatureError when webhook-id is absent', () => {
      const { headers, body, secret } = signWebhook();
      delete (headers as Record<string, string | undefined>)['webhook-id'];

      expect(() => Webhooks.extract({ headers, body, secret })).toThrow(WebhookSignatureError);
    });

    it('throws WebhookTimestampError when webhook-timestamp is absent', () => {
      const { headers, body, secret } = signWebhook();
      delete (headers as Record<string, string | undefined>)['webhook-timestamp'];

      expect(() => Webhooks.extract({ headers, body, secret })).toThrow(WebhookTimestampError);
    });

    it('throws WebhookSignatureError when webhook-signature is absent', () => {
      const { headers, body, secret } = signWebhook();
      delete (headers as Record<string, string | undefined>)['webhook-signature'];

      expect(() => Webhooks.extract({ headers, body, secret })).toThrow(WebhookSignatureError);
    });

    it('looks up headers case-insensitively', () => {
      const ts = Math.floor(Date.now() / 1000);
      const body = defaultEventBody();
      const signature = computeSignature('evt_test_123', ts, body, TEST_WEBHOOK_SECRET);

      const event = Webhooks.extract({
        headers: {
          'Webhook-Id': 'evt_test_123',
          'Webhook-Timestamp': String(ts),
          'Webhook-Signature': `v1,${signature}`,
        },
        body,
        secret: TEST_WEBHOOK_SECRET,
      });

      expect(event.type).toBe('customer.created');
    });
  });

  describe('unknown event type → UnknownWebhookEventError (OQ#2)', () => {
    /** A signed body whose `type` is not in the openapi catalog. */
    function signUnknown(type: unknown): { headers: Record<string, string>; body: string } {
      const body = JSON.stringify({
        id: 'evt_test_123',
        type,
        api_version: '2026-03-01',
        created_at: 1775253600,
        delivery_id: 'dlv_test_123',
        timestamp: 1775253600,
        data: {},
      });
      const { headers } = signWebhook({ body });
      return { headers, body };
    }

    it('throws when a VERIFIED payload carries a type absent from the catalog', () => {
      const { headers, body } = signUnknown('customer.exploded');

      expect(() => Webhooks.extract({ headers, body, secret: TEST_WEBHOOK_SECRET })).toThrow(
        UnknownWebhookEventError,
      );
    });

    it('preserves the unrecognized `type` on the error', () => {
      const { headers, body } = signUnknown('loan.exploded');

      let caught: unknown;
      try {
        Webhooks.extract({ headers, body, secret: TEST_WEBHOOK_SECRET });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(UnknownWebhookEventError);
      expect((caught as UnknownWebhookEventError).eventType).toBe('loan.exploded');
    });

    it('does not match inherited Object keys (e.g. `toString`) as known types', () => {
      const { headers, body } = signUnknown('toString');

      expect(() => Webhooks.extract({ headers, body, secret: TEST_WEBHOOK_SECRET })).toThrow(
        UnknownWebhookEventError,
      );
    });

    it('verifies the signature BEFORE the type check (a forged unknown fails as signature)', () => {
      const { headers, body } = signUnknown('whatever');
      headers['webhook-signature'] = 'v1,Zm9yZ2VkLXNpZ25hdHVyZQ==';

      // Deserialization (and the unknown-type guard) only runs after the HMAC matches.
      expect(() => Webhooks.extract({ headers, body, secret: TEST_WEBHOOK_SECRET })).toThrow(
        WebhookSignatureError,
      );
    });
  });
});
