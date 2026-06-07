/**
 * Generated-surface E2E for the WEBHOOK EVENT layer (story 007) — the second V0.2 hotspot.
 * Proves the public, type-bound `Webhooks.extract` (from `@dinie/sdk`):
 *   - verifies + per-type deserializes ALL 15 event types into honest camelCase events;
 *   - exposes the FULL envelope (apiVersion/createdAt/deliveryId/timestamp — R5);
 *   - narrows `event.data` to the exact bespoke payload on the `type` discriminant (all 15
 *     branches, compile-time `expectTypeOf` + runtime);
 *   - throws `UnknownWebhookEventError` for a verified-but-uncatalogued `type` (OQ#2), and
 *     `WebhookSignatureError` for a tampered signature — NEVER returning an unverified event.
 *
 * Network-free by construction (verification is pure crypto). The signing fixtures carry their
 * OWN independent HMAC, so this is a real contract test, not a tautology. The exhaustive
 * verifier cases (timestamp window, multi-sig/rotation, constant-time, whsec_ decoding,
 * unknown-type guard ordering) live in `tests/runtime/webhooks.test.ts`; here we prove the
 * PUBLIC binding, the per-type deserialization, and the discriminated narrowing.
 */

import { UnknownWebhookEventError, WebhookSignatureError, Webhooks } from '../../src/index.js';
import type {
  CreditOfferData,
  CustomerCreatedData,
  CustomerCreatedEvent,
  CustomerDeniedData,
  CustomerKycUpdatedData,
  CustomerStatusData,
  LoanActiveData,
  LoanCreatedData,
  LoanPaymentReceivedData,
  LoanProcessingData,
  LoanSignatureReceivedData,
  LoanStatusData,
  WebhookEvent,
} from '../../src/index.js';
import { ALL_WEBHOOK_EVENT_TYPES, signEvent, signWebhook } from '../_helpers/webhook-fixtures.js';

