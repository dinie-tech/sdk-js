/**
 * Biometrics-session types (architecture §3.4, §9 — D#6 reconciliation). Hand-authored in
 * V0.2 to mirror what the generator will emit from the V3 OpenAPI `BiometricsSession` schema
 * (V0.4 overwrites this file in place — D1). Follows the serializer convention defined in
 * `customer.ts` (the exemplar): a read-only model gets a `deserialize*` only — there is no
 * request body to serialize (see the no-body note below).
 *
 * ── No request body (contract-confirmed) ──
 * `POST /customers/{id}/biometrics` defines NO `requestBody` in the openapi (@ 3fcfd83): the
 * session is minted purely from the path id. The D#6 helper calls
 * `client.customers.createBiometricsSession(customerId)` with just the id, which matches.
 * {@link CreateBiometricsSessionParams} therefore carries no fields today — it exists only to
 * keep the generated method signature uniform (`(id, params?, options?)` — architecture §7.2)
 * and as a forward-compatible seam should the contract later add a body. The resource sends NO
 * body. Surfaced for story 010 (D#6 contract note) / 009 (principles.md).
 *
 * ── Field map (openapi `components.schemas.BiometricsSession` @ 3fcfd83) ──
 *   wire (snake_case)   → model (camelCase)   → type
 *   session_url         → sessionUrl          → string                 (URI, required)
 *   expires_at          → expiresAt           → number (epoch seconds) (required, R-EPOCH)
 *
 * Both fields are required and non-nullable — no R-OPTIONAL spreads, no `T | null`.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Depends on nothing (no ids/Money) and never on `runtime/`. The model
 * type + the (empty) params type are public surface (re-exported via the generated barrel +
 * `src/index.ts`); the `*Wire` type and the deserializer are consumed by the resource (and the
 * conformance harness — story 008) via direct import.
 */

/**
 * Params for `customers.createBiometricsSession`. The contract defines no request body today,
 * so this is intentionally empty (`Record<string, never>` — an object with no allowed keys);
 * it keeps the method signature uniform and is a forward-compat seam. The resource sends no
 * body regardless of this argument. See the no-body note in the module header.
 */
export type CreateBiometricsSessionParams = Record<string, never>;

/** A temporary biometrics capture session for a customer. Read-only (no request body). */
export interface BiometricsSession {
  /** URL for the partner to embed (webview or redirect). Wire: `session_url`. */
  sessionUrl: string;
  /** Session expiration, epoch seconds (R-EPOCH). Wire: `expires_at`. */
  expiresAt: number;
}

/** Snake_case wire mirror of {@link BiometricsSession}. Decoded by {@link deserializeBiometricsSession}. */
export interface BiometricsSessionWire {
  session_url: string;
  expires_at: number;
}

/**
 * Decode a wire biometrics session (snake_case) into a {@link BiometricsSession} (camelCase).
 * Explicit, alphabetical, epoch-preserving — see the four rules in `customer.ts`. Both fields
 * are required, so there are no optional spreads.
 */
export function deserializeBiometricsSession(raw: BiometricsSessionWire): BiometricsSession {
  return {
    expiresAt: raw.expires_at,
    sessionUrl: raw.session_url,
  };
}
