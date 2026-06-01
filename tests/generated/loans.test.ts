/**
 * `Loans` resource surface tests (story 005) — exercises `create` / `retrieve` / `transactions.list`
 * end to end over a mocked `undici` transport (D3), ZERO network (`MockAgent` +
 * `disableNetConnect`, owned by `useMockUndici`). Mirrors the customers/credit-offers resource
 * tests: one focused case per method asserting path/method, the camelCase ↔ snake_case bridge
 * (via the generated serializers — story 002), idempotency on the write, the nullable-but-
 * required fields (`principalAmount`/`signingUrl`/… carried as `T | null`), and cursor
 * pagination on `transactions.list`. Imports ONLY the curated barrel (`../../src/index.js`).
 */

import { Dinie } from '../../src/index.js';
import type { Transaction } from '../../src/index.js';
import { useMockUndici } from '../_helpers/mock-undici.js';

const mock = useMockUndici();

/** Build the public `Dinie` client over the mocked transport (the D3 seam). */
function makeClient(): Dinie {
  return new Dinie({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    baseUrl: mock.origin,
    dispatcher: mock.dispatcher,
  });
}

/** A valid `CreateLoanRequest` (offer id + the accepted simulation's chosen terms). */
const CREATE_PARAMS = {
  creditOfferId: 'co_1',
  simulationId: 'sim_1',
  installmentCount: 4,
  installmentAmount: 7997.34,
  firstDueDate: '2026-04-03',
};

/** A snake_case wire loan. `extra` overrides let a test exercise the null-until-calculated fields. */
function wireLoan(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    credit_offer_id: 'co_1',
    customer_id: 'cust_1',
    simulation_id: 'sim_1',
    status: 'awaiting_signatures',
    requested_amount: 25000,
    principal_amount: 29375,
    iof_amount: 1875,
    monthly_interest_rate: 3.5,
    annual_interest_rate: 51.11,
    monthly_cet_rate: 2,
    annual_cet_rate: 233.18,
    total_amount: 31989.36,
    installment_count: 4,
    installment_amount: 7997.34,
    first_due_date: '2026-04-03',
    ccb_number: 'CCB-2026-001234',
    disbursement_method: 'pix',
    signing_url: 'https://clicksign.com/widget/abc',
    created_at: 1709550000,
    updated_at: 1709550000,
    ...extra,
  };
}

/** A snake_case wire transaction (installment). */
function wireTransaction(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    loan_id: 'ln_1',
    type: 'installment',
    status: 'paid',
    due_date: '2026-04-03',
    amount_due: 2500,
    amount_paid: 2500,
    amount_remaining: 0,
    principal: 2083.33,
    interest: 375,
    fees: 41.67,
    days_overdue: 0,
    paid_at: 1775383200,
    created_at: 1709550000,
    updated_at: 1775383200,
    ...extra,
  };
}

describe('loans.create — POST /loans, idempotent, camel↔snake (201)', () => {
  it('serializes all five fields, attaches an Idempotency-Key, and maps the Loan response', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/loans',
      responses: { statusCode: 201, body: wireLoan('ln_1') },
    });
    const client = makeClient();

    const loan = await client.loans.create(CREATE_PARAMS);

    expect(endpoint.lastRequest?.method).toBe('POST');
    expect(endpoint.lastRequest?.path).toBe('/loans');
    // POST write → auto X-Idempotency-Key (R4/D9).
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    // camelCase params → snake_case wire body (via serializeCreateLoanRequest).
    expect(JSON.parse(endpoint.lastRequest!.body)).toEqual({
      credit_offer_id: 'co_1',
      first_due_date: '2026-04-03',
      installment_amount: 7997.34,
      installment_count: 4,
      simulation_id: 'sim_1',
    });
    // snake_case 201 response → camelCase Loan (spot-check the key fields + nullables present).
    expect(loan.id).toBe('ln_1');
    expect(loan.status).toBe('awaiting_signatures');
    expect(loan.requestedAmount).toBe(25000);
    expect(loan.principalAmount).toBe(29375);
    expect(loan.firstDueDate).toBe('2026-04-03');
    expect(loan.ccbNumber).toBe('CCB-2026-001234');
    expect(loan.signingUrl).toBe('https://clicksign.com/widget/abc');
    expect(loan.createdAt).toBe(1709550000);
  });
});

