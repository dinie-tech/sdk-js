import * as nodeCrypto from 'node:crypto';

import { Webhooks, type VerifiedWebhookEvent } from '../../src/runtime/webhooks.js';
import { WebhookSignatureError, WebhookTimestampError } from '../../src/runtime/errors.js';
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
      expect(event.data).toMatchObject({ id: 'cus_test_123', taxId: '12345678000190' });
    });

    it('narrows to a caller-provided event type via the `E` type parameter', () => {
      interface CustomerCreatedEvent extends VerifiedWebhookEvent {
        type: 'customer.created';
        data: { id: string; taxId: string };
      }
      const { headers, body, secret } = signWebhook();

      const event = Webhooks.extract<CustomerCreatedEvent>({ headers, body, secret });

      // `event.data` is typed (no cast) — compile-time proof the generic flows through.
      expect(event.data.taxId).toBe('12345678000190');
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
});
