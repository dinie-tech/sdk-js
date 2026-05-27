/**
 * `Customer` types — the public, camelCase surface of the customers resource
 * (architecture §4.2). Hand-authored in V0.1 to mirror what the generator will emit
 * from the V3 OpenAPI schema (V0.4 overwrites this file in place — D1).
 *
 * ── Casing (D4 — provisional) ──
 * The public surface is camelCase (idiomatic TS, honors the `taxId` demo); the wire is
 * snake_case. The explicit field-by-field mapping (`taxId` ↔ `tax_id`, `createdAt` ↔
 * `created_at`) lives in `../resources/customers.ts`, not here — these are pure shapes.
 * The convention freezes in V0.2 (open question #15).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Pure type declarations with no imports, so it depends on
 * nothing (and certainly never on `runtime/`). Re-exported as public surface via the
 * generated barrel and `src/index.ts`.
 */

/** A Dinie customer (`cus_…`). Wire fields are snake_case; mapped in the resource. */
export interface Customer {
  /** Stable id, `cus_…`. */
  id: string;
  /** Resource discriminant. */
  object: 'customer';
  /** Tax id — CPF or CNPJ. Wire: `tax_id`. */
  taxId: string;
  /** Display name. */
  name: string;
  /** Contact email, when present. */
  email?: string;
  /** Lifecycle status (a free string in V0.1; becomes an enum in V0.2). */
  status: string;
  /** Creation instant, ISO 8601. Wire: `created_at`. */
  createdAt: string;
}

/** Body of `customers.create`. Mapped to the snake_case wire body in the resource. */
export interface CustomerCreateParams {
  /** Tax id — CPF or CNPJ. Wire: `tax_id`. */
  taxId: string;
  /** Display name. */
  name: string;
  /** Contact email (optional). */
  email?: string;
}

/** Query params for `customers.list`. The cursor is normally managed by the paginator. */
export interface CustomerListParams {
  /** Page size, 1..100. */
  limit?: number;
  /** Explicit cursor (the `id` of the last item of the previous page). Wire: `starting_after`. */
  startingAfter?: string;
}
