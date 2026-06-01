/**
 * `Bank` type — the bank-directory entry (architecture §3.1, §7.1). Hand-authored in V0.2 to
 * mirror what the generator will emit from the V3 OpenAPI `Bank` schema (V0.4 overwrites this
 * file in place — D1). Follows the serializer convention defined in `customer.ts` (the
 * exemplar): a read-only model gets a `deserialize*` only — banks are a fixed directory the
 * partner reads (to fill `customers.upsertBankAccount`), never POSTed, so there is no serializer.
 *
 * ── `/banks` does NOT paginate (the story's key open question — §7.5) ──
 * The `GET /banks` response schema is `{ data: Bank[] }` with ONLY `data` required — NO
 * `has_more`, NO `object: 'list'`, and the operation declares NO query params. Per the §7.5
 * determinism rule ("a list becomes `PagePromise` iff its envelope has `has_more`; otherwise
 * `T[]`"), `banks.list` returns `Promise<Bank[]>` — a flat list, NOT a `PagePromise`. So `Bank`
 * deliberately needs no `id`-as-cursor contract and no list-params type. (Contrast: `Credential`
 * and `WebhookEndpoint` list envelopes DO carry `has_more` → `PagePromise`.)
 *
 * ── Field map (openapi `components.schemas.Bank` @ 3fcfd83 — all 3 required) ──
 *   wire (snake_case)   → model (camelCase)   → type
 *   id                  → id                  → string   (COMPE code, e.g. `"001"` — NOT prefixed)
 *   name                → name                → string   (e.g. `"Banco do Brasil"`)
 *   display_name        → displayName         → string   (e.g. `"001 - Banco do Brasil"`)
 *
 * `Bank.id` is the COMPE bank code string (`"001"`), not one of the `*_…`-prefixed resource IDs
 * (§3.2) — so it stays a plain `string`, with no entry in `ids.ts`.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Depends on nothing (no ids, no `runtime/`). The model is public surface
 * (generated barrel + `src/index.ts`); the `BankWire` type and `deserializeBank` are consumed by
 * the `banks` resource (and the conformance harness — story 008) via direct import.
 */

/** A bank available for customer bank-account submission (read-only directory entry). */
export interface Bank {
  /** COMPE bank code (e.g. `"001"`). */
  id: string;
  /** Bank name (e.g. `"Banco do Brasil"`). */
  name: string;
  /** Display label combining code + name (e.g. `"001 - Banco do Brasil"`). Wire: `display_name`. */
  displayName: string;
}

/** Snake_case wire mirror of {@link Bank}. Decoded by {@link deserializeBank}. */
export interface BankWire {
  id: string;
  name: string;
  display_name: string;
}

/**
 * Decode a wire bank (snake_case) into a {@link Bank} (camelCase). Explicit and alphabetical
 * (the four rules in `customer.ts`); every field is required, so there are no optional spreads.
 */
export function deserializeBank(raw: BankWire): Bank {
  return {
    displayName: raw.display_name,
    id: raw.id,
    name: raw.name,
  };
}
