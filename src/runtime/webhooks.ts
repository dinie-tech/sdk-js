/**
 * Webhook verification (D8) — `Webhooks.extract`, a module-function.
 *
 * Implements the Standard Webhooks v1 contract Dinie inherited (D#3, read-only):
 *
 *   signedPayload = `${webhook-id}.${webhook-timestamp}.${body}`
 *   expected      = base64(HMAC-SHA256(decodeSecret(secret), signedPayload))
 *   header        = "v1,<sig1> v1,<sig2>"   // space-separated, rotation-capable
 *
 * `extract` does verification AND per-type deserialization in one call: it reads the three
 * `webhook-*` headers, enforces a bidirectional timestamp window (replay guard),
 * decodes the secret (`whsec_` → base64), HMAC-SHA256s the signed payload, and
 * compares — in CONSTANT time via `crypto.timingSafeEqual` — against every
 * `v1,<sig>` in the header. Any match → `EVENT_DESERIALIZERS[type]` decodes the snake_case
 * wire body into the honest camelCase `WebhookEvent` member (D10 — the V0.1 blind cast lied);
 * an unknown `type` → `UnknownWebhookEventError` (OQ#2). No match → `WebhookSignatureError`.
 * It NEVER returns an unverified event.
 *
 * Both `secret` and the signature header accept multiple values, so secret
 * rotation works from either side. Verification needs no OAuth credentials, hence
 * a module-function (not a client method). Mirrors `openai-node`
 * `src/resources/webhooks/webhooks.ts:32-117`, with three changes: exposed as a
 * module-function, `secret: string | string[]`, and `extract` (verify + parse).
 *
 * ── runtime ↔ generated boundary (controlled inverse import — openapi-SoT, story 011) ──
 * The general rule is "runtime/ never imports generated/". `webhooks.ts` is one of two
 * declared exceptions (the other is `http.ts`). The webhook event catalog's source of
 * truth is `openapi.yaml` (`webhooks:`), so the `WebhookEvent` union AND the per-type
 * `EVENT_DESERIALIZERS` table live in `generated/events/`. This module imports both: it returns
 * the concrete union from `extract` and uses the table to deserialize the verified body (D10).
 *
 * The inverse import is the forcing function: if an event is not in openapi,
 * `generated/events` does not define it, it is not in the dispatch table, `extract` cannot
 * deserialize it (`UnknownWebhookEventError`), and `tsc` fails on any direct reference —
 * forcing the openapi conversation. (Resolves the story-005 boundary tension: no generic
 * `<E>` parameter and no structural wrapper — the concrete union flows in from openapi.)
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  EVENT_DESERIALIZERS,
  type WebhookEvent,
  type WebhookEventType,
  type WebhookEventWire,
} from '../generated/events/index.js';

import {
  UnknownWebhookEventError,
  WebhookSignatureError,
  WebhookTimestampError,
} from './errors.js';

/** Input to `Webhooks.extract`. */
export interface WebhookExtractInput {
  /** Inbound HTTP headers (case-insensitive lookup of the `webhook-*` trio). */
  headers: Record<string, string | string[] | undefined>;
  /** RAW request body, exactly as received, BEFORE `JSON.parse`. */
  body: string | Buffer;
  /** Signing secret, or a list of secrets to try (rotation). `whsec_`-prefixed → base64. */
  secret: string | string[];
  /** Replay window in seconds, applied in both directions. Default 300. */
  toleranceSeconds?: number;
}

/** Default replay tolerance, in seconds (5 minutes), bidirectional. */
const DEFAULT_TOLERANCE_SECONDS = 300;
/** Secrets carrying this prefix are base64-encoded; the rest is decoded before HMAC. */
const WHSEC_PREFIX = 'whsec_';
/** Only `v1` signature tokens are honored. */
const SIGNATURE_VERSION = 'v1';

/**
 * Verify a Standard Webhooks v1 payload and return the deserialized, typed event — the
 * `WebhookEvent` union straight from openapi (`generated/events/`), decoded per type so the
 * camelCase surface is honest (D10). It NEVER returns an unverified event.
 *
 * @throws {WebhookTimestampError} The `webhook-timestamp` header is missing,
 *   malformed, or outside the tolerance window (too old OR too far in the future).
 * @throws {WebhookSignatureError} A required header is missing, no usable secret was
 *   supplied, or no signature in the header matched.
 * @throws {UnknownWebhookEventError} The signature verified but the payload's `type` is not
 *   in the openapi event catalog (OQ#2 — forces the contract conversation).
 */
