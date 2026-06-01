/**
 * Standard Webhooks v1 signing fixtures — born in story 005, expanded in story 007 to cover
 * all 15 event types as SNAKE_CASE WIRE bodies (the bytes Dinie actually sends).
 *
 * Mirrors the signing side of the contract `Webhooks.extract` verifies:
 *
 *   signedPayload = `${id}.${timestamp}.${body}`
 *   signature     = base64(HMAC-SHA256(decodeSecret(secret), signedPayload))
 *   header        = "v1,<sig>"   // space-join more tokens for rotation / multi-sig
 *
 * The signing helpers are deliberately INDEPENDENT of the runtime implementation (their own
 * HMAC) so the tests prove the contract end-to-end, not a tautology. The bodies are snake_case
 * (V0.1 used camelCase — story 007 makes `extract` deserialize per type, so the wire is now
 * honest snake_case and the SDK maps it to camelCase).
 */

import { createHmac } from 'node:crypto';

import type { WebhookEventType } from '../../src/index.js';

/** Default test secret (`whsec_` + base64 — exercises secret decoding). */
export const TEST_WEBHOOK_SECRET = `whsec_${Buffer.from('dinie-test-webhook-secret').toString('base64')}`;

/** A second, unrelated secret — useful for "signed with the wrong key" cases. */
export const OTHER_WEBHOOK_SECRET = `whsec_${Buffer.from('dinie-other-webhook-secret').toString('base64')}`;

/** A signed webhook ready to hand to `Webhooks.extract`. */
export interface WebhookFixture {
  headers: Record<string, string>;
  body: string;
  secret: string;
}

export interface SignWebhookOptions {
  /** `webhook-id`. Default `evt_test_123`. */
  id?: string;
  /** `webhook-timestamp`, in Unix seconds. Default: now. */
  timestampSeconds?: number;
  /** Raw body string. Default: a `customer.created`-shaped wire event. */
  body?: string;
  /** Signing secret. Default {@link TEST_WEBHOOK_SECRET}. */
  secret?: string;
  /**
   * Extra `v1,<sig>` tokens placed BEFORE the valid one, simulating multi-sig /
   * rotation where an older signature precedes the matching one in the header.
   */
  precedingSignatureTokens?: string[];
  /** Replace the otherwise-valid signature value (base64), forging an invalid sig. */
  forgeSignature?: string;
}

/** Decode a secret the same way the runtime does (`whsec_` → base64, else UTF-8). */
function decodeSecret(secret: string): Buffer {
  return secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64')
    : Buffer.from(secret, 'utf-8');
}

/** Compute the base64 HMAC-SHA256 signature for `${id}.${timestamp}.${body}`. */
export function computeSignature(
  id: string,
  timestampSeconds: number,
  body: string,
  secret: string = TEST_WEBHOOK_SECRET,
): string {
  const signedPayload = `${id}.${timestampSeconds}.${body}`;
  return createHmac('sha256', decodeSecret(secret)).update(signedPayload).digest('base64');
}

// ── Wire bodies (snake_case — what the SDK deserializes per type, story 007) ──────

/** One valid `KycRequirement` wire entry (`identity`), mirroring the openapi example. */
const IDENTITY_REQUIREMENT_WIRE = {
  requirement_id: 'identity_003XXXXXXXXXXXXXXX',
  requirement_type: 'identity',
  label: 'Documento de identidade',
  mandatory: true,
  subject: { id: '003XXXXXXXXXXXXXXX', name: 'Joao Silva', subject_type: 'applicant' },
};

/** Build the shared snake_case envelope for an event `type`. */
function wireEnvelope(type: WebhookEventType): Record<string, unknown> {
  return {
    id: 'evt_test_123',
    type,
    api_version: '2026-03-01',
    created_at: 1775253600,
    delivery_id: 'dlv_test_123',
    timestamp: 1775253600,
  };
}

/**
 * A valid snake_case WIRE body per event `type` (envelope + `data`). Keyed by every
 * {@link WebhookEventType}, so `tsc` fails if a fixture is missing (15-fixture completeness).
 * Some entries deliberately omit an optional field (`due_date_rule`, `cnpj`) to exercise
 * R-OPTIONAL on the deserialization side.
 */
