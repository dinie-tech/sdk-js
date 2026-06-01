/**
 * `WebhookEndpoint` types — REST MANAGEMENT of webhook endpoints (architecture §3.1, §3.2,
 * §7.1). Hand-authored in V0.2 to mirror what the generator will emit from the V3 OpenAPI
 * `CreateWebhookEndpointRequest`/`UpdateWebhookEndpointRequest`/`WebhookEndpoint`/
 * `WebhookEndpointWithSecret`/`WebhookSecretRotation` schemas (V0.4 overwrites this file in
 * place — D1). Follows the serializer convention defined in `customer.ts` (the exemplar):
 * request bodies get a `serialize*`; read models get a `deserialize*`.
 *
 * ── NOT the webhook RUNTIME ──
 * This file is the management surface for `client.webhookEndpoints` (create/list/get/update/
 * delete/rotateSecret). It is DISTINCT from webhook event reception — `Webhooks.extract` and the
 * `WebhookEvent` union live in `runtime/webhooks.ts` + `generated/events/` (story 007). A
 * `WebhookEndpoint` is the configuration record; a `WebhookEvent` is a delivered notification.
 *
 * ── The four rules (see `customer.ts` header) ──
 *   R-EXPLICIT  field-by-field mapping, never reflective key-casing.
 *   R-ORDER     output keys alphabetical by the *target* name (minimal V0.4 generator diff).
 *   R-OPTIONAL  absent optional omitted; required-but-nullable always present as `T | null`.
 *   R-EPOCH     integer epoch-second timestamps stay `number` (never `Date`).
 *
 * ── Secret-bearing responses (the security-sensitive bit) ──
 * `WebhookEndpointWithSecret` (returned ONLY by `create`) and `WebhookSecretRotation` (returned
 * ONLY by `rotateSecret`) carry the HMAC signing `secret` (`whsec_…`) shown exactly once. The
 * "regular" {@link WebhookEndpoint} — returned by `list`/`get`/`update` — has NO secret. The
 * runtime logger already redacts `secret` (story 001).
 *
 * ── `allOf` → interface extension (determinism shape, see `bank-account.ts`) ──
 * `WebhookEndpointWithSecret = allOf: [WebhookEndpoint, { secret }]` → the with-secret model
 * extends {@link WebhookEndpoint} and adds `secret`; the wire mirror extends the same way. The
 * (de)serializers still list every field explicitly (R-EXPLICIT).
 *
 * ── Field map (openapi `components.schemas.WebhookEndpoint` @ 3fcfd83 — all required) ──
 *   wire (snake_case)   → model (camelCase)   → type
 *   id                  → id                  → WebhookEndpointId (`we_…`)
 *   url                 → url                 → string
 *   events              → events              → string[]   (subscribed types; `*` wildcards)
 *   description         → description         → string
 *   status              → status              → WebhookEndpointStatus (enum)
 *   created_at          → createdAt           → number (epoch seconds, R-EPOCH)
 *   updated_at          → updatedAt           → number (epoch seconds, R-EPOCH)
 *   secret              → secret              → string     (WebhookEndpointWithSecret only)
 *
 * `WebhookSecretRotation`: `{ id, secret, previous_secret_expires_at }` (all required;
 * `previous_secret_expires_at` is an epoch-second `number`, R-EPOCH).
 *
 * ── `rotateSecret` request body (contract enrichment beyond the §3.1 summary) ──
 * The architecture §3.1 lists `rotateSecret(id, opts?)` with no body, but the contract (SoT —
 * D2) defines an OPTIONAL `{ expire_current_in?: integer }` request body (seconds the old secret
 * stays valid; default 3600, max 86400). Mirroring how `listCreditOffers` surfaced the contract's
 * `status` filter beyond the summary table, the deterministic output includes it as
 * {@link RotateWebhookSecretParams}. Omit it to take the server default.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only the sibling generated id type (`./ids.js`) — never
 * `runtime/`. Model + request types are public surface (generated barrel + `src/index.ts`); the
 * `*Wire` types and the (de)serializers are consumed by the `webhookEndpoints` resource (and the
 * conformance harness — story 008) via direct import.
 */

import type { WebhookEndpointId } from './ids.js';