describe('Webhooks.extract — all 15 webhook events (story 007)', () => {
  describe('verifies + deserializes every event type into a camelCase event', () => {
    it.each(ALL_WEBHOOK_EVENT_TYPES)(
      '%s → typed event with full camelCase envelope (R5)',
      (type) => {
        const event = Webhooks.extract(signEvent(type));

        expect(event.type).toBe(type);
        // Full envelope (R5 — V0.1 dropped apiVersion/deliveryId/timestamp), mapped snake→camel.
        expect(event.id).toBe('evt_test_123');
        expect(event.apiVersion).toBe('2026-03-01');
        expect(event.deliveryId).toBe('dlv_test_123');
        expect(event.createdAt).toBe(1775253600);
        expect(event.timestamp).toBe(1775253600);
        // epoch seconds stay numbers (R-EPOCH); wire snake_case keys must NOT leak.
        expect(typeof event.createdAt).toBe('number');
        expect(event).not.toHaveProperty('api_version');
        expect(event).not.toHaveProperty('delivery_id');
      },
    );

    it('returns exactly the 15 catalogued types (fixture/catalog completeness)', () => {
      expect(ALL_WEBHOOK_EVENT_TYPES).toHaveLength(15);
      expect(new Set(ALL_WEBHOOK_EVENT_TYPES).size).toBe(15);
    });
  });

  describe('per-type payload deserialization (snake→camel, nested decoders)', () => {
    it('customer.created → bespoke data; KYC array decoded via the discriminated union', () => {
      const event = Webhooks.extract(signEvent('customer.created'));
      if (event.type !== 'customer.created') throw new Error('narrowing failed');

      expect(event.data.id).toBe('cust_test_123');
      expect(event.data.externalId).toBeNull();
      expect(event.data.tradingName).toBe('Acme'); // trading_name → tradingName
      expect(event.data.status).toBe('pending_kyc');
      expect(event.data).not.toHaveProperty('trading_name');
      // kyc is required here and decoded by deserializeKycRequirement (the reused sub-decoder).
      expect(event.data.kyc[0]).toMatchObject({ requirementType: 'identity' });
      expect(event.data.kyc[0]).not.toHaveProperty('requirement_type');
    });

    it('customer.under_review → minimal status subset', () => {
      const event = Webhooks.extract(signEvent('customer.under_review'));
      if (event.type !== 'customer.under_review') throw new Error('narrowing failed');

      expect(event.data.status).toBe('under_review');
      expect(event.data.externalId).toBe('partner-ref-1');
      expect(event.data).not.toHaveProperty('name'); // bespoke subset, not the Customer model
    });

    it('credit_offer.available → camelCase money/ids; due_date_rule mapped', () => {
      const event = Webhooks.extract(signEvent('credit_offer.available'));
      if (event.type !== 'credit_offer.available') throw new Error('narrowing failed');

      expect(event.data.customerId).toBe('cust_test_123'); // customer_id → customerId
      expect(event.data.approvedAmount).toBe(50000); // approved_amount → approvedAmount
      expect(event.data.monthlyInterestRate).toBe(2.5);
      expect(event.data.dueDateRule).toBeNull();
      expect(event.data).not.toHaveProperty('approved_amount');
    });

    it('credit_offer.expired → omits absent optional due_date_rule (R-OPTIONAL)', () => {
      const event = Webhooks.extract(signEvent('credit_offer.expired'));
      if (event.type !== 'credit_offer.expired') throw new Error('narrowing failed');

      expect(event.data.status).toBe('expired');
      expect(event.data).not.toHaveProperty('dueDateRule'); // absent optional omitted, not undefined
    });

    it('loan.signature_received → nested signer decoded (signed_at → signedAt)', () => {
      const event = Webhooks.extract(signEvent('loan.signature_received'));
      if (event.type !== 'loan.signature_received') throw new Error('narrowing failed');

      expect(event.data.signaturesReceived).toBe(1); // signatures_received → signaturesReceived
      expect(event.data.signaturesRequired).toBe(2);
      expect(event.data.signer.signedAt).toBe(1775253600); // nested snake→camel
      expect(event.data.signer).not.toHaveProperty('signed_at');
    });

    it('loan.payment_received → nested payment decoded (paid_at/installment_number)', () => {
      const event = Webhooks.extract(signEvent('loan.payment_received'));
      if (event.type !== 'loan.payment_received') throw new Error('narrowing failed');

      expect(event.data.payment.amount).toBe(875.5);
      expect(event.data.payment.paidAt).toBe(1775253600); // paid_at → paidAt
      expect(event.data.payment.installmentNumber).toBe(1); // installment_number → installmentNumber
      expect(event.data.payment).not.toHaveProperty('paid_at');
    });

    it('loan.error → carries decoded error details; finished/cancelled omit them', () => {
      const errored = Webhooks.extract(signEvent('loan.error'));
      if (errored.type !== 'loan.error') throw new Error('narrowing failed');
      expect(errored.data.error).toEqual({
        code: 'disbursement_failed',
        message: 'Bank rejected the transfer.',
      });

      const finished = Webhooks.extract(signEvent('loan.finished'));
      if (finished.type !== 'loan.finished') throw new Error('narrowing failed');
      expect(finished.data.status).toBe('finished');
      expect(finished.data).not.toHaveProperty('error'); // optional, absent → omitted
    });
  });

  describe('discriminated narrowing — compile-time `expectTypeOf` across all 15 branches', () => {
    it('narrows event.data to the exact bespoke payload per type', () => {
      // A `switch (event.type)` narrows `event.data` to the right payload in EACH of the 15
      // branches; the `never` default proves the union has no uncovered members (exhaustive).
      const assertNarrowing = (event: WebhookEvent): void => {
        switch (event.type) {
          case 'customer.created':
            expectTypeOf(event).toEqualTypeOf<CustomerCreatedEvent>();
            expectTypeOf(event.data).toEqualTypeOf<CustomerCreatedData>();
            break;
          case 'customer.under_review':
            expectTypeOf(event.data).toEqualTypeOf<CustomerStatusData>();
            break;
          case 'customer.active':
            expectTypeOf(event.data).toEqualTypeOf<CustomerStatusData>();
            break;
          case 'customer.denied':
            expectTypeOf(event.data).toEqualTypeOf<CustomerDeniedData>();
            break;
          case 'customer.kyc_updated':
            expectTypeOf(event.data).toEqualTypeOf<CustomerKycUpdatedData>();
            break;
          case 'credit_offer.available':
            expectTypeOf(event.data).toEqualTypeOf<CreditOfferData>();
            break;
          case 'credit_offer.expired':
            expectTypeOf(event.data).toEqualTypeOf<CreditOfferData>();
            break;
          case 'loan.created':
            expectTypeOf(event.data).toEqualTypeOf<LoanCreatedData>();
            break;
          case 'loan.signature_received':
            expectTypeOf(event.data).toEqualTypeOf<LoanSignatureReceivedData>();
            break;
          case 'loan.processing':
            expectTypeOf(event.data).toEqualTypeOf<LoanProcessingData>();
            break;
          case 'loan.active':
            expectTypeOf(event.data).toEqualTypeOf<LoanActiveData>();
            break;
          case 'loan.payment_received':
            expectTypeOf(event.data).toEqualTypeOf<LoanPaymentReceivedData>();
            break;
          case 'loan.finished':
            expectTypeOf(event.data).toEqualTypeOf<LoanStatusData>();
            break;
          case 'loan.cancelled':
            expectTypeOf(event.data).toEqualTypeOf<LoanStatusData>();
            break;
          case 'loan.error':
            expectTypeOf(event.data).toEqualTypeOf<LoanStatusData>();
            break;
          default:
            expectTypeOf(event).toEqualTypeOf<never>();
        }
      };

      expect(typeof assertNarrowing).toBe('function');
    });
  });

  describe('error paths — never returns an unverified or uncatalogued event', () => {
    it('throws WebhookSignatureError on a tampered signature', () => {
      const fixture = signEvent('loan.active', { forgeSignature: 'Zm9yZ2VkLXNpZ25hdHVyZQ==' });

      expect(() => Webhooks.extract(fixture)).toThrow(WebhookSignatureError);
    });

    it('throws UnknownWebhookEventError for a verified type not in the catalog (OQ#2)', () => {
      const body = JSON.stringify({
        id: 'evt_test_123',
        type: 'invoice.created', // not a Dinie event
        api_version: '2026-03-01',
        created_at: 1775253600,
        delivery_id: 'dlv_test_123',
        timestamp: 1775253600,
        data: {},
      });
      const { headers, secret } = signWebhook({ body });

      let caught: unknown;
      try {
        Webhooks.extract({ headers, body, secret });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(UnknownWebhookEventError);
      expect((caught as UnknownWebhookEventError).eventType).toBe('invoice.created');
    });
  });
});
