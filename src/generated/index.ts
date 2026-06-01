// Barrel for the generated layer (hand-authored in V0.1, generated from V0.4 — D1).
// Mirrors `openapi.yaml`: the client, generated types/events, and the server-response
// error catalog. This layer imports only from runtime/ — never the reverse (architecture
// §6, §9.1; the two controlled inverse imports live in runtime/http.ts and
// runtime/webhooks.ts — story 011).
//
// Entries are ordered alphabetically by module path so the V0.4 generator produces a
// minimal diff (determinism — architecture §7/§12).
//
// Intentionally ABSENT:
//   - `Customers` — composed internally by `Dinie`, not public surface (criterion A).
//   - `Webhooks` — lives in runtime/ (which owns the verification mechanism); re-exported
//     from `src/index.ts` directly (criterion C).
//   - the `*Wire` types + `serialize*`/`deserialize*` functions (story 002) — the casing
//     bridge is an implementation detail consumed by resources/conformance via direct
//     module import, not partner surface. Only the camelCase model + request types ship.

export { Dinie } from './client.js';
export * from './errors/index.js';
export type { CustomerCreatedEvent, WebhookEvent } from './events/customer-created.js';
export type {
  CustomerBankAccount,
  CustomerBankAccountKind,
  CustomerBankAccountRequest,
} from './types/bank-account.js';
export type { BiometricsSession, CreateBiometricsSessionParams } from './types/biometrics.js';
export type { CreditOffer, CreditOfferStatus } from './types/credit-offer.js';
export type {
  CreateCustomerRequest,
  Customer,
  CustomerCreditOffersListParams,
  CustomerListParams,
  CustomerStatus,
  UpdateCustomerRequest,
} from './types/customer.js';
export type {
  ApiClientId,
  BankAccountId,
  CreditOfferId,
  CustomerId,
  EventId,
  LoanId,
  SimulationId,
  TransactionId,
  WebhookEndpointId,
} from './types/ids.js';
// KYC block (story 004) — public model + request types only; the `*Wire` types, the
// `(de)serialize*` functions, and `kycUploadToFormData` stay internal (consumed by the
// customers resource + conformance via direct import).
export type {
  ArticlesOfAssociationRequirement,
  ArticlesOfAssociationSubmitted,
  CompanyDocumentRequirement,
  CompanyDocumentSubmitted,
  EiMeiDocumentsRequirement,
  EiMeiDocumentsSubmitted,
  EireliIncorporationStatementRequirement,
  EireliIncorporationStatementSubmitted,
  EmailRequirement,
  EmailSubmitted,
  IdentityCnhSubmitted,
  IdentityRequirement,
  IdentityRgSubmitted,
  IdentitySubmitted,
  IncomeStatementRequirement,
  IncomeStatementSubmitted,
  KycAttachment,
  KycAttachmentResponse,
  KycRequirement,
  KycRequirementType,
  KycSubject,
  KycSubjectType,
  KycSubmitted,
  KycUpload,
  KycUploadArticlesOfAssociation,
  KycUploadCcmei,
  KycUploadCnh,
  KycUploadEiMei,
  KycUploadEireliIncorporation,
  KycUploadEmail,
  KycUploadFile,
  KycUploadIncomeStatement,
  KycUploadProofOfAddress,
  KycUploadRg,
  KycUploadSelfie,
  ProofOfAddressRequirement,
  ProofOfAddressSubmitted,
  ReviewReason,
  ReviewStatus,
  SelfieRequirement,
  SelfieSubmitted,
} from './types/kyc/index.js';
export type { Money } from './types/money.js';