/** Webhook-endpoint status (openapi enum). */
export type WebhookEndpointStatus = 'active' | 'disabled';

/** Body of `webhookEndpoints.create` — the URL plus optional event filter + description. */
export interface CreateWebhookEndpointRequest {
  /** HTTPS URL to receive webhook deliveries. */
  url: string;
  /** Event types to subscribe to (supports `*` wildcards, e.g. `loan.*`). Omitted/empty = all. */
  events?: string[];
  /** Optional human-readable description. */
  description?: string;
}

/** Snake_case wire mirror of {@link CreateWebhookEndpointRequest}. Built by {@link serializeCreateWebhookEndpointRequest}. */
export interface CreateWebhookEndpointRequestWire {
  url: string;
  events?: string[];
  description?: string;
}

/** Body of `webhookEndpoints.update` — a PATCH subset; every field optional. */
export interface UpdateWebhookEndpointRequest {
  /** New HTTPS delivery URL. */
  url?: string;
  /** New subscribed event types (supports `*` wildcards). */
  events?: string[];
  /** New human-readable description. */
  description?: string;
  /** Enable (`active`) or disable (`disabled`) the endpoint. */
  status?: WebhookEndpointStatus;
}

/** Snake_case wire mirror of {@link UpdateWebhookEndpointRequest}. Built by {@link serializeUpdateWebhookEndpointRequest}. */
export interface UpdateWebhookEndpointRequestWire {
  url?: string;
  events?: string[];
  description?: string;
  status?: WebhookEndpointStatus;
}

/** Body of `webhookEndpoints.rotateSecret` — optional grace period for the old secret. */
export interface RotateWebhookSecretParams {
  /**
   * Seconds the current secret stays valid for signature verification after rotation. Default
   * 3600, max 86400 (server-enforced). Wire: `expire_current_in`.
   */
  expireCurrentIn?: number;
}

/** Snake_case wire mirror of {@link RotateWebhookSecretParams}. Built by {@link serializeRotateWebhookSecretParams}. */
export interface RotateWebhookSecretParamsWire {
  expire_current_in?: number;
}

/** A configured webhook endpoint (`we_…`) — the read model (NO secret). */
export interface WebhookEndpoint {
  /** Stable id, `we_…`. */
  id: WebhookEndpointId;
  /** HTTPS delivery URL. */
  url: string;
  /** Subscribed event types (may include `*` wildcards). */
  events: string[];
  /** Human-readable description. */
  description: string;
  /** Current status. */
  status: WebhookEndpointStatus;
  /** Creation instant, epoch seconds (R-EPOCH). Wire: `created_at`. */
  createdAt: number;
  /** Last-modified instant, epoch seconds (R-EPOCH). Wire: `updated_at`. */
  updatedAt: number;
}

/** Snake_case wire mirror of {@link WebhookEndpoint}. Decoded by {@link deserializeWebhookEndpoint}. */
export interface WebhookEndpointWire {
  id: string;
  url: string;
  events: string[];
  description: string;
  status: WebhookEndpointStatus;
  created_at: number;
  updated_at: number;
}

/**
 * The creation-only endpoint — {@link WebhookEndpoint} plus the `secret` shown exactly once
 * (the contract's `allOf`). Returned by `webhookEndpoints.create`; never by `list`/`get`.
 */
export interface WebhookEndpointWithSecret extends WebhookEndpoint {
  /** The HMAC signing secret (`whsec_…`) — shown ONLY on creation. Store it securely. */
  secret: string;
}

/** Snake_case wire mirror of {@link WebhookEndpointWithSecret}. Decoded by {@link deserializeWebhookEndpointWithSecret}. */
export interface WebhookEndpointWithSecretWire extends WebhookEndpointWire {
  secret: string;
}

/** Result of `webhookEndpoints.rotateSecret` — the new secret + the old secret's grace deadline. */
export interface WebhookSecretRotation {
  /** The endpoint whose secret was rotated, `we_…`. */
  id: WebhookEndpointId;
  /** The new HMAC signing secret (`whsec_…`) — shown ONLY here. Store it securely. */
  secret: string;
  /** When the previous secret stops being accepted, epoch seconds (R-EPOCH). Wire: `previous_secret_expires_at`. */
  previousSecretExpiresAt: number;
}

