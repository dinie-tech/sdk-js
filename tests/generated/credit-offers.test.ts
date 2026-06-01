/**
 * `CreditOffers` resource surface tests (story 005) — exercises `list` / `get` /
 * `createSimulation` end to end over a mocked `undici` transport (D3), ZERO network
 * (`MockAgent` + `disableNetConnect`, owned by `useMockUndici`). Mirrors the customers
 * resource tests (story 003): one focused case per method asserting path/method, the
 * camelCase ↔ snake_case bridge (via the generated serializers — story 002), idempotency
 * on the write, and cursor pagination on `list`.
 *
 * The `createSimulation` case is the §12 Customer→Offer→Loan flow ANCHOR: it proves the
 * simulation result carries principal / IOF / CET / installment value (the inputs the
 * partner needs to call `loans.create`). Imports ONLY the curated barrel (`../../src/index.js`)
 * — the real partner entry point — never internal runtime/generated paths.
 */

import { Dinie } from '../../src/index.js';
import type { CreditOffer } from '../../src/index.js';
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

/** A snake_case wire credit offer (fixed-count product — `installments`, no min/max). */
function wireCreditOffer(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    customer_id: 'cust_1',
    status: 'available',
    approved_amount: 50000,
    min_amount: 200,
    monthly_interest_rate: 3.5,
    installments: 12,
    valid_until: 1775253599,
    created_at: 1772791200,
    updated_at: 1772877600,
    ...extra,
  };
}

/** A snake_case wire simulation (the openapi example values). */
function wireSimulation(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sim_1',
    credit_offer_id: 'co_1',
    requested_amount: 25000,
    principal_amount: 29375,
    interest_amount: 2614.36,
    iof_amount: 1875,
    fee_amount: 2500,
    total_amount: 31989.36,
    monthly_interest_rate: 3.5,
    annual_interest_rate: 51.11,
    monthly_cet_rate: 2,
    annual_cet_rate: 233.18,
    installment_count: 4,
    installment_amount: 7997.34,
    first_due_date: '2026-04-03',
    created_at: 1709548200,
    ...extra,
  };
}

describe('creditOffers.createSimulation — POST sub-path, idempotent, camel↔snake (flow anchor)', () => {
  it('serializes the request, attaches an Idempotency-Key, and maps the Simulation result', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/credit-offers/co_1/simulations',
      responses: { statusCode: 201, body: wireSimulation() },
    });
    const client = makeClient();

    const simulation = await client.creditOffers.createSimulation('co_1', {
      requestedAmount: 25000,
      installmentCount: 4,
    });

    expect(endpoint.lastRequest?.method).toBe('POST');
    expect(endpoint.lastRequest?.path).toBe('/credit-offers/co_1/simulations');
    // POST write → auto X-Idempotency-Key (R4/D9).
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    // camelCase params → snake_case wire body (via serializeCreateSimulationRequest).
    expect(JSON.parse(endpoint.lastRequest!.body)).toEqual({
      installment_count: 4,
      requested_amount: 25000,
    });
    // snake_case 201 response → camelCase Simulation (principal / IOF / CET / installment).
    expect(simulation).toEqual({
      id: 'sim_1',
      creditOfferId: 'co_1',
      requestedAmount: 25000,
      principalAmount: 29375,
      interestAmount: 2614.36,
      iofAmount: 1875,
      feeAmount: 2500,
      totalAmount: 31989.36,
      monthlyInterestRate: 3.5,
      annualInterestRate: 51.11,
      monthlyCetRate: 2,
      annualCetRate: 233.18,
      installmentCount: 4,
      installmentAmount: 7997.34,
      firstDueDate: '2026-04-03',
      createdAt: 1709548200,
    });
  });
});

describe('creditOffers.retrieve — round-trips a credit offer by id', () => {
  it('GETs the resource path and maps the wire response to a camelCase CreditOffer', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: '/credit-offers/co_42',
      responses: { statusCode: 200, body: wireCreditOffer('co_42', { external_id: 'ref-9' }) },
    });
    const client = makeClient();

    const offer = await client.creditOffers.retrieve('co_42');

    expect(endpoint.lastRequest?.method).toBe('GET');
    expect(endpoint.lastRequest?.path).toBe('/credit-offers/co_42');
    expect(offer.id).toBe('co_42');
    expect(offer.customerId).toBe('cust_1');
    expect(offer.approvedAmount).toBe(50000);
    expect(offer.externalId).toBe('ref-9');
    expect(offer.installments).toBe(12);
    expect(offer.createdAt).toBe(1772791200);
  });

  it('maps a range product (min/max installments, no `installments`) — XOR §3.5', async () => {
    mock.mockToken();
    mock.mockEndpoint({
      method: 'GET',
      path: '/credit-offers/co_range',
      responses: {
        statusCode: 200,
        // A range offer omits `installments` and carries min/max instead (the contract's
        // own `required: installments` is internally inconsistent — story 002 flag).
        body: wireCreditOffer('co_range', {
          installments: undefined,
          min_installments: 3,
          max_installments: 12,
        }),
      },
    });
    const client = makeClient();

    const offer = await client.creditOffers.retrieve('co_range');

    // The optional `installments` is omitted (not present), min/max are mapped.
    expect(offer.installments).toBeUndefined();
    expect('installments' in offer).toBe(false);
    expect(offer.minInstallments).toBe(3);
    expect(offer.maxInstallments).toBe(12);
  });
});

describe('creditOffers.list — auto-pagination via for await', () => {
  it('iterates every offer across pages, threading starting_after, stopping on has_more:false', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: /^\/credit-offers(\?|$)/,
      responses: [
        {
          statusCode: 200,
          body: { data: [wireCreditOffer('co_a'), wireCreditOffer('co_b')], has_more: true },
        },
        { statusCode: 200, body: { data: [wireCreditOffer('co_c')], has_more: false } },
      ],
    });
    const client = makeClient();

    const collected: CreditOffer[] = [];
    for await (const offer of client.creditOffers.list({ limit: 2 })) {
      collected.push(offer);
    }

    // Every item of every page, in order, terminating on has_more:false.
    expect(collected.map((o) => o.id)).toEqual(['co_a', 'co_b', 'co_c']);
    // camelCase-mapped through the public surface (not raw wire).
    expect(collected[0]!.approvedAmount).toBe(50000);
    // Two fetches: page 1 (no cursor), page 2 (starting_after = last id of page 1).
    expect(endpoint.callCount).toBe(2);
    expect(endpoint.requests[0]!.path).toContain('limit=2');
    expect(endpoint.requests[0]!.path).not.toContain('starting_after');
    expect(endpoint.requests[1]!.path).toContain('starting_after=co_b');
  });

  it('passes the customerId + status filters as query params', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: /^\/credit-offers(\?|$)/,
      responses: { statusCode: 200, body: { data: [], has_more: false } },
    });
    const client = makeClient();

    await client.creditOffers.list({ customerId: 'cust_7', status: 'available' });

    expect(endpoint.lastRequest?.path).toContain('customer_id=cust_7');
    expect(endpoint.lastRequest?.path).toContain('status=available');
  });
});
