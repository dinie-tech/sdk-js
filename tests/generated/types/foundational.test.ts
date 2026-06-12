/**
 * Foundational types + serializer-convention tests (story 002). Proves the exemplar the
 * resource/event stories copy:
 *
 *   - the 9 branded id prefixes match their openapi `pattern` (and `cust_`, not `cus_`);
 *   - `deserializeCustomer` maps the wire (snake_case) to the reconciled `Customer`
 *     (camelCase, epoch `number`, `cpf`/`cnpj`, NO `taxId`/`object`);
 *   - `serializeCreateCustomerRequest`/`serializeUpdateCustomerRequest` map the camelCase
 *     request to the snake_case wire body, omitting absent optionals;
 *   - `deserializeCreditOffer` maps the wire offer (Money, epoch, optional installments,
 *     nullable `dueDateRule`).
 *
 * Tier: KEY COMPONENTS — one or two real examples per type (drawn from the openapi schema
 * examples @ 3fcfd83). The exhaustive round-trip against every openapi `example` is the
 * conformance harness (story 008); here we prove the convention is correct in both
 * directions for the foundational types.
 */

import {
  API_CLIENT_ID_PATTERN,
  BANK_ACCOUNT_ID_PATTERN,
  CREDIT_OFFER_ID_PATTERN,
  CUSTOMER_ID_PATTERN,
  EVENT_ID_PATTERN,
  LOAN_ID_PATTERN,
  SIMULATION_ID_PATTERN,
  TRANSACTION_ID_PATTERN,
  WEBHOOK_ENDPOINT_ID_PATTERN,
} from '../../../src/generated/types/ids.js';
import {
  deserializeCustomer,
  serializeCreateCustomerRequest,
  serializeUpdateCustomerRequest,
  type Customer,
  type CustomerWire,
} from '../../../src/generated/types/customer.js';
import {
  deserializeCreditOffer,
  type CreditOfferWire,
} from '../../../src/generated/types/credit-offer.js';
import { type FixedInstallmentCreditOfferWire } from '../../../src/generated/types/credit-offer-base.js';

