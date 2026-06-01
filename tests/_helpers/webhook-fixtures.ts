/**
 * Standard Webhooks v1 signing fixtures — born here (story 005), reused by the
 * generated-surface event test (story 010).
 *
 * Mirrors the signing side of the contract `Webhooks.extract` verifies:
 *
 *   signedPayload = `${id}.${timestamp}.${body}`
 *   signature     = base64(HMAC-SHA256(decodeSecret(secret), signedPayload))
 *   header        = "v1,<sig>"   // space-join more tokens for rotation / multi-sig
 *
 * The signing helpers are deliberately INDEPENDENT of the runtime implementation
 * (their own HMAC) so the tests prove the contract end-to-end, not a tautology.
 */

import { createHmac } from 'node:crypto';

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
  /** Raw body string. Default: a `customer.created`-shaped event. */
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

/**
 * A default `customer.created`-shaped event body (camelCase, structural). The `data` is the
 * reconciled `Customer` (story 002 — `cpf`/`cnpj`, epoch `number`, no `taxId`/`object`).
 * The V0.1 `extract` still blind-casts (story 007 adds per-type deserialization), so these
 * keys are camelCase to match what `extract` returns today.
 */
export function defaultEventBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'evt_test_123',
    type: 'customer.created',
    createdAt: '2026-05-27T12:00:00.000Z',
    data: {
      id: 'cus_test_123',
      externalId: null,
      name: 'Acme Pagamentos Ltda',
      email: 'ops@acme.test',
      phone: '+5511999999999',
      cpf: '123.456.789-00',
      cnpj: '12.345.678/0001-90',
      tradingName: 'Acme',
      status: 'pending_kyc',
      createdAt: 1775253599,
      updatedAt: 1775253599,
    },
    ...overrides,
  });
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
