/**
 * KYC block barrel + the determinism-shape reference (architecture §3.4, §7.8). The KYC
 * subsystem is the project's complexity HOTSPOT — ~35 schemas modeled as discriminated unions —
 * and the single most important input to `specs/api-surface/principles.md` (story 009) and the
 * V0.3 Ruby `comparison.md` canary (the same rules must emit idiomatic Ruby pattern-matching).
 * Hand-authored in V0.2 to mirror future generator output (D1; V0.4 overwrites in place).
 *
 * The block is split by concern (kept small + cohesive; the dispatch lives with its union):
 *   - `common.ts`        leaf types: ReviewStatus/ReviewReason, KycSubject, KycAttachment, the
 *                        shared `kycDispatchError`.
 *   - `submitted.ts`     the ten `*Submitted` evidence types (uniform family) + the nested
 *                        identity CNH|RG union.
 *   - `requirements.ts`  the nine `*Requirement` variants + the `KycRequirement` union + the
 *                        explicit-discriminator dispatch.
 *   - `attachment.ts`    `KycAttachmentResponse` (the upload response wrapping a requirement).
 *   - `uploads.ts`       the ten `KycUpload*` request variants + the upload union + the
 *                        multipart serializer.
 *
 * ════════════════════════════════════════════════════════════════════════════════
 * DETERMINISM SHAPES — what the generator emits from the openapi to honor §7.8.
 * Each rule is stated as: openapi input → emitted TS → edge case. (Story 009 lifts these
 * verbatim into `principles.md`; the field-level convention is the four rules in
 * `../customer.ts` — R-EXPLICIT / R-ORDER / R-OPTIONAL / R-EPOCH.)
 * ════════════════════════════════════════════════════════════════════════════════
 *
 * DS-DISCRIMINATED — `oneOf` + EXPLICIT `discriminator {propertyName, mapping}`
 *   → `type U = A | B | …`, each member carrying the discriminator as a `const` literal field;
 *   → `deserializeU(raw)` (or `serializeU` for a request union) is a `switch (raw[propertyName])`
 *     whose cases ARE the `mapping` keys, each delegating to the member's (de)serializer;
 *   → `default` throws `kycDispatchError(U, propertyName, value)` — never silent `undefined`.
 *   Used by: `KycRequirement` (propertyName `requirement_type`, 9 members) and `KycUpload`
 *   (propertyName `evidence_type`, 10 members). BOTH have an explicit `discriminator` in the
 *   openapi @3fcfd83 (confirmed) — no P6 PR needed for these two.
 *   Edge case: the switch is table-driven by `mapping` — zero bespoke per-variant control flow,
 *   so the generator reproduces it from the schema and Ruby (V0.3) emits the same as a `case in`.
 *
 * DS-IMPLICIT — `oneOf` WITHOUT a `discriminator`, members each carrying a `const` field
 *   → fall back to that const as the discriminator. Used by `IdentityRequirement.submitted`
 *     (CNH|RG, const `evidence_type`). ⚠️ Candidate openapi PR **P6** (add an explicit
 *     `discriminator: evidence_type`); NOT authorized this round — implicit-const is sound + tracked.
 *
 * DS-FAMILY — N schemas that are STRUCTURALLY IDENTICAL except a `const` literal
 *   → one generic base + a type-alias per variant carrying the literal + ONE uniform
 *     (de)serializer. Used by the ten `*Submitted` (`KycSubmitted<E>`).
 *
 * DS-COLLAPSE — `oneOf` of ARRAY schemas whose ITEM shape is identical (differing only in
 *   cardinality / item enum) → the union collapses to `Item[]`; cardinality/enum are doc-only.
 *   Used by `IdentityCnhSubmitted.attachments` (physical 2 / digital 1 → `KycAttachment[]`).
 *
 * DS-CONST-ID — a property with `const` → that string-literal type; with `pattern` → `string`
 *   (the prefix/format is validated, not encoded in the type). Used by `requirement_id`
 *   (company-wide const vs person-specific pattern).
 *
 * DS-SUBJECT — presence-driven optionality: a member type has a field only when its schema
 *   declares it (company-wide requirements omit `subject` entirely; they don't make it optional).
 *
 * DS-MULTIPART — a `multipart/form-data` request `oneOf` → the member serializes to a field
 *   representation (`KycUploadForm`: snake_case scalar fields + an optional binary `file`),
 *   then a `FormData`. Binary (`format: binary`) → the `file` part; a plain scalar → a field.
 *   The runtime's `serializeBody` passes the `FormData` body through on the wire (story 015; see `uploads.ts`).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Re-exports the KYC submodules; imports nothing from `runtime/`. The
 * generated barrel (`../../index.ts`) re-exports the PUBLIC model/request types from here; the
 * `*Wire` types + `(de)serialize*` + `kycUploadToFormData` are internal (consumed by
 * `../customer.ts`, the customers resource, and the conformance harness via direct import).
 */

export * from './common.js';
export * from './submitted.js';
export * from './requirements.js';
export * from './attachment.js';
export * from './uploads.js';
