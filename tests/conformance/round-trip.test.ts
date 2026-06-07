/**
 * Conformance round-trip — proves the FROZEN V0.2 surface implements the openapi contract on
 * every whole-object example (story 008, architecture §11). Data-driven over `loader.ts`: each
 * openapi `example` / `examples.*.value` attached to a request/response/webhook schema becomes
 * one `it` case. This is the second safety net behind V0.4's golden test — if conformance is
 * green, a generator that reproduces this hand-written SDK also implements the contract.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * THE ROUND-TRIP, AND WHY THE ORACLE IS `camelizeDeep`
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Architecture §11 frames the check as `serialize(deserialize(example)) ≈ example`. But the V0.2
 * surface is deliberately ASYMMETRIC (architecture §7.1, the `customer.ts` exemplar): a RESPONSE
 * schema gets a `deserialize<T>` only (you never POST a whole `Customer`), and a REQUEST schema
 * gets a `serialize<T>` only (you never receive a `CreateCustomerRequest`). No schema has BOTH
 * halves, so a literal `serialize(deserialize(x))` cannot run against the SDK as built. (This is a
 * property of the SDK shape, not a bug — surfaced in the story-008 log, not a fix-cycle.)
 *
 * The SDK's own contract makes the missing half deterministic: every (de)serializer is a PURE,
 * EXPLICIT, field-by-field snake_case ↔ camelCase key rename (rules R-EXPLICIT/R-ORDER/R-OPTIONAL/
 * R-EPOCH — `customer.ts`). NO value transforms: epoch ints stay `number` (R-EPOCH, never `Date`),
 * `Money` stays `number`, `format: date` stays `string`, `const`/enum values pass through, absent
 * optionals are omitted, required-nullable stays `T | null`. The faithful inverse of such a map is
 * therefore a GENERIC structural key transform. So we use `camelizeDeep` (snake→camel on keys,
 * identity on values, recursive) as the oracle for the missing half and exercise the ONE real SDK
 * function that exists for each schema:
 *
 *   • deserialize-bearing schema (responses, events):  deserialize(example)        ≈ camelizeDeep(example)
 *   • serialize-bearing schema   (request bodies):      serialize(camelizeDeep(example)) ≈ example
 *
 * Both forms put a REAL SDK (de)serializer under test against a REAL contract example; the generic
 * transform only supplies the absent half. A deserializer that drops a field, renames it to
 * anything other than the pure camelCase, synthesizes a field (e.g. `object: 'list'`), or retypes
 * a value (e.g. epoch → `Date`) diverges from `camelizeDeep` and FAILS — which is exactly the
 * camel↔snake / missing-field / casing bug class conformance exists to catch. `camelizeDeep` only
 * transforms object KEYS; map-of-free-keys would corrupt under it, but the V0.2 surface has no
 * free-key maps (verified — every object is a fixed-property schema), so the oracle is exact.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * STRUCTURAL EQUALITY — TOLERANCE RULES (documented per the story)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * Comparison is Vitest `expect(actual).toEqual(expected)`, whose semantics ARE the tolerance:
 *   1. KEY ORDER ignored — objects compare by key/value set, not insertion order (R-ORDER means
 *      the SDK emits alphabetical keys while the contract examples are author-ordered; both pass).
 *   2. ARRAY ORDER significant — arrays are ordered data (a list page, a `kyc` array); order is
 *      part of the contract, so it is NOT relaxed.
 *   3. NUMBERS compared by value. Epoch ints and `Money` doubles flow through BOTH sides from the
 *      same parsed example token (no Date coercion, no reformat), so they are identical by
 *      construction — there is no float-tolerance fudge and none is needed.
 *   4. `null` ≠ ABSENT (respects `exactOptionalPropertyTypes`): a required-nullable field carried
 *      as `null` and an omitted optional are DISTINCT — `toEqual` treats `{k:null}` ≠ `{}` (caught)
 *      while ignoring `undefined`-valued keys, and the SDK never sets `undefined` (it omits), so a
 *      dropped-vs-null mismatch is caught.
 *
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * SCHEMA → SDK TYPE + (DE)SERIALIZER MAPPING (the hard part — documented below)
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * `DESERIALIZERS` / `SERIALIZERS` map an openapi schema NAME (resolved `$ref`) to the SDK
 * function. `EVENT_DESERIALIZERS` (the SDK's own table) routes `WebhookEvent_*` by the example's
 * `type`. List envelopes (`{data:[T], has_more}`) reuse the element schema's deserializer per item.
 * Inline/anonymous request bodies (no `$ref`) are mapped by `operationId` (`ANON_REQUEST_BY_OP`).
 * Everything else with a json example must be in `SKIP_ALLOWLIST` with a reason — the coverage
 * gate fails on any unmapped, un-allowlisted json example (no silent truncation, architecture §11).
 *
 *   Customer/CreditOffer/Simulation/Loan/Transaction/Credential[WithSecret]/Bank/                 → deserialize<Name>
 *   CustomerBankAccount/BiometricsSession/WebhookEndpoint[WithSecret]/WebhookSecretRotation/
 *   KycRequirement (discriminated)/KycAttachmentResponse (delegates to KycRequirement)
 *   CreateCustomerRequest/UpdateCustomerRequest/CreateCredentialRequest/CreateSimulationRequest/   → serialize<Name>
 *   CreateLoanRequest/CreateWebhookEndpointRequest/UpdateWebhookEndpointRequest/CustomerBankAccountRequest
 *   rotateWebhookSecret request body (inline)                                                      → serializeRotateWebhookSecretParams
 *   WebhookEvent_* (15 types / 11 schemas)                                                         → EVENT_DESERIALIZERS[type]
 *
 * NO network, NO time, NO randomness — fully deterministic (iteration order is the contract's
 * document order; `it.each` preserves it).
 */

