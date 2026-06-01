/**
 * KYC block tests (story 004) — the project's complexity HOTSPOT. Exercises the discriminated
 * unions exhaustively (architecture §3.4, §7.8, §11): ONE case per `KycRequirement` variant
 * (9) and per `KycUpload` variant (10), the nested identity CNH|RG dispatch, the CNH
 * attachments collapse, a `*Submitted` / `KycAttachmentResponse` round-trip, the multipart
 * `FormData` framing, unknown-discriminator errors, and the two wired resource methods
 * (`kycAttachments.create` / `startKycReview`) over the mocked transport (D3, zero network).
 *
 * Compile-time narrowing is asserted with `expectTypeOf` (the discriminant must narrow the
 * union member AND its payload). Internal `*Wire` types + `(de)serialize*` are imported from the
 * KYC module directly; the public model/request types + `Dinie` come from the curated barrel
 * (`../../src/index.js`) so the compile guard also proves they SHIP.
 */

import { Customers } from '../../src/generated/resources/customers.js';
import {
  deserializeKycAttachmentResponse,
  deserializeKycRequirement,
  kycUploadToFormData,
  serializeKycUpload,
  type KycAttachmentResponseWire,
  type KycRequirementWire,
} from '../../src/generated/types/kyc/index.js';
import { HttpClient } from '../../src/runtime/http.js';
import { Dinie } from '../../src/index.js';
import type {
  CompanyDocumentRequirement,
  IdentityRequirement,
  IdentitySubmitted,
  KycAttachmentResponse,
  KycRequirement,
  KycRequirementType,
  KycSubject,
  KycUpload,
  KycUploadCnh,
  KycUploadEmail,
  KycUploadFile,
} from '../../src/index.js';
import { useMockUndici } from '../_helpers/mock-undici.js';

const mock = useMockUndici();

/** A binary file stand-in (a `Uint8Array` is a valid {@link KycUploadFile}). */
const FILE: KycUploadFile = new Uint8Array([1, 2, 3]);

