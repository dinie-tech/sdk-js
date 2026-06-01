/**
 * KYC *upload* request types + the `KycUpload` discriminated union (architecture §3.4, §7.8).
 * Hand-authored in V0.2 to mirror future generator output (D1; V0.4 overwrites in place). These
 * are the request variants of `POST /customers/{id}/kyc-attachments` — ten document/data kinds,
 * sent as `multipart/form-data` and discriminated by an EXPLICIT `discriminator: evidence_type`
 * (the path's `requestBody` oneOf, mapping confirmed in openapi @3fcfd83).
 *
 * ── Determinism shape DS-DISCRIMINATED-REQUEST (mirror of the response rule) ──
 * Same rule as `KycRequirement` (see `./requirements.ts`), applied to a REQUEST union:
 *   `oneOf` + `discriminator: {propertyName: evidence_type, mapping}` →
 *   `type KycUpload = A | B | …` (each member carries the `const evidence_type` literal) +
 *   `serializeKycUpload(params)` = a `switch (params.evidenceType)` whose cases are the mapping
 *   keys, throwing {@link kycDispatchError} on an unmapped value. Table-driven, not bespoke.
 *
 * ── Determinism shape DS-MULTIPART (binary `file` vs scalar `value`) ──
 * The request content-type is `multipart/form-data`, not JSON. Nine variants carry a binary
 * `file` (openapi `format: binary`); the email variant carries a scalar `value` instead. So a
 * variant serializes to a {@link KycUploadForm}: snake_case SCALAR fields (`evidence_type`,
 * `requirement_id`, `attachment_type`, and `value` for email) plus the optional binary `file`
 * part. {@link kycUploadToFormData} turns that representation into a `FormData`.
 *
 * ── Multipart transport (story 015) ──
 * The runtime's `serializeBody` (`runtime/http.ts`) passes a `FormData`/`Blob`/binary body
 * through untouched, so undici sets `multipart/form-data; boundary=…` itself. KYC uploads encode
 * on the wire (serialize → `KycUploadForm` → `FormData`); the per-variant field map is proven by
 * the serializer unit tests + an integration test (MockAgent) + conformance (story 008).
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only the sibling leaf module (`./common.js`); uses the Node
 * globals `FormData`/`Blob` (NOT `undici` — generated/ stays transport-agnostic). Model/request
 * types are public surface (via `./index.ts` → the generated barrel); `serializeKycUpload`,
 * `kycUploadToFormData`, and `KycUploadForm` are internal (resource + conformance via direct
 * import).
 */

import { kycDispatchError } from './common.js';

/**
 * Binary payload for a KYC document upload. `Buffer` is a `Uint8Array`, so it is accepted.
 * (When the runtime multipart seam lands, this can broaden to also accept Node `Readable`
 * streams, matching the openapi Node code sample's `fs.createReadStream`.)
 */
export type KycUploadFile = Blob | Uint8Array | ArrayBuffer;

// ── The ten upload variants (discriminated by `evidenceType`) ───────────────────

/** Upload a CNH (driver's license): physical `front`/`back` or digital `file`. */
export interface KycUploadCnh {
  evidenceType: 'cnh';
  /** `identity_{subject_id}`. Wire: `requirement_id`. */
  requirementId: string;
  /** Wire: `attachment_type`. */
  attachmentType: 'front' | 'back' | 'file';
  /** Binary file part. */
  file: KycUploadFile;
}

/** Upload an RG (identity card): `front`/`back`. */
export interface KycUploadRg {
  evidenceType: 'rg';
  requirementId: string;
  attachmentType: 'front' | 'back';
  file: KycUploadFile;
}

/** Upload a selfie photo for biometric validation. */
export interface KycUploadSelfie {
  evidenceType: 'selfie';
  requirementId: string;
  attachmentType: 'photo';
  file: KycUploadFile;
}

/** Upload a proof-of-address document. */
export interface KycUploadProofOfAddress {
  evidenceType: 'proof_of_address';
  requirementId: string;
  attachmentType: 'file';
  file: KycUploadFile;
}

/** Upload a CCMEI. Note: `evidence_type` is `ccmei` but `requirement_id` is `company_document`. */
export interface KycUploadCcmei {
  evidenceType: 'ccmei';
  /** Const id of the company-document requirement. Wire: `requirement_id`. */
  requirementId: 'company_document';
  attachmentType: 'file';
  file: KycUploadFile;
}

/** Upload an EI/MEI document (registration requirement or CCMEI). */
export interface KycUploadEiMei {
  evidenceType: 'ei_mei';
  /** Const id of the EI/MEI documents requirement. Wire: `requirement_id`. */
  requirementId: 'ei_mei_documents';
  attachmentType: 'ei_registration_requirement' | 'ccmei';
  file: KycUploadFile;
}