function extract(input: WebhookExtractInput): WebhookEvent {
  const { headers, body, secret, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS } = input;

  const webhookId = lookupHeader(headers, 'webhook-id');
  if (webhookId === undefined || webhookId === '') {
    throw new WebhookSignatureError('Missing required webhook header: webhook-id.');
  }

  const webhookTimestamp = lookupHeader(headers, 'webhook-timestamp');
  if (webhookTimestamp === undefined || webhookTimestamp === '') {
    throw new WebhookTimestampError('Missing required webhook header: webhook-timestamp.');
  }

  const signatureHeader = lookupHeader(headers, 'webhook-signature');
  if (signatureHeader === undefined || signatureHeader === '') {
    throw new WebhookSignatureError('Missing required webhook header: webhook-signature.');
  }

  verifyTimestamp(webhookTimestamp, toleranceSeconds);

  // Sign over the exact bytes received. Building a Buffer (rather than re-encoding a
  // decoded string) keeps the HMAC byte-faithful when the body arrives as a Buffer.
  const bodyBuffer = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
  const signedPayload = Buffer.concat([
    Buffer.from(`${webhookId}.${webhookTimestamp}.`, 'utf-8'),
    bodyBuffer,
  ]);

  const secrets = (Array.isArray(secret) ? secret : [secret]).filter((s) => s.length > 0);
  if (secrets.length === 0) {
    throw new WebhookSignatureError('No webhook secret provided.');
  }

  const providedSignatures = parseSignatureHeader(signatureHeader);
  if (signaturesMatch(signedPayload, secrets, providedSignatures)) {
    const text = typeof body === 'string' ? body : body.toString('utf-8');
    return deserializeVerifiedEvent(text);
  }

  throw new WebhookSignatureError(
    'No matching webhook signature found; the payload may have been tampered with.',
  );
}

/**
 * Deserialize a VERIFIED webhook body per type (D10/R6/§5.6). Reached only after the signature
 * matched, so the bytes are authentic. Dispatch is table-driven by `event.type` through
 * `EVENT_DESERIALIZERS` (the openapi-SoT inverse import — §6.4): the table turns the snake_case
 * wire payload into the honest camelCase `WebhookEvent` member. A `type` absent from the catalog
 * throws {@link UnknownWebhookEventError} (OQ#2 — forces the contract conversation rather than
 * returning an untyped blob). `hasOwnProperty` (not `in`) avoids matching inherited keys.
 */
function deserializeVerifiedEvent(text: string): WebhookEvent {
  const parsed = JSON.parse(text) as { type?: unknown };
  const eventType = parsed.type;
  if (
    typeof eventType !== 'string' ||
    !Object.prototype.hasOwnProperty.call(EVENT_DESERIALIZERS, eventType)
  ) {
    throw new UnknownWebhookEventError(
      typeof eventType === 'string' ? eventType : String(eventType),
    );
  }
  return EVENT_DESERIALIZERS[eventType as WebhookEventType](parsed as WebhookEventWire);
}

/** Public webhook surface. Re-exported via `runtime/index.ts` → `src/index.ts`. */
export const Webhooks = { extract };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Case-insensitive single-value header lookup. Standard Webhooks headers are
 * lowercase, but inbound HTTP frameworks vary; if a header arrives as a list (rare),
 * the first value wins.
 */
function lookupHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  let value = headers[name];
  if (value === undefined) {
    const lower = name.toLowerCase();
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower) {
        value = headers[key];
        break;
      }
    }
  }
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Enforce the bidirectional replay window: reject a timestamp that is malformed,
 * too old, or too far in the future.
 */
function verifyTimestamp(timestamp: string, toleranceSeconds: number): void {
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    throw new WebhookTimestampError(`Invalid webhook timestamp: "${timestamp}".`);
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds - ts > toleranceSeconds) {
    throw new WebhookTimestampError('Webhook timestamp is too old.');
  }
  if (ts - nowSeconds > toleranceSeconds) {
    throw new WebhookTimestampError('Webhook timestamp is too far in the future.');
  }
}

/** `whsec_`-prefixed secrets are base64; everything else is treated as raw UTF-8. */
function decodeSecret(secret: string): Buffer {
  return secret.startsWith(WHSEC_PREFIX)
    ? Buffer.from(secret.slice(WHSEC_PREFIX.length), 'base64')
    : Buffer.from(secret, 'utf-8');
}

/**
 * Split the `webhook-signature` header into decoded `v1` signatures. The header is
 * space-separated `v1,<base64>` tokens; non-`v1` and malformed tokens are dropped.
 */
function parseSignatureHeader(header: string): Buffer[] {
  const signatures: Buffer[] = [];
  for (const token of header.split(' ')) {
    if (token.length === 0) continue;
    const commaIndex = token.indexOf(',');
    if (commaIndex === -1) continue;
    if (token.slice(0, commaIndex) !== SIGNATURE_VERSION) continue;
    const value = token.slice(commaIndex + 1);
    if (value.length === 0) continue;
    signatures.push(Buffer.from(value, 'base64'));
  }
  return signatures;
}

/**
 * True when any (secret, signature) pair matches. Each candidate is compared with
 * `crypto.timingSafeEqual` — constant time, never string `===`. A length guard
 * precedes the compare because `timingSafeEqual` throws on unequal-length buffers
 * (an HMAC-SHA256 digest is always 32 bytes, so the guard leaks nothing).
 */
function signaturesMatch(signedPayload: Buffer, secrets: string[], provided: Buffer[]): boolean {
  for (const secret of secrets) {
    const expected = createHmac('sha256', decodeSecret(secret)).update(signedPayload).digest();
    for (const candidate of provided) {
      if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
        return true;
      }
    }
  }
  return false;
}
