/**
 * `Credential` types — the API-key management trio (architecture §3.1, §3.2, §7.1).
 * Hand-authored in V0.2 to mirror what the generator will emit from the V3 OpenAPI
 * `CreateCredentialRequest`/`Credential`/`CredentialWithSecret` schemas (V0.4 overwrites this
 * file in place — D1). Follows the serializer convention defined in `customer.ts` (the
 * exemplar): the request body gets a `serialize*`; the read models get a `deserialize*`.
 *
 * ── The four rules (see `customer.ts` header) ──
 *   R-EXPLICIT  field-by-field mapping, never reflective key-casing.
 *   R-ORDER     output keys alphabetical by the *target* name (minimal V0.4 generator diff).
 *   R-OPTIONAL  absent optional omitted; required-but-nullable always present as `T | null`.
 *   R-EPOCH     integer epoch-second timestamps stay `number` (never `Date`).
 *
 * ── Secret-bearing response (the security-sensitive bit) ──
 * `CredentialWithSecret` carries `clientSecret` and is returned ONLY by `credentials.create`
 * (the secret is shown exactly once). The "regular" {@link Credential} — returned by
 * `list` — has NO secret. The runtime logger already redacts `client_secret`/`secret`
 * (story 001), so even a debug-logged creation response keeps the secret out of the logs.
 *
 * ── `allOf` → interface extension (determinism shape, see `bank-account.ts`) ──
 * The contract defines `CredentialWithSecret` as `allOf: [Credential, { client_secret }]`.
 * The deterministic mapping of an `allOf` is interface EXTENSION: the with-secret model
 * extends {@link Credential} and adds the creation-only `clientSecret`; the wire mirror
 * extends `CredentialWire` the same way. The (de)serializers still list every field
 * explicitly (R-EXPLICIT) — extension removes duplication in the *types*, not the mapping.
 *
 * ── Field map (openapi `components.schemas.Credential` @ 3fcfd83) ──
 *   wire (snake_case)   → model (camelCase)   → type
 *   id                  → id                  → ApiClientId (`dinie_ci_…`)
 *   client_id           → clientId            → ApiClientId
 *   name                → name                → string
 *   status              → status              → CredentialStatus (enum)
 *   last_used_at        → lastUsedAt          → number | null  (required, nullable)
 *   expires_at          → expiresAt           → number | null  (required, nullable)
 *   created_at          → createdAt           → number (epoch seconds, R-EPOCH)
 *   updated_at          → updatedAt           → number (epoch seconds, R-EPOCH)
 *   client_secret       → clientSecret        → string         (CredentialWithSecret only)
 *
 * `CreateCredentialRequest`: `name` (required) + `expires_at` (OPTIONAL and nullable —
 * `type: [integer, 'null']`, NOT in `required`): omit to default to "never expires", pass a
 * number to pin an expiry, or pass `null` explicitly for never. So `expiresAt?: number | null`.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only the sibling generated id type (`./ids.js`) — never
 * `runtime/`. Model + request types are public surface (generated barrel + `src/index.ts`);
 * the `*Wire` types and the (de)serializers are consumed by the `credentials` resource (and
 * the conformance harness — story 008) via direct import.
 */

import type { ApiClientId } from './ids.js';

/** Credential lifecycle status (openapi enum). */
export type CredentialStatus = 'active' | 'revoked';

/** Body of `credentials.create` — a label plus an optional expiry. */
export interface CreateCredentialRequest {
  /** Human-readable label for this key. */
  name: string;
  /**
   * Optional expiration, epoch seconds. Omit (or pass `null`) for "never expires". Wire:
   * `expires_at` (`type: [integer, 'null']`).
   */
  expiresAt?: number | null;
}

/** Snake_case wire mirror of {@link CreateCredentialRequest}. Built by {@link serializeCreateCredentialRequest}. */
export interface CreateCredentialRequestWire {
  name: string;
  expires_at?: number | null;
}