describe('branded id prefixes — verbatim from the openapi `pattern` (architecture §3.2)', () => {
  // [label, pattern, a valid example, an invalid example]. The invalid example guards the
  // exact prefix — most importantly `cust_` is NOT `cus_` (R2 regression).
  const cases: ReadonlyArray<readonly [string, RegExp, string, string]> = [
    [
      'CustomerId',
      CUSTOMER_ID_PATTERN,
      'cust_550e8400e29b41d4a716446655440000',
      'cus_550e8400e29b41d4a716446655440000',
    ],
    [
      'CreditOfferId',
      CREDIT_OFFER_ID_PATTERN,
      'co_550e8400e29b41d4a716446655440000',
      'offer_550e8400e29b41d4a716446655440000',
    ],
    [
      'LoanId',
      LOAN_ID_PATTERN,
      'ln_550e8400e29b41d4a716446655440000',
      'loan_550e8400e29b41d4a716446655440000',
    ],
    [
      'TransactionId',
      TRANSACTION_ID_PATTERN,
      'tx_550e8400e29b41d4a716446655440000',
      'txn_550e8400e29b41d4a716446655440000',
    ],
    [
      'SimulationId',
      SIMULATION_ID_PATTERN,
      'sim_550e8400e29b41d4a716446655440000',
      'simulation_550e8400e29b41d4a716446655440000',
    ],
    [
      'WebhookEndpointId',
      WEBHOOK_ENDPOINT_ID_PATTERN,
      'we_550e8400e29b41d4a716446655440000',
      'whe_550e8400e29b41d4a716446655440000',
    ],
    [
      'ApiClientId',
      API_CLIENT_ID_PATTERN,
      'dinie_ci_live_550e8400e29b41d4a716446655440000',
      'ci_550e8400e29b41d4a716446655440000',
    ],
    [
      'BankAccountId',
      BANK_ACCOUNT_ID_PATTERN,
      'ba_550e8400e29b41d4a716446655440000',
      'bank_550e8400e29b41d4a716446655440000',
    ],
    [
      'EventId',
      EVENT_ID_PATTERN,
      'evt_550e8400e29b41d4a716446655440000',
      'event_550e8400e29b41d4a716446655440000',
    ],
  ];

  it.each(cases)(
    '%s accepts its prefix and rejects a wrong one',
    (_label, pattern, valid, invalid) => {
      expect(pattern.test(valid)).toBe(true);
      expect(pattern.test(invalid)).toBe(false);
    },
  );

  it('rejects the V0.1 `cus_` customer prefix outright (R2)', () => {
    expect(CUSTOMER_ID_PATTERN.test('cus_550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('rejects an id with non-hex body or wrong length', () => {
    expect(CUSTOMER_ID_PATTERN.test('cust_zzz')).toBe(false);
    expect(CUSTOMER_ID_PATTERN.test('cust_550e8400e29b41d4a71644665544000')).toBe(false); // 31 hex
  });
});

/** A full (non-null) wire customer — the openapi `Customer` example @ 3fcfd83. */
function wireCustomer(overrides: Partial<CustomerWire> = {}): CustomerWire {
  return {
    id: 'cust_550e8400e29b41d4a716446655440000',
    external_id: 'partner-ref-123',
    name: 'Joao Silva',
    email: 'joao@example.com',
    phone: '+5511999999999',
    cpf: '123.456.789-00',
    cnpj: '12.345.678/0001-90',
    trading_name: 'Loja do Joao',
    status: 'active',
    created_at: 1775253599,
    updated_at: 1775253599,
    ...overrides,
  };
}

describe('deserializeCustomer — wire (snake) → Customer (camel), reconciled (R1/R3)', () => {
  it('renames every field, keeps epoch timestamps as `number`, and drops taxId/object', () => {
    const customer = deserializeCustomer(wireCustomer());

    expect(customer).toEqual({
      id: 'cust_550e8400e29b41d4a716446655440000',
      externalId: 'partner-ref-123',
      name: 'Joao Silva',
      email: 'joao@example.com',
      phone: '+5511999999999',
      cpf: '123.456.789-00',
      cnpj: '12.345.678/0001-90',
      tradingName: 'Loja do Joao',
      status: 'active',
      createdAt: 1775253599,
      updatedAt: 1775253599,
    });
    // Reconciliation guards: the wrong V0.1 fields are gone, epoch stays numeric.
    expect('taxId' in customer).toBe(false);
    expect('object' in customer).toBe(false);
    expect(typeof customer.createdAt).toBe('number');
    expect(typeof customer.updatedAt).toBe('number');
    expectTypeOf<Customer['createdAt']>().toEqualTypeOf<number>();
  });

  it('preserves nullable fields as null (OpenAPI 3.1 `[T, null]` → `T | null`)', () => {
    const customer = deserializeCustomer(
      wireCustomer({ external_id: null, name: null, cnpj: null, trading_name: null }),
    );

    expect(customer.externalId).toBeNull();
    expect(customer.name).toBeNull();
    expect(customer.cnpj).toBeNull();
    expect(customer.tradingName).toBeNull();
  });

  it('omits the optional kyc array when absent and deserializes each requirement when present', () => {
    expect('kyc' in deserializeCustomer(wireCustomer())).toBe(false);

    const reviewing = deserializeCustomer(
      wireCustomer({
        status: 'under_review',
        kyc: [
          {
            requirement_type: 'company_document',
            requirement_id: 'company_document',
            label: 'Documento da empresa',
            mandatory: true,
          },
        ],
      }),
    );
    // Each wire requirement is run through the discriminated deserializer (story 004) —
    // exhaustive per-variant coverage lives in tests/generated/kyc.test.ts.
    expect(reviewing.kyc).toEqual([
      {
        label: 'Documento da empresa',
        mandatory: true,
        requirementId: 'company_document',
        requirementType: 'company_document',
      },
    ]);
  });
});

describe('serializeCreateCustomerRequest — CreateCustomerRequest (camel) → wire (snake), R1', () => {
  it('maps required fields and renames externalId, with NO taxId', () => {
    const wire = serializeCreateCustomerRequest({
      email: 'joao@example.com',
      phone: '+5511999999999',
      cpf: '123.456.789-00',
      cnpj: '12.345.678/0001-90',
      name: 'Joao Silva',
      externalId: 'partner-ref-123',
    });

    expect(wire).toEqual({
      email: 'joao@example.com',
      phone: '+5511999999999',
      cpf: '123.456.789-00',
      cnpj: '12.345.678/0001-90',
      name: 'Joao Silva',
      external_id: 'partner-ref-123',
    });
    expect('tax_id' in wire).toBe(false);
  });

  it('omits absent optionals (exactOptionalPropertyTypes — never `undefined`)', () => {
    const wire = serializeCreateCustomerRequest({
      email: 'joao@example.com',
      phone: '+5511999999999',
      cpf: '123.456.789-00',
      cnpj: '12.345.678/0001-90',
    });

    expect(wire).toEqual({
      email: 'joao@example.com',
      phone: '+5511999999999',
      cpf: '123.456.789-00',
      cnpj: '12.345.678/0001-90',
    });
    expect('name' in wire).toBe(false);
    expect('external_id' in wire).toBe(false);
  });
});

describe('serializeUpdateCustomerRequest — PATCH subset', () => {
  it('emits only the keys the caller set', () => {
    expect(serializeUpdateCustomerRequest({ email: 'new@example.com' })).toEqual({
      email: 'new@example.com',
    });
    expect(serializeUpdateCustomerRequest({ phone: '+5511888888888' })).toEqual({
      phone: '+5511888888888',
    });
    expect(serializeUpdateCustomerRequest({})).toEqual({});
  });
});

/** A wire credit offer — the openapi `CreditOffer` example @ 3fcfd83 (fixed installments). */
function wireCreditOffer(overrides: Partial<CreditOfferWire> = {}): CreditOfferWire {
  return {
    id: 'co_550e8400e29b41d4a716446655440000',
    customer_id: 'cust_550e8400e29b41d4a716446655440000',
    external_id: 'partner-ref-123',
    status: 'available',
    approved_amount: 25000.0,
    min_amount: 200.0,
    monthly_interest_rate: 3.5,
    installments: 12,
    due_date_rule: null,
    valid_until: 1775253599,
    created_at: 1775253599,
    updated_at: 1775253599,
    ...overrides,
  };
}

describe('deserializeCreditOffer — wire (snake) → CreditOffer (camel), R10', () => {
  it('maps Money + epoch fields, keeps a fixed installments count, and preserves null dueDateRule', () => {
    const offer = deserializeCreditOffer(wireCreditOffer());

    expect(offer).toEqual({
      id: 'co_550e8400e29b41d4a716446655440000',
      customerId: 'cust_550e8400e29b41d4a716446655440000',
      externalId: 'partner-ref-123',
      status: 'available',
      approvedAmount: 25000.0,
      minAmount: 200.0,
      monthlyInterestRate: 3.5,
      installments: 12,
      dueDateRule: null,
      validUntil: 1775253599,
      createdAt: 1775253599,
      updatedAt: 1775253599,
    });
    expect(typeof offer.approvedAmount).toBe('number');
    expect(typeof offer.validUntil).toBe('number');
  });

  it('supports the range product (min/max installments, no fixed installments)', () => {
    // Cast to Fixed to destructure `installments` — wire base shared by both variants
    const { installments: _omit, ...rangeWire } =
      wireCreditOffer() as FixedInstallmentCreditOfferWire;
    const offer = deserializeCreditOffer({
      ...rangeWire,
      min_installments: 3,
      max_installments: 12,
    });

    expect('installments' in offer).toBe(false);
    // Guard narrows `offer` to RangeInstallmentCreditOffer for min/max access
    if ('installments' in offer) throw new Error('expected RangeInstallmentCreditOffer');
    expect(offer.minInstallments).toBe(3);
    expect(offer.maxInstallments).toBe(12);
  });

  it('omits the optional externalId / dueDateRule when the wire omits them', () => {
    const { external_id: _e, due_date_rule: _d, ...lean } = wireCreditOffer();
    const offer = deserializeCreditOffer(lean);

    expect('externalId' in offer).toBe(false);
    expect('dueDateRule' in offer).toBe(false);
  });
});