describe('loans.retrieve — round-trips a loan, carrying nullable-but-required fields as null', () => {
  it('GETs the path and maps the wire response, keeping the null fields present (R-OPTIONAL)', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: '/loans/ln_7',
      responses: {
        statusCode: 200,
        // A freshly-created loan: principal/iof not yet calculated, contract not yet generated.
        body: wireLoan('ln_7', {
          principal_amount: null,
          iof_amount: null,
          ccb_number: null,
          disbursement_method: null,
          signing_url: null,
        }),
      },
    });
    const client = makeClient();

    const loan = await client.loans.retrieve('ln_7');

    expect(endpoint.lastRequest?.method).toBe('GET');
    expect(endpoint.lastRequest?.path).toBe('/loans/ln_7');
    expect(loan.id).toBe('ln_7');
    // Required-but-nullable: ALWAYS present, carried as `null` (not omitted).
    expect(loan.principalAmount).toBeNull();
    expect(loan.iofAmount).toBeNull();
    expect(loan.ccbNumber).toBeNull();
    expect(loan.disbursementMethod).toBeNull();
    expect(loan.signingUrl).toBeNull();
    expect('signingUrl' in loan).toBe(true);
    // Non-null required fields still mapped.
    expect(loan.totalAmount).toBe(31989.36);
    expect(loan.simulationId).toBe('sim_1');
  });
});

describe('loans.transactions.list — auto-pagination over a loan sub-path', () => {
  it('iterates transactions across pages, threads starting_after, maps snake→camel', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: /^\/loans\/ln_1\/transactions(\?|$)/,
      responses: [
        {
          statusCode: 200,
          body: {
            data: [wireTransaction('tx_a'), wireTransaction('tx_b')],
            has_more: true,
          },
        },
        { statusCode: 200, body: { data: [wireTransaction('tx_c')], has_more: false } },
      ],
    });
    const client = makeClient();

    const collected: Transaction[] = [];
    for await (const tx of client.loans.transactions.list('ln_1', { limit: 2 })) {
      collected.push(tx);
    }

    expect(collected.map((t) => t.id)).toEqual(['tx_a', 'tx_b', 'tx_c']);
    // camelCase-mapped through the public surface; `type` is the `const` literal.
    expect(collected[0]!.type).toBe('installment');
    expect(collected[0]!.amountDue).toBe(2500);
    // Two fetches: page 1 (no cursor), page 2 (starting_after = last id of page 1).
    expect(endpoint.callCount).toBe(2);
    expect(endpoint.requests[0]!.path).toContain('limit=2');
    expect(endpoint.requests[0]!.path).not.toContain('starting_after');
    expect(endpoint.requests[1]!.path).toContain('starting_after=tx_b');
  });

  it('maps a pending installment with paid_at: null (nullable epoch field)', async () => {
    mock.mockToken();
    mock.mockEndpoint({
      method: 'GET',
      path: /^\/loans\/ln_1\/transactions(\?|$)/,
      responses: {
        statusCode: 200,
        body: {
          data: [
            wireTransaction('tx_pending', {
              status: 'pending',
              amount_paid: 0,
              amount_remaining: 2500,
              paid_at: null,
            }),
          ],
          has_more: false,
        },
      },
    });
    const client = makeClient();

    const collected: Transaction[] = [];
    for await (const tx of client.loans.transactions.list('ln_1')) {
      collected.push(tx);
    }

    expect(collected).toHaveLength(1);
    expect(collected[0]!.status).toBe('pending');
    // Required-but-nullable epoch field: present, carried as null.
    expect(collected[0]!.paidAt).toBeNull();
    expect('paidAt' in collected[0]!).toBe(true);
  });
});
