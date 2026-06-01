/**
 * Customer bank-account types (architecture §3.4, §7.1). Hand-authored in V0.2 to mirror
 * what the generator will emit from the V3 OpenAPI `CustomerBankAccountRequest` /
 * `CustomerBankAccount` schemas (V0.4 overwrites this file in place — D1). Follows the
 * serializer convention defined in `customer.ts` (the exemplar): the request body gets a
 * `serialize*`; the read model gets a `deserialize*`.
 *
 * ── `allOf` → interface extension (determinism shape) ──
 * The contract defines `CustomerBankAccount` as `allOf: [CustomerBankAccountRequest, { id,
 * bank_name, updated_at }]`. The deterministic mapping of an `allOf` composition is interface
 * EXTENSION: the read model extends the request model and adds the response-only fields. The
 * wire mirror extends the request wire the same way. The (de)serializers still list every
 * field explicitly (R-EXPLICIT) — extension removes duplication in the *types*, not in the
 * mapping. This is the `allOf` rule that feeds `principles.md` (story 009).
 *
 * ── Request body is wrapped — the envelope lives in the RESOURCE, not here ──
 * `POST /customers/{id}/bank-account` takes `{ bank_account: CustomerBankAccountRequest }`.
 * The serializer here emits the *bare* `CustomerBankAccountRequest` wire (1:1 with the
 * schema); `resources/customers.ts` wraps it under `bank_account`. Keeping the endpoint
 * envelope out of the per-schema serializer keeps the serializer reusable and schema-shaped.
 *
 * ── Field map (openapi `components.schemas.CustomerBankAccount(Request)` @ 3fcfd83) ──
 *   wire (snake_case)   → model (camelCase)   → type
 *   bank_id             → bankId              → string                  (COMPE code, required)
 *   kind                → kind                → CustomerBankAccountKind  (enum, required)
 *   branch              → branch              → string                  (required)
 *   number              → number              → string                  (required)
 *   digit               → digit               → string                  (required)
 *   id                  → id                  → BankAccountId (`ba_…`)   (response-only)
 *   bank_name           → bankName            → string                  (response-only)
 *   updated_at          → updatedAt           → number (epoch seconds)  (response-only, R-EPOCH)
 *
 * All fields are required and non-nullable — no R-OPTIONAL spreads, no `T | null`.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only the sibling generated id type (`./ids.js`) — never
 * `runtime/`. The model + request types are public surface (re-exported via the generated
 * barrel + `src/index.ts`); the `*Wire` types and the (de)serializers are consumed by the
 * resource (and the conformance harness — story 008) via direct import.
 */

import type { BankAccountId } from './ids.js';

/** Account kind (openapi enum). */
export type CustomerBankAccountKind = 'checking' | 'saving' | 'payment';

/** Body of `customers.upsertBankAccount` — the disbursement bank account to link. */
export interface CustomerBankAccountRequest {
  /** COMPE bank code; zero-padded to 3 digits when stored. Wire: `bank_id`. */
  bankId: string;
  /** Account kind. */
  kind: CustomerBankAccountKind;
  /** Branch number without the check digit; zero-padded to 4 digits when stored. */
  branch: string;
  /** Account number. */
  number: string;
  /** Account check digit (a single digit, or `"X"` for some banks). */
  digit: string;
}

/** Snake_case wire mirror of {@link CustomerBankAccountRequest}. Built by {@link serializeCustomerBankAccountRequest}. */
export interface CustomerBankAccountRequestWire {
  bank_id: string;
  kind: CustomerBankAccountKind;
  branch: string;
  number: string;
  digit: string;
}

/**
 * A customer's linked bank account (`ba_…`) — the read model. Extends
 * {@link CustomerBankAccountRequest} (the contract's `allOf`) with the response-only `id`,
 * `bankName` and `updatedAt`.
 */
export interface CustomerBankAccount extends CustomerBankAccountRequest {
  /** Stable id, `ba_…`. */
  id: BankAccountId;
  /** Resolved bank display name. Wire: `bank_name`. */
  bankName: string;
  /** Last-modified instant, epoch seconds (R-EPOCH). Wire: `updated_at`. */
  updatedAt: number;
}

/** Snake_case wire mirror of {@link CustomerBankAccount}. Decoded by {@link deserializeCustomerBankAccount}. */
export interface CustomerBankAccountWire extends CustomerBankAccountRequestWire {
  id: string;
  bank_name: string;
  updated_at: number;
}

/**
 * Decode a wire bank account (snake_case) into a {@link CustomerBankAccount} (camelCase).
 * Explicit, alphabetical, epoch-preserving — see the four rules in `customer.ts`. Every field
 * is required, so there are no optional spreads.
 */
export function deserializeCustomerBankAccount(raw: CustomerBankAccountWire): CustomerBankAccount {
  return {
    bankId: raw.bank_id,
    bankName: raw.bank_name,
    branch: raw.branch,
    digit: raw.digit,
    id: raw.id,
    kind: raw.kind,
    number: raw.number,
    updatedAt: raw.updated_at,
  };
}

/**
 * Encode a {@link CustomerBankAccountRequest} (camelCase) into its bare wire body
 * (snake_case). The endpoint wraps this under `bank_account` — that envelope is applied by
 * `resources/customers.ts`, not here. All fields are required (no R-OPTIONAL spreads).
 */
export function serializeCustomerBankAccountRequest(
  params: CustomerBankAccountRequest,
): CustomerBankAccountRequestWire {
  return {
    bank_id: params.bankId,
    branch: params.branch,
    digit: params.digit,
    kind: params.kind,
    number: params.number,
  };
}