export const WEBHOOK_EVENT_WIRE_BODIES: Record<WebhookEventType, Record<string, unknown>> = {
  'customer.created': {
    ...wireEnvelope('customer.created'),
    data: {
      id: 'cust_test_123',
      external_id: null,
      name: 'Acme Pagamentos Ltda',
      email: 'ops@acme.test',
      phone: '+5511999999999',
      cpf: '123.456.789-00',
      cnpj: '12.345.678/0001-90',
      trading_name: 'Acme',
      status: 'pending_kyc',
      kyc: [IDENTITY_REQUIREMENT_WIRE],
    },
  },
  'customer.under_review': {
    ...wireEnvelope('customer.under_review'),
    data: { id: 'cust_test_123', external_id: 'partner-ref-1', status: 'under_review' },
  },
  'customer.active': {
    ...wireEnvelope('customer.active'),
    data: { id: 'cust_test_123', external_id: null, status: 'active' },
  },
  'customer.denied': {
    ...wireEnvelope('customer.denied'),
    data: {
      id: 'cust_test_123',
      external_id: null,
      name: 'Acme Pagamentos Ltda',
      email: 'ops@acme.test',
      phone: '+5511999999999',
      cpf: '123.456.789-00',
      cnpj: '12.345.678/0001-90',
      status: 'denied',
    },
  },
  'customer.kyc_updated': {
    ...wireEnvelope('customer.kyc_updated'),
    data: {
      id: 'cust_test_123',
      external_id: null,
      status: 'under_review',
      kyc: [IDENTITY_REQUIREMENT_WIRE],
    },
  },
  'credit_offer.available': {
    ...wireEnvelope('credit_offer.available'),
    data: {
      id: 'co_test_123',
      customer_id: 'cust_test_123',
      external_id: 'partner-ref-123',
      status: 'available',
      approved_amount: 50000,
      min_amount: 1000,
      monthly_interest_rate: 2.5,
      installments: 12,
      due_date_rule: null,
      valid_until: 1775340000,
    },
  },
  'credit_offer.expired': {
    ...wireEnvelope('credit_offer.expired'),
    // due_date_rule omitted on purpose → exercises R-OPTIONAL.
    data: {
      id: 'co_test_123',
      customer_id: 'cust_test_123',
      external_id: null,
      status: 'expired',
      approved_amount: 50000,
      min_amount: 1000,
      monthly_interest_rate: 2.5,
      installments: 12,
      valid_until: 1775340000,
    },
  },
  'loan.created': {
    ...wireEnvelope('loan.created'),
    data: {
      id: 'ln_test_123',
      credit_offer_id: 'co_test_123',
      customer_id: 'cust_test_123',
      status: 'awaiting_signatures',
      requested_amount: 10000,
      installment_count: 12,
      signing_url: 'https://clicksign.test/sign/abc',
    },
  },
  'loan.signature_received': {
    ...wireEnvelope('loan.signature_received'),
    data: {
      id: 'ln_test_123',
      status: 'awaiting_signatures',
      signer: { name: 'João Silva', cpf: '123.456.789-00', signed_at: 1775253600 },
      signatures_received: 1,
      signatures_required: 2,
    },
  },
  'loan.processing': {
    ...wireEnvelope('loan.processing'),
    data: {
      id: 'ln_test_123',
      credit_offer_id: 'co_test_123',
      customer_id: 'cust_test_123',
      status: 'processing',
      ccb_number: 'CCB-2026-0001',
      disbursement_method: 'pix',
    },
  },
  'loan.active': {
    ...wireEnvelope('loan.active'),
    data: {
      id: 'ln_test_123',
      status: 'active',
      requested_amount: 10000,
      principal_amount: 10250,
    },
  },
  'loan.payment_received': {
    ...wireEnvelope('loan.payment_received'),
    data: {
      id: 'ln_test_123',
      status: 'active',
      payment: { amount: 875.5, paid_at: 1775253600, installment_number: 1 },
    },
  },
  'loan.finished': {
    ...wireEnvelope('loan.finished'),
    data: { id: 'ln_test_123', status: 'finished' },
  },
  'loan.cancelled': {
    ...wireEnvelope('loan.cancelled'),
    data: { id: 'ln_test_123', status: 'cancelled' },
  },
  'loan.error': {
    ...wireEnvelope('loan.error'),
    // error present only on loan.error → exercises the optional nested object.
    data: {
      id: 'ln_test_123',
      status: 'error',
      error: { code: 'disbursement_failed', message: 'Bank rejected the transfer.' },
    },
  },
};

/** The 15 event types, for `it.each`-style exhaustive iteration in tests. */
export const ALL_WEBHOOK_EVENT_TYPES = Object.keys(WEBHOOK_EVENT_WIRE_BODIES) as WebhookEventType[];

/**
 * A default `customer.created`-shaped WIRE body (snake_case, full envelope). The `data` is the
 * bespoke `customer.created` payload (no timestamps; `kyc` present). `overrides` merge at the
 * top (envelope) level — e.g. `{ id: 'evt_attacker' }` for a tampered-body case.
 */
export function defaultEventBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...WEBHOOK_EVENT_WIRE_BODIES['customer.created'], ...overrides });
}

/**
 * Build a signed webhook. Defaults produce a valid, in-window `customer.created`.
 * Override `timestampSeconds` for replay cases, `secret` (or `forgeSignature`) for
 * tampered cases, and `precedingSignatureTokens` for multi-sig / rotation.
 */
export function signWebhook(options: SignWebhookOptions = {}): WebhookFixture {
  const id = options.id ?? 'evt_test_123';
  const timestampSeconds = options.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const body = options.body ?? defaultEventBody();
  const secret = options.secret ?? TEST_WEBHOOK_SECRET;

  const signature = options.forgeSignature ?? computeSignature(id, timestampSeconds, body, secret);
  const tokens = [...(options.precedingSignatureTokens ?? []), `v1,${signature}`];

  return {
    headers: {
      'webhook-id': id,
      'webhook-timestamp': String(timestampSeconds),
      'webhook-signature': tokens.join(' '),
    },
    body,
    secret,
  };
}

/** Sign the canonical WIRE body for a specific event `type` (story 007 — all 15 events). */
export function signEvent(
  type: WebhookEventType,
  options: SignWebhookOptions = {},
): WebhookFixture {
  return signWebhook({ ...options, body: JSON.stringify(WEBHOOK_EVENT_WIRE_BODIES[type]) });
}

/**
 * A multi-signature fixture (rotation): the header carries a stale, non-matching
 * `v1` token first, then the valid one. Verification must still pass.
 */
export function signWebhookWithRotation(options: SignWebhookOptions = {}): WebhookFixture {
  return signWebhook({
    ...options,
    precedingSignatureTokens: [
      'v1,c3RhbGUtc2lnbmF0dXJlLXRoYXQtZG9lcy1ub3QtbWF0Y2g=',
      ...(options.precedingSignatureTokens ?? []),
    ],
  });
}