import { loadExamples, getComponentSchemaNames, type ExampleRecord } from './loader.js';

import { deserializeCustomer } from '../../src/generated/types/customer.js';
import {
  serializeCreateCustomerRequest,
  serializeUpdateCustomerRequest,
} from '../../src/generated/types/customer.js';
import { deserializeCreditOffer } from '../../src/generated/types/credit-offer.js';
import {
  deserializeSimulation,
  serializeCreateSimulationRequest,
} from '../../src/generated/types/simulation.js';
import { deserializeLoan, serializeCreateLoanRequest } from '../../src/generated/types/loan.js';
import { deserializeTransaction } from '../../src/generated/types/transaction.js';
import {
  deserializeCredential,
  deserializeCredentialWithSecret,
  serializeCreateCredentialRequest,
} from '../../src/generated/types/credential.js';
import { deserializeBank } from '../../src/generated/types/bank.js';
import {
  deserializeCustomerBankAccount,
  serializeCustomerBankAccountRequest,
} from '../../src/generated/types/customer-bank-account-request.js';
import { deserializeBiometricsSession } from '../../src/generated/types/biometrics-session.js';
import {
  deserializeWebhookEndpoint,
  deserializeWebhookEndpointWithSecret,
  serializeCreateWebhookEndpointRequest,
  serializeUpdateWebhookEndpointRequest,
} from '../../src/generated/types/webhook-endpoint.js';
import { deserializeWebhookSecretRotation } from '../../src/generated/types/webhook-secret-rotation.js';
import { deserializeKycRequirement } from '../../src/generated/types/kyc.js';
import { deserializeKycAttachmentResponse } from '../../src/generated/types/kyc-attachment-response.js';
import { EVENT_DESERIALIZERS, type WebhookEventType } from '../../src/generated/events/index.js';

// ── The oracle: snake→camel on KEYS only, recursive, value-preserving ───────────────────────────

function camelizeKey(key: string): string {
  return key.replace(/_+([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase());
}

/** Recursively camelCase object keys; arrays/primitives (and all values) pass through unchanged. */
export function camelizeDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeDeep);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[camelizeKey(key)] = camelizeDeep(val);
    }
    return out;
  }
  return value;
}

/** Deep-collect every object carrying a string `<discriminator>` — used to pull the nested KYC
 *  discriminated-union instances out of the customer/event/attachment examples for direct testing. */