/** Snake_case wire mirror of {@link WebhookSecretRotation}. Decoded by {@link deserializeWebhookSecretRotation}. */
export interface WebhookSecretRotationWire {
  id: string;
  secret: string;
  previous_secret_expires_at: number;
}

/** Query params for `webhookEndpoints.list` (the cursor is normally driven by the paginator). */
export interface WebhookEndpointsListParams {
  /** Page size, 1..100. */
  limit?: number;
  /** Explicit cursor (the `id` of the last item of the previous page). Wire: `starting_after`. */
  startingAfter?: string;
}

// ── (De)serializers — the convention from `customer.ts` ──────────────────────────

/**
 * Decode a wire endpoint (snake_case) into a {@link WebhookEndpoint} (camelCase). Explicit,
 * alphabetical, epoch-preserving (the four rules in `customer.ts`). Every field is required, so
 * there are no optional spreads; `events` is copied as-is (array of strings).
 */
export function deserializeWebhookEndpoint(raw: WebhookEndpointWire): WebhookEndpoint {
  return {
    createdAt: raw.created_at,
    description: raw.description,
    events: raw.events,
    id: raw.id,
    status: raw.status,
    updatedAt: raw.updated_at,
    url: raw.url,
  };
}

/**
 * Decode a wire creation response (snake_case) into a {@link WebhookEndpointWithSecret}. Lists
 * every field explicitly (R-EXPLICIT — the `allOf` extension removes duplication in the types,
 * not the mapping); `secret` is the creation-only field absent from {@link WebhookEndpoint}.
 */
export function deserializeWebhookEndpointWithSecret(
  raw: WebhookEndpointWithSecretWire,
): WebhookEndpointWithSecret {
  return {
    createdAt: raw.created_at,
    description: raw.description,
    events: raw.events,
    id: raw.id,
    secret: raw.secret,
    status: raw.status,
    updatedAt: raw.updated_at,
    url: raw.url,
  };
}

/**
 * Decode a wire secret-rotation response (snake_case) into a {@link WebhookSecretRotation}.
 * Explicit, alphabetical, epoch-preserving; every field is required (R-OPTIONAL has nothing to
 * omit).
 */
export function deserializeWebhookSecretRotation(
  raw: WebhookSecretRotationWire,
): WebhookSecretRotation {
  return {
    id: raw.id,
    previousSecretExpiresAt: raw.previous_secret_expires_at,
    secret: raw.secret,
  };
}

/**
 * Encode a {@link CreateWebhookEndpointRequest} (camelCase) into its wire body (snake_case).
 * `url` is required; `description`/`events` are omitted when absent (R-OPTIONAL). Alphabetical
 * by target key.
 */
export function serializeCreateWebhookEndpointRequest(
  params: CreateWebhookEndpointRequest,
): CreateWebhookEndpointRequestWire {
  return {
    ...(params.description !== undefined ? { description: params.description } : {}),
    ...(params.events !== undefined ? { events: params.events } : {}),
    url: params.url,
  };
}

/**
 * Encode an {@link UpdateWebhookEndpointRequest} (camelCase) into its PATCH wire body. Every
 * field is optional; only the keys the caller set are emitted (R-OPTIONAL). Alphabetical by
 * target key.
 */
export function serializeUpdateWebhookEndpointRequest(
  params: UpdateWebhookEndpointRequest,
): UpdateWebhookEndpointRequestWire {
  return {
    ...(params.description !== undefined ? { description: params.description } : {}),
    ...(params.events !== undefined ? { events: params.events } : {}),
    ...(params.status !== undefined ? { status: params.status } : {}),
    ...(params.url !== undefined ? { url: params.url } : {}),
  };
}

/**
 * Encode {@link RotateWebhookSecretParams} (camelCase) into its wire body (snake_case). The sole
 * field is optional; it is omitted when absent (R-OPTIONAL), so an empty params object yields an
 * empty body and the server applies its default grace period.
 */
export function serializeRotateWebhookSecretParams(
  params: RotateWebhookSecretParams,
): RotateWebhookSecretParamsWire {
  return {
    ...(params.expireCurrentIn !== undefined ? { expire_current_in: params.expireCurrentIn } : {}),
  };
}