/** Wire `KycSubject` reused by the person-specific requirement fixtures. */
const SUBJECT_WIRE = {
  id: '003XXXXXXXXXXXXXXX',
  name: 'Joao Silva',
  subject_type: 'applicant' as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Compile-only guard: the discriminants must narrow the union member AND payload,
// and the public surface must expose the KYC types + methods. Never executed — the
// value is that `tsc --noEmit` fails if narrowing or the public surface drifts.
// ─────────────────────────────────────────────────────────────────────────────
async function _kycTypeNarrowing(): Promise<void> {
  const req = {} as KycRequirement;
  if (req.requirementType === 'identity') {
    expectTypeOf(req).toEqualTypeOf<IdentityRequirement>();
    expectTypeOf(req.subject).toEqualTypeOf<KycSubject>();
    expectTypeOf(req.submitted).toEqualTypeOf<IdentitySubmitted | undefined>();
  }
  if (req.requirementType === 'company_document') {
    expectTypeOf(req).toEqualTypeOf<CompanyDocumentRequirement>();
    // Company-wide requirements have NO `subject` (DS-SUBJECT) — accessing it is an error.
    // @ts-expect-error `subject` is absent on company-wide requirements.
    void req.subject;
  }

  const upload = {} as KycUpload;
  if (upload.evidenceType === 'cnh') {
    expectTypeOf(upload).toEqualTypeOf<KycUploadCnh>();
    expectTypeOf(upload.file).toEqualTypeOf<KycUploadFile>();
  }
  if (upload.evidenceType === 'email') {
    expectTypeOf(upload).toEqualTypeOf<KycUploadEmail>();
    expectTypeOf(upload.value).toEqualTypeOf<string>();
    // The email variant carries a `value`, not a `file`.
    // @ts-expect-error `file` is absent on the email upload variant.
    void upload.file;
  }

  const client = new Dinie({ clientId: 'id', clientSecret: 'secret', baseUrl: 'https://x' });
  expectTypeOf(
    client.customers.kycAttachments.create('cust_1', upload),
  ).resolves.toEqualTypeOf<KycAttachmentResponse>();
  expectTypeOf(client.customers.startKycReview('cust_1')).resolves.toEqualTypeOf<void>();
}
void _kycTypeNarrowing;

/** Build a `Customers` over the mocked transport (the HttpClient builds its own TokenManager). */
function makeCustomers(): Customers {
  const http = new HttpClient({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    baseUrl: mock.origin,
    dispatcher: mock.dispatcher,
  });
  return new Customers(http);
}

// ── deserializeKycRequirement — one case per variant (DS-DISCRIMINATED) ──────────

interface RequirementCase {
  name: string;
  wire: KycRequirementWire;
  requirementType: KycRequirementType;
  requirementId: string;
  personSpecific: boolean;
}

const REQUIREMENT_CASES: RequirementCase[] = [
  {
    name: 'identity',
    wire: {
      requirement_type: 'identity',
      requirement_id: 'identity_003XXXXXXXXXXXXXXX',
      label: 'Documento de identidade',
      mandatory: true,
      subject: SUBJECT_WIRE,
    },
    requirementType: 'identity',
    requirementId: 'identity_003XXXXXXXXXXXXXXX',
    personSpecific: true,
  },
  {
    name: 'selfie',
    wire: {
      requirement_type: 'selfie',
      requirement_id: 'selfie_003XXXXXXXXXXXXXXX',
      label: 'Selfie',
      mandatory: true,
      subject: SUBJECT_WIRE,
    },
    requirementType: 'selfie',
    requirementId: 'selfie_003XXXXXXXXXXXXXXX',
    personSpecific: true,
  },
  {
    name: 'proof_of_address',
    wire: {
      requirement_type: 'proof_of_address',
      requirement_id: 'proof_of_address_003XXXXXXXXXXXXXXX',
      label: 'Comprovante de endereço',
      mandatory: true,
      subject: SUBJECT_WIRE,
    },
    requirementType: 'proof_of_address',
    requirementId: 'proof_of_address_003XXXXXXXXXXXXXXX',
    personSpecific: true,
  },
  {
    name: 'company_document',
    wire: {
      requirement_type: 'company_document',
      requirement_id: 'company_document',
      label: 'Documento da empresa',
      mandatory: true,
    },
    requirementType: 'company_document',
    requirementId: 'company_document',
    personSpecific: false,
  },
  {
    name: 'ei_mei_documents',
    wire: {
      requirement_type: 'ei_mei_documents',
      requirement_id: 'ei_mei_documents',
      label: 'Documentos de EI/MEI',
      mandatory: true,
    },
    requirementType: 'ei_mei_documents',
    requirementId: 'ei_mei_documents',
    personSpecific: false,
  },
  {
    name: 'income_statement',
    wire: {
      requirement_type: 'income_statement',
      requirement_id: 'income_statement',
      label: 'Declaração de faturamento',
      mandatory: true,
    },
    requirementType: 'income_statement',
    requirementId: 'income_statement',
    personSpecific: false,
  },
  {
    name: 'articles_of_association',
    wire: {
      requirement_type: 'articles_of_association',
      requirement_id: 'articles_of_association',
      label: 'Contrato social',
      mandatory: true,
    },
    requirementType: 'articles_of_association',
    requirementId: 'articles_of_association',
    personSpecific: false,
  },
  {
    name: 'eireli_incorporation_statement',
    wire: {
      requirement_type: 'eireli_incorporation_statement',
      requirement_id: 'eireli_incorporation_statement',
      label: 'Ato constitutivo de EIRELI',
      mandatory: true,
    },
    requirementType: 'eireli_incorporation_statement',
    requirementId: 'eireli_incorporation_statement',
    personSpecific: false,
  },
  {
    name: 'email',
    wire: {
      requirement_type: 'email',
      requirement_id: 'email_003XXXXXXXXXXXXXXX',
      label: 'Email do co-titular para assinatura da CCB',
      mandatory: false,
      subject: SUBJECT_WIRE,
    },
    requirementType: 'email',
    requirementId: 'email_003XXXXXXXXXXXXXXX',
    personSpecific: true,
  },
];

describe('deserializeKycRequirement — dispatch on requirement_type (one per variant)', () => {
  it.each(REQUIREMENT_CASES)(
    'dispatches the $name requirement to its variant and maps snake→camel',
    ({ wire, requirementType, requirementId, personSpecific }) => {
      const req = deserializeKycRequirement(wire);

      expect(req.requirementType).toBe(requirementType);
      expect(req.requirementId).toBe(requirementId);
      expect(req.label).toBe(wire.label);
      expect(req.mandatory).toBe(wire.mandatory);
      // Person-specific requirements carry a deserialized (camelCase) subject; company-wide
      // requirements omit it entirely (DS-SUBJECT).
      if (personSpecific) {
        expect('subject' in req && req.subject).toEqual({
          id: '003XXXXXXXXXXXXXXX',
          name: 'Joao Silva',
          subjectType: 'applicant',
        });
      } else {
        expect('subject' in req).toBe(false);
      }
    },
  );

  it('throws a clear error on an unknown requirement_type', () => {
    expect(() =>
      deserializeKycRequirement({ requirement_type: 'passport' } as unknown as KycRequirementWire),
    ).toThrow(/Unknown KycRequirement requirement_type: "passport"/);
  });
});

describe('identity requirement — nested CNH|RG submitted (DS-IMPLICIT) + attachments (DS-COLLAPSE)', () => {
  it('dispatches submitted to CNH and collapses physical (front/back) attachments to KycAttachment[]', () => {
    const req = deserializeKycRequirement({
      requirement_type: 'identity',
      requirement_id: 'identity_003XXXXXXXXXXXXXXX',
      label: 'Documento de identidade',
      mandatory: true,
      subject: SUBJECT_WIRE,
      submitted: {
        evidence_type: 'cnh',
        attachments: [
          { attachment_type: 'front', submitted_at: 1772791200 },
          { attachment_type: 'back', submitted_at: null },
        ],
        review_status: 'pending',
        review_reason: null,
      },
    });

    expect(req.requirementType).toBe('identity');
    if (req.requirementType === 'identity') {
      // Compile-time narrowing of the nested union member.
      expectTypeOf(req.submitted).toEqualTypeOf<IdentitySubmitted | undefined>();
      expect(req.submitted?.evidenceType).toBe('cnh');
      expect(req.submitted?.reviewStatus).toBe('pending');
      expect(req.submitted?.reviewReason).toBeNull();
      // submitted_at: null preserved (R-EPOCH, nullable) — not yet uploaded.
      expect(req.submitted?.attachments).toEqual([
        { attachmentType: 'front', submittedAt: 1772791200 },
        { attachmentType: 'back', submittedAt: null },
      ]);
    }
  });

  it('dispatches submitted to RG', () => {
    const req = deserializeKycRequirement({
      requirement_type: 'identity',
      requirement_id: 'identity_003XXXXXXXXXXXXXXX',
      label: 'Documento de identidade',
      mandatory: true,
      subject: SUBJECT_WIRE,
      submitted: {
        evidence_type: 'rg',
        attachments: [
          { attachment_type: 'front', submitted_at: 1772791200 },
          { attachment_type: 'back', submitted_at: 1772791200 },
        ],
        review_status: 'accepted',
        review_reason: null,
      },
    });

    if (req.requirementType === 'identity') {
      expect(req.submitted?.evidenceType).toBe('rg');
      expect(req.submitted?.reviewStatus).toBe('accepted');
    }
  });

  it('throws a clear error on an unknown identity submitted evidence_type', () => {
    expect(() =>
      deserializeKycRequirement({
        requirement_type: 'identity',
        requirement_id: 'identity_003XXXXXXXXXXXXXXX',
        label: 'Documento de identidade',
        mandatory: true,
        subject: SUBJECT_WIRE,
        submitted: { evidence_type: 'passport' },
      } as unknown as KycRequirementWire),
    ).toThrow(/Unknown IdentitySubmitted evidence_type: "passport"/);
  });
});

// ── serializeKycUpload — one case per variant (DS-DISCRIMINATED-REQUEST) ──────────

interface FileUploadCase {
  name: string;
  params: KycUpload;
  fields: Record<string, string>;
}

const FILE_UPLOAD_CASES: FileUploadCase[] = [
  {
    name: 'cnh',
    params: {
      evidenceType: 'cnh',
      requirementId: 'identity_003XXXXXXXXXXXXXXX',
      attachmentType: 'front',
      file: FILE,
    },
    fields: {
      attachment_type: 'front',
      evidence_type: 'cnh',
      requirement_id: 'identity_003XXXXXXXXXXXXXXX',
    },
  },
  {
    name: 'rg',
    params: {
      evidenceType: 'rg',
      requirementId: 'identity_003XXXXXXXXXXXXXXX',
      attachmentType: 'back',
      file: FILE,
    },
    fields: {
      attachment_type: 'back',
      evidence_type: 'rg',
      requirement_id: 'identity_003XXXXXXXXXXXXXXX',
    },
  },
  {
    name: 'selfie',
    params: {
      evidenceType: 'selfie',
      requirementId: 'selfie_003XXXXXXXXXXXXXXX',
      attachmentType: 'photo',
      file: FILE,
    },
    fields: {
      attachment_type: 'photo',
      evidence_type: 'selfie',
      requirement_id: 'selfie_003XXXXXXXXXXXXXXX',
    },
  },
  {
    name: 'proof_of_address',
    params: {
      evidenceType: 'proof_of_address',
      requirementId: 'proof_of_address_003XXXXXXXXXXXXXXX',
      attachmentType: 'file',
      file: FILE,
    },
    fields: {
      attachment_type: 'file',
      evidence_type: 'proof_of_address',
      requirement_id: 'proof_of_address_003XXXXXXXXXXXXXXX',
    },
  },
  {
    name: 'ccmei',
    params: {
      evidenceType: 'ccmei',
      requirementId: 'company_document',
      attachmentType: 'file',
      file: FILE,
    },
    fields: { attachment_type: 'file', evidence_type: 'ccmei', requirement_id: 'company_document' },
  },
  {
    name: 'ei_mei',
    params: {
      evidenceType: 'ei_mei',
      requirementId: 'ei_mei_documents',
      attachmentType: 'ccmei',
      file: FILE,
    },
    fields: {
      attachment_type: 'ccmei',
      evidence_type: 'ei_mei',
      requirement_id: 'ei_mei_documents',
    },
  },
  {
    name: 'income_statement',
    params: {
      evidenceType: 'income_statement',
      requirementId: 'income_statement',
      attachmentType: 'file',
      file: FILE,
    },
    fields: {
      attachment_type: 'file',
      evidence_type: 'income_statement',
      requirement_id: 'income_statement',
    },
  },
  {
    name: 'articles_of_association',
    params: {
      evidenceType: 'articles_of_association',
      requirementId: 'articles_of_association',
      attachmentType: 'file',
      file: FILE,
    },
    fields: {
      attachment_type: 'file',
      evidence_type: 'articles_of_association',
      requirement_id: 'articles_of_association',
    },
  },
  {
    name: 'eireli_incorporation_statement',
    params: {
      evidenceType: 'eireli_incorporation_statement',
      requirementId: 'eireli_incorporation_statement',
      attachmentType: 'file',
      file: FILE,
    },
    fields: {
      attachment_type: 'file',
      evidence_type: 'eireli_incorporation_statement',
      requirement_id: 'eireli_incorporation_statement',
    },
  },
];

describe('serializeKycUpload — dispatch on evidence_type to the multipart field map', () => {
  it.each(FILE_UPLOAD_CASES)(
    'serializes the $name upload to its scalar fields + the binary file part',
    ({ params, fields }) => {
      const form = serializeKycUpload(params);
      expect(form.fields).toEqual(fields);
      expect(form.file).toBe(FILE);
    },
  );

  it('serializes the email upload with a scalar `value` and NO file part', () => {
    const form = serializeKycUpload({
      evidenceType: 'email',
      requirementId: 'email_003XXXXXXXXXXXXXXX',
      attachmentType: 'email',
      value: 'co-owner@example.com',
    });

    expect(form.fields).toEqual({
      attachment_type: 'email',
      evidence_type: 'email',
      requirement_id: 'email_003XXXXXXXXXXXXXXX',
      value: 'co-owner@example.com',
    });
    expect(form.file).toBeUndefined();
  });

  it('throws a clear error on an unknown upload evidence_type', () => {
    expect(() => serializeKycUpload({ evidenceType: 'passport' } as unknown as KycUpload)).toThrow(
      /Unknown KycUpload evidence_type: "passport"/,
    );
  });
});

describe('kycUploadToFormData — multipart framing (DS-MULTIPART)', () => {
  it('appends the scalar fields + a Blob file part for a document upload', () => {
    const fd = kycUploadToFormData(
      serializeKycUpload({
        evidenceType: 'selfie',
        requirementId: 'selfie_003XXXXXXXXXXXXXXX',
        attachmentType: 'photo',
        file: FILE,
      }),
    );

    expect(fd.get('evidence_type')).toBe('selfie');
    expect(fd.get('requirement_id')).toBe('selfie_003XXXXXXXXXXXXXXX');
    expect(fd.get('attachment_type')).toBe('photo');
    expect(fd.has('file')).toBe(true);
    expect(fd.get('file')).toBeInstanceOf(Blob);
  });

  it('appends the email value as a scalar field with no file part', () => {
    const fd = kycUploadToFormData(
      serializeKycUpload({
        evidenceType: 'email',
        requirementId: 'email_003XXXXXXXXXXXXXXX',
        attachmentType: 'email',
        value: 'co-owner@example.com',
      }),
    );

    expect(fd.get('value')).toBe('co-owner@example.com');
    expect(fd.has('file')).toBe(false);
  });
});

// ── KycAttachmentResponse round-trip (the openapi `uploadKycAttachment` 201 example) ──

/** The `KycAttachmentResponse` example from the openapi `POST /kyc-attachments` 201 (@3fcfd83). */
const ATTACHMENT_RESPONSE_WIRE: KycAttachmentResponseWire = {
  id: 'ka_550e8400e29b41d4a716446655440001',
  uploaded_at: 1772791200,
  requirement: {
    requirement_type: 'identity',
    requirement_id: 'identity_003XXXXXXXXXXXXXXX',
    label: 'Documento de identidade',
    mandatory: true,
    subject: SUBJECT_WIRE,
    submitted: {
      evidence_type: 'cnh',
      attachments: [
        { attachment_type: 'front', submitted_at: 1772791200 },
        { attachment_type: 'back', submitted_at: null },
      ],
      review_status: 'pending',
      review_reason: null,
    },
  },
};

describe('deserializeKycAttachmentResponse — wraps the discriminated requirement', () => {
  it('deserializes the openapi example, delegating the requirement to the discriminated dispatch', () => {
    const res = deserializeKycAttachmentResponse(ATTACHMENT_RESPONSE_WIRE);

    expect(res.id).toBe('ka_550e8400e29b41d4a716446655440001');
    expect(res.uploadedAt).toBe(1772791200);
    expect(res.requirement.requirementType).toBe('identity');
    if (res.requirement.requirementType === 'identity') {
      expect(res.requirement.subject.name).toBe('Joao Silva');
      expect(res.requirement.submitted?.evidenceType).toBe('cnh');
      expect(res.requirement.submitted?.attachments).toEqual([
        { attachmentType: 'front', submittedAt: 1772791200 },
        { attachmentType: 'back', submittedAt: null },
      ]);
    }
  });
});

// ── Resource integration (mocked transport, zero network) ────────────────────────

describe('customers.kycAttachments.create — POST /kyc-attachments → KycAttachmentResponse', () => {
  it('POSTs the attachment path (idempotent) and deserializes the 201 response', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/customers/cust_1/kyc-attachments',
      responses: { statusCode: 201, body: ATTACHMENT_RESPONSE_WIRE },
    });
    const customers = makeCustomers();

    const res = await customers.kycAttachments.create('cust_1', {
      evidenceType: 'cnh',
      requirementId: 'identity_003XXXXXXXXXXXXXXX',
      attachmentType: 'front',
      file: FILE,
    });

    expect(endpoint.lastRequest?.method).toBe('POST');
    expect(endpoint.lastRequest?.path).toBe('/customers/cust_1/kyc-attachments');
    // Idempotent write (D9). NOTE: the request body is NOT asserted — the frozen JSON-only
    // runtime cannot yet encode the multipart FormData (tracked runtime gap, see
    // src/generated/types/kyc/uploads.ts); the per-variant field map is proven by the
    // serializeKycUpload tests above, independent of transport.
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    expect(res.id).toBe('ka_550e8400e29b41d4a716446655440001');
    expect(res.requirement.requirementType).toBe('identity');
  });
});

describe('customers.startKycReview — POST /kyc-review → void (202, no body)', () => {
  it('POSTs the review path (idempotent) and resolves to undefined on a 202 empty body', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/customers/cust_1/kyc-review',
      responses: { statusCode: 202, body: '' },
    });
    const customers = makeCustomers();

    const result = await customers.startKycReview('cust_1');

    expect(result).toBeUndefined();
    expect(endpoint.lastRequest?.method).toBe('POST');
    expect(endpoint.lastRequest?.path).toBe('/customers/cust_1/kyc-review');
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
  });
});