/** Upload an income statement (DRE). */
export interface KycUploadIncomeStatement {
  evidenceType: 'income_statement';
  requirementId: 'income_statement';
  attachmentType: 'file';
  file: KycUploadFile;
}

/** Upload articles of association (contrato social). */
export interface KycUploadArticlesOfAssociation {
  evidenceType: 'articles_of_association';
  requirementId: 'articles_of_association';
  attachmentType: 'file';
  file: KycUploadFile;
}

/** Upload an EIRELI incorporation statement (ato constitutivo). */
export interface KycUploadEireliIncorporation {
  evidenceType: 'eireli_incorporation_statement';
  requirementId: 'eireli_incorporation_statement';
  attachmentType: 'file';
  file: KycUploadFile;
}

/** Submit a co-owner email address for CCB signature. Carries a scalar `value`, not a `file`. */
export interface KycUploadEmail {
  evidenceType: 'email';
  /** `email_{subject_id}`. Wire: `requirement_id`. */
  requirementId: string;
  attachmentType: 'email';
  /** The co-owner email address. Wire: `value`. */
  value: string;
}

/** The KYC upload request union — discriminated by `evidenceType` (architecture §7.8). */
export type KycUpload =
  | KycUploadCnh
  | KycUploadRg
  | KycUploadSelfie
  | KycUploadProofOfAddress
  | KycUploadCcmei
  | KycUploadEiMei
  | KycUploadIncomeStatement
  | KycUploadArticlesOfAssociation
  | KycUploadEireliIncorporation
  | KycUploadEmail;

// ── Serialization → the multipart field representation (DS-MULTIPART) ────────────

/**
 * The deterministic multipart representation of a {@link KycUpload}: ordered snake_case scalar
 * form fields plus the optional binary `file` part. This is what {@link serializeKycUpload}
 * produces and {@link kycUploadToFormData} encodes — the unit of conformance (story 008),
 * independent of how the transport frames it.
 */
export interface KycUploadForm {
  /** Snake_case scalar form fields (alphabetical): `attachment_type`, `evidence_type`, `requirement_id`, `value?`. */
  fields: Record<string, string>;
  /** Binary file part — present for document uploads, absent for the email variant. */
  file?: KycUploadFile;
}

/** Common scalar shape of the nine file-bearing upload variants (for the shared serializer). */
interface KycUploadFileVariant {
  evidenceType: string;
  requirementId: string;
  attachmentType: string;
  file: KycUploadFile;
}

/** Serialize a file-bearing variant → scalar fields + the binary part. */
function serializeFileUpload(params: KycUploadFileVariant): KycUploadForm {
  return {
    fields: {
      attachment_type: params.attachmentType,
      evidence_type: params.evidenceType,
      requirement_id: params.requirementId,
    },
    file: params.file,
  };
}

/** Serialize the email variant → scalar fields only (`value` instead of a `file`). */
function serializeEmailUpload(params: KycUploadEmail): KycUploadForm {
  return {
    fields: {
      attachment_type: params.attachmentType,
      evidence_type: params.evidenceType,
      requirement_id: params.requirementId,
      value: params.value,
    },
  };
}

/**
 * Serialize a {@link KycUpload} to its {@link KycUploadForm} by dispatching on the explicit
 * `evidenceType` discriminator (DS-DISCRIMINATED-REQUEST). The nine file variants share one
 * serializer; the email variant maps `value` to a scalar field. An unmapped `evidence_type`
 * throws {@link kycDispatchError}. Whether a variant carries `file` (binary) or `value`
 * (scalar) is derivable from the schema (`format: binary` vs a plain string), so the generator
 * reproduces this table from the openapi alone.
 */
export function serializeKycUpload(params: KycUpload): KycUploadForm {
  switch (params.evidenceType) {
    case 'cnh':
    case 'rg':
    case 'selfie':
    case 'proof_of_address':
    case 'ccmei':
    case 'ei_mei':
    case 'income_statement':
    case 'articles_of_association':
    case 'eireli_incorporation_statement':
      return serializeFileUpload(params);
    case 'email':
      return serializeEmailUpload(params);
    default:
      throw kycDispatchError(
        'KycUpload',
        'evidence_type',
        (params as { evidenceType: unknown }).evidenceType,
      );
  }
}

/**
 * Encode a {@link KycUploadForm} into a `multipart/form-data` `FormData` (the body the upload
 * endpoint expects). Appends each scalar field, then the binary `file` part when present. Uses
 * the Node global `FormData`/`Blob`. The runtime's `serializeBody` passes this `FormData` body
 * through untouched (story 015), so undici sets `multipart/form-data; boundary=…` on the wire.
 */
export function kycUploadToFormData(form: KycUploadForm): FormData {
  const fd = new FormData();
  for (const [name, value] of Object.entries(form.fields)) {
    fd.append(name, value);
  }
  if (form.file !== undefined) {
    fd.append('file', form.file instanceof Blob ? form.file : new Blob([form.file]));
  }
  return fd;
}