/** An API credential (`dinie_ci_…`) — the read model returned by `list` (NO secret). */
export interface Credential {
  /** Stable id, `dinie_ci_…`. */
  id: ApiClientId;
  /** The client id used for OAuth2 (same value as `id`). Wire: `client_id`. */
  clientId: ApiClientId;
  /** Human-readable label. */
  name: string;
  /** Lifecycle status. */
  status: CredentialStatus;
  /** Last authentication instant, epoch seconds, or `null` if never used. Wire: `last_used_at`. */
  lastUsedAt: number | null;
  /** Expiration instant, epoch seconds, or `null` for never. Wire: `expires_at`. */
  expiresAt: number | null;
  /** Creation instant, epoch seconds (R-EPOCH). Wire: `created_at`. */
  createdAt: number;
  /** Last-modified instant, epoch seconds (R-EPOCH). Wire: `updated_at`. */
  updatedAt: number;
}

/** Snake_case wire mirror of {@link Credential}. Decoded by {@link deserializeCredential}. */
export interface CredentialWire {
  id: string;
  client_id: string;
  name: string;
  status: CredentialStatus;
  last_used_at: number | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

/**
 * The creation-only credential — {@link Credential} plus the `clientSecret` shown exactly
 * once (the contract's `allOf`). Returned by `credentials.create`; never by `list`.
 */
export interface CredentialWithSecret extends Credential {
  /** The OAuth2 client secret — shown ONLY on creation. Store it securely. Wire: `client_secret`. */
  clientSecret: string;
}

/** Snake_case wire mirror of {@link CredentialWithSecret}. Decoded by {@link deserializeCredentialWithSecret}. */
export interface CredentialWithSecretWire extends CredentialWire {
  client_secret: string;
}

/** Query params for `credentials.list` (the cursor is normally driven by the paginator). */
export interface CredentialsListParams {
  /** Page size, 1..100. */
  limit?: number;
  /** Explicit cursor (the `id` of the last item of the previous page). Wire: `starting_after`. */
  startingAfter?: string;
}

// ── (De)serializers — the convention from `customer.ts` ──────────────────────────

/**
 * Decode a wire credential (snake_case) into a {@link Credential} (camelCase). Explicit,
 * alphabetical, epoch-preserving (the four rules in `customer.ts`). `lastUsedAt`/`expiresAt`
 * are required-but-nullable: always present, carried as `number | null` (R-OPTIONAL nullable).
 */
export function deserializeCredential(raw: CredentialWire): Credential {
  return {
    clientId: raw.client_id,
    createdAt: raw.created_at,
    expiresAt: raw.expires_at,
    id: raw.id,
    lastUsedAt: raw.last_used_at,
    name: raw.name,
    status: raw.status,
    updatedAt: raw.updated_at,
  };
}

/**
 * Decode a wire creation response (snake_case) into a {@link CredentialWithSecret}. Lists every
 * field explicitly (R-EXPLICIT — the `allOf` extension removes duplication in the types, not in
 * the mapping); `clientSecret` is the creation-only field absent from {@link Credential}.
 */
export function deserializeCredentialWithSecret(
  raw: CredentialWithSecretWire,
): CredentialWithSecret {
  return {
    clientId: raw.client_id,
    clientSecret: raw.client_secret,
    createdAt: raw.created_at,
    expiresAt: raw.expires_at,
    id: raw.id,
    lastUsedAt: raw.last_used_at,
    name: raw.name,
    status: raw.status,
    updatedAt: raw.updated_at,
  };
}

/**
 * Encode a {@link CreateCredentialRequest} (camelCase) into its wire body (snake_case).
 * `name` is required; `expires_at` is omitted only when `undefined` — an explicit `null`
 * (never expires) IS sent (R-OPTIONAL). Alphabetical by target key.
 */
export function serializeCreateCredentialRequest(
  params: CreateCredentialRequest,
): CreateCredentialRequestWire {
  return {
    ...(params.expiresAt !== undefined ? { expires_at: params.expiresAt } : {}),
    name: params.name,
  };
}