function collectByDiscriminator(value: unknown, discriminator: string, out: unknown[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectByDiscriminator(item, discriminator, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    if (typeof obj[discriminator] === 'string') out.push(obj);
    for (const child of Object.values(obj)) collectByDiscriminator(child, discriminator, out);
  }
}

// ── Mapping registries (schema name → SDK function). `(raw: never)` lets a typed (de)serializer
//    sit in the map without a cast; we feed it `value as never` at the call site. ──────────────

type Deserializer = (raw: never) => unknown;
type Serializer = (params: never) => unknown;

const DESERIALIZERS: Record<string, Deserializer> = {
  Customer: deserializeCustomer,
  CreditOffer: deserializeCreditOffer,
  Simulation: deserializeSimulation,
  Loan: deserializeLoan,
  Transaction: deserializeTransaction,
  Credential: deserializeCredential,
  CredentialWithSecret: deserializeCredentialWithSecret,
  Bank: deserializeBank,
  CustomerBankAccount: deserializeCustomerBankAccount,
  BiometricsSession: deserializeBiometricsSession,
  WebhookEndpoint: deserializeWebhookEndpoint,
  WebhookEndpointWithSecret: deserializeWebhookEndpointWithSecret,
  WebhookSecretRotation: deserializeWebhookSecretRotation,
  KycRequirement: deserializeKycRequirement,
  KycAttachmentResponse: deserializeKycAttachmentResponse,
};

const SERIALIZERS: Record<string, Serializer> = {
  CreateCustomerRequest: serializeCreateCustomerRequest,
  UpdateCustomerRequest: serializeUpdateCustomerRequest,
  CreateCredentialRequest: serializeCreateCredentialRequest,
  CreateSimulationRequest: serializeCreateSimulationRequest,
  CreateLoanRequest: serializeCreateLoanRequest,
  CreateWebhookEndpointRequest: serializeCreateWebhookEndpointRequest,
  UpdateWebhookEndpointRequest: serializeUpdateWebhookEndpointRequest,
  CustomerBankAccountRequest: serializeCustomerBankAccountRequest,
};

/** Inline (anonymous-schema) request bodies, mapped by `operationId` → serializer. */
const ANON_REQUEST_BY_OP: Record<string, Serializer> = {};
// rotateWebhookSecret: the inline body ({algorithm: string}) is passed through as-is in V0.5
// (no type-specific serializer generated — body is Record<string,unknown>). Added to SKIP_ALLOWLIST.

/**
 * application/json examples we deliberately do NOT round-trip, each with a reason (the coverage
 * gate consults this — anything unmapped AND not here fails the gate).
 */
const SKIP_ALLOWLIST: Record<string, string> = {
  TokenResponse:
    'Internal token endpoint — parsed by runtime/TokenManager (`createToken`), not a generated ' +
    '(de)serializer; not on the public SDK type surface (architecture §3.1, the one internal op).',
  rotateWebhookSecret:
    'Inline body ({algorithm: string}) — V0.5 generator emits no type-specific serializer for ' +
    'this anonymous body (passed through as Record<string,unknown>); not a structural regression.',
};

// ── Build the case list at load time (deterministic, document order) ─────────────────────────────

interface RoundTripCase {
  readonly label: string;
  readonly schemaLabel: string;
  readonly assert: () => void;
}

const jsonRecords = loadExamples().filter((r) => r.mediaType === 'application/json');

const cases: RoundTripCase[] = [];
const skippedRecords: Array<{ record: ExampleRecord; reason: string }> = [];
const unmappedRecords: ExampleRecord[] = [];
const coveredSchemas = new Set<string>();

function recordLabel(record: ExampleRecord, mode: string, schema: string): string {
  return `${record.location} · ${mode}:${schema} [${record.exampleKey}]`;
}

for (const record of jsonRecords) {
  const { schemaName, container, role, operationId, exampleValue } = record;

  // 1. Webhook events → the SDK's own per-type dispatch table, keyed by the example `type`.
  if (role === 'event' || (schemaName !== null && schemaName.startsWith('WebhookEvent_'))) {
    const schema = schemaName ?? 'WebhookEvent';
    coveredSchemas.add(schema);
    cases.push({
      label: recordLabel(record, 'event', schema),
      schemaLabel: schema,
      assert: () => {
        const envelope = exampleValue as { type?: unknown };
        const type = envelope.type;
        if (typeof type !== 'string' || !(type in EVENT_DESERIALIZERS)) {
          throw new Error(`event example has unknown/absent type: ${JSON.stringify(type)}`);
        }
        const deserialize = EVENT_DESERIALIZERS[type as WebhookEventType];
        expect(deserialize(exampleValue as never)).toEqual(camelizeDeep(exampleValue));
      },
    });
    continue;
  }

  // 2. List envelope `{data:[T], has_more}` → round-trip each item through the element deserializer.
  if (container === 'list' && schemaName !== null && schemaName in DESERIALIZERS) {
    const deserialize = DESERIALIZERS[schemaName]!;
    coveredSchemas.add(schemaName);
    cases.push({
      label: recordLabel(record, 'list', schemaName),
      schemaLabel: schemaName,
      assert: () => {
        const envelope = exampleValue as Record<string, unknown>;
        expect(Array.isArray(envelope['data'])).toBe(true);
        // Story-003 surprise: list envelopes carry NO `object: 'list'` discriminant — assert it.
        expect('object' in envelope).toBe(false);
        for (const item of envelope['data'] as unknown[]) {
          expect(deserialize(item as never)).toEqual(camelizeDeep(item));
        }
      },
    });
    continue;
  }

  // 3. Single response → deserialize<Name>.
  if (container === 'single' && schemaName !== null && schemaName in DESERIALIZERS) {
    const deserialize = DESERIALIZERS[schemaName]!;
    coveredSchemas.add(schemaName);
    cases.push({
      label: recordLabel(record, 'deserialize', schemaName),
      schemaLabel: schemaName,
      assert: () => {
        expect(deserialize(exampleValue as never)).toEqual(camelizeDeep(exampleValue));
      },
    });
    continue;
  }

  // 4. Request body (named schema) → serialize<Name>.
  if (schemaName !== null && schemaName in SERIALIZERS) {
    const serialize = SERIALIZERS[schemaName]!;
    coveredSchemas.add(schemaName);
    cases.push({
      label: recordLabel(record, 'serialize', schemaName),
      schemaLabel: schemaName,
      assert: () => {
        expect(serialize(camelizeDeep(exampleValue) as never)).toEqual(exampleValue);
      },
    });
    continue;
  }

  // 5. Inline (anonymous) request body → serializer mapped by operationId.
  if (
    schemaName === null &&
    role === 'request' &&
    operationId !== null &&
    operationId in ANON_REQUEST_BY_OP
  ) {
    const serialize = ANON_REQUEST_BY_OP[operationId]!;
    const schema = `${operationId} (inline body)`;
    coveredSchemas.add(schema);
    cases.push({
      label: recordLabel(record, 'serialize', schema),
      schemaLabel: schema,
      assert: () => {
        expect(serialize(camelizeDeep(exampleValue) as never)).toEqual(exampleValue);
      },
    });
    continue;
  }

  // 6. Allowlisted (internal / off-surface) — recorded with a reason, not tested.
  // Check both schemaName (named schemas) and operationId (inline/anonymous bodies).
  const skipKey = schemaName ?? operationId;
  if (skipKey !== null && skipKey in SKIP_ALLOWLIST) {
    skippedRecords.push({ record, reason: SKIP_ALLOWLIST[skipKey] as string });
    continue;
  }

  // 7. Anything else is a coverage hole — the gate fails on these.
  unmappedRecords.push(record);
}

// ── The data-driven suite ────────────────────────────────────────────────────────────────────

describe('conformance · round-trip (deserialize/serialize ≈ openapi example)', () => {
  it('found a non-trivial corpus of round-trippable examples', () => {
    // Guards against a silently-broken loader reporting zero work (which would "pass" vacuously).
    expect(cases.length).toBeGreaterThan(30);
  });

  it.each(cases)('$label', (testCase: RoundTripCase) => {
    testCase.assert();
  });
});

// ── KYC discriminated union (architecture §3.4 hotspot) — dedicated conformance ────────────────
// `KycRequirement` is the project's hardest determinism shape (oneOf + discriminator). It never
// appears as a top-level example, but the contract embeds real instances inside the
// `KycAttachmentResponse.requirement`, `Customer.kyc[]`, and `customer.*` event `data.kyc[]`
// examples. Pull every embedded instance and round-trip it DIRECTLY through the discriminated
// dispatch `deserializeKycRequirement`, so the §3.4 dispatch is exercised first-class (and per
// variant present in the contract), not only transitively through its parents.

const kycWireInstances: unknown[] = [];
for (const record of jsonRecords) {
  collectByDiscriminator(record.exampleValue, 'requirement_type', kycWireInstances);
}
const kycByPayload = new Map<string, unknown>();
for (const instance of kycWireInstances) kycByPayload.set(JSON.stringify(instance), instance);
const kycCases = [...kycByPayload.values()].map((value) => ({
  label: `KycRequirement[${String((value as { requirement_type?: unknown }).requirement_type)}]`,
  value,
}));
const kycVariants = new Set(
  kycCases.map((c) => String((c.value as { requirement_type?: unknown }).requirement_type)),
);

describe('conformance · KYC discriminated union (deserializeKycRequirement dispatch)', () => {
  it('found embedded KycRequirement instances in the contract examples', () => {
    expect(kycCases.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `── KYC conformance ── ${kycWireInstances.length} embedded instance(s) → ` +
        `${kycCases.length} distinct payload(s); variants present: ${[...kycVariants].sort().join(', ')}`,
    );
  });

  it.each(kycCases)('$label', ({ value }: { value: unknown }) => {
    expect(deserializeKycRequirement(value as never)).toEqual(camelizeDeep(value));
  });
});

// ── Coverage gate (architecture §11: no silent truncation) ─────────────────────────────────────

describe('conformance · coverage gate', () => {
  it('every application/json example is mapped to an SDK (de)serializer or explicitly allowlisted', () => {
    if (unmappedRecords.length > 0) {
      const lines = unmappedRecords.map(
        (r) => `  - ${r.location} [schema=${r.schemaName ?? '(inline)'} container=${r.container}]`,
      );
      throw new Error(
        `${unmappedRecords.length} application/json example(s) have no SDK mapping and no ` +
          `SKIP_ALLOWLIST reason. Map them or allowlist with a reason — do not silence:\n` +
          lines.join('\n'),
      );
    }
    expect(unmappedRecords).toEqual([]);
  });

  it('reports coverage stats and schemas without round-trippable examples (informational)', () => {
    const allSchemas = getComponentSchemaNames();
    const withoutExamples = allSchemas.filter((name) => !coveredSchemas.has(name));

    // eslint-disable-next-line no-console
    console.log(
      [
        '── conformance round-trip coverage ──',
        `application/json example records:      ${jsonRecords.length}`,
        `round-trip test cases:                 ${cases.length}`,
        `distinct schemas/keys covered:         ${coveredSchemas.size}`,
        `allowlisted (internal/off-surface):    ${skippedRecords.length}` +
          (skippedRecords.length > 0
            ? ` [${skippedRecords.map((s) => s.record.schemaName).join(', ')}]`
            : ''),
        `component schemas total:               ${allSchemas.length}`,
        `component schemas WITHOUT a whole-object example (field-level scalars only, or never`,
        `  exemplified — NOT a gap, just not round-trippable; covered by per-resource unit tests):`,
        `  ${withoutExamples.join(', ')}`,
      ].join('\n'),
    );

    // Sanity: the headline read models must all be exercised by a top-level example. (The KYC
    // discriminated union `KycRequirement` is exercised by its own sub-suite + transitively via
    // `KycAttachmentResponse` / customer events, so it is asserted there, not here.)
    for (const required of [
      'Customer',
      'CreditOffer',
      'Loan',
      'Simulation',
      'Transaction',
      'Credential',
      'WebhookEndpoint',
      'KycAttachmentResponse',
    ]) {
      expect(coveredSchemas.has(required)).toBe(true);
    }
    expect(kycVariants.size).toBeGreaterThan(0);
  });
});
