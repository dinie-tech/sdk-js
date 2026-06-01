/**
 * Generated-surface E2E (story 010) — the CAPSTONE glue test. Exercises the public
 * `@dinie/sdk` surface end to end over a mocked `undici` transport (D3), with ZERO
 * network (`MockAgent` + `disableNetConnect`, owned by `useMockUndici`). It proves the
 * partner-facing entry point — `new Dinie(...)` → `customers.create/get/list/update` +
 * sub-paths + `client.rateLimit` — behaves as the version demo promises (§Demo, §5.2, §9.2):
 *
 *   - transparent OAuth2 — the partner NEVER calls `/auth/token`; the SDK mints ONE
 *     token transparently and reuses it across calls;
 *   - `create` auto-attaches a stable `X-Idempotency-Key` (`dinie-sdk-retry-…`) and bridges
 *     camelCase ↔ snake_case across the wire (now via the generated serializers — story 002);
 *   - `get` round-trips a customer;
 *   - `list` auto-paginates via `for await`, threading the `starting_after` cursor and
 *     terminating on `has_more: false`;
 *   - `client.rateLimit` reflects the `X-RateLimit-*` headers of the last response.
 *
 * It imports ONLY the curated barrel (`../../src/index.js`) — the REAL partner entrypoint
 * — never internal runtime/generated paths. The risky runtime mechanics (retry matrix,
 * token concurrency, error mapping, redaction) are covered exhaustively by the runtime
 * tests; here we prove they compose correctly behind the public surface.
 */

import { APIConnectionError, Dinie } from '../../src/index.js';
import type { CreditOffer, Customer } from '../../src/index.js';
import { useMockUndici } from '../_helpers/mock-undici.js';

const mock = useMockUndici();

/** A valid `CreateCustomerRequest` (R1 — `email`/`phone`/`cpf`/`cnpj`, no `taxId`). */
const CREATE_PARAMS = {
  email: 'ops@acme.test',
  phone: '+5511999999999',
  cpf: '123.456.789-00',
  cnpj: '12.345.678/0001-90',
  name: 'Acme Pagamentos Ltda',
};

/** Build the public `Dinie` client over the mocked transport (the D3 seam). */
function makeClient(): Dinie {
  return new Dinie({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    baseUrl: mock.origin,
    dispatcher: mock.dispatcher,
  });
}

/** A snake_case wire customer record (what the API returns — reconciled shape, story 002). */
function wireCustomer(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    external_id: null,
    name: 'Acme Pagamentos Ltda',
    email: 'ops@acme.test',
    phone: '+5511999999999',
    cpf: '123.456.789-00',
    cnpj: '12.345.678/0001-90',
    trading_name: 'Acme',
    status: 'active',
    created_at: 1775253599,
    updated_at: 1775253599,
    ...extra,
  };
}

/** A snake_case wire bank account (allOf: request fields + id/bank_name/updated_at). */
function wireBankAccount(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ba_1',
    bank_id: '001',
    kind: 'checking',
    branch: '0001',
    number: '1234567',
    digit: '0',
    bank_name: 'Banco do Brasil',
    updated_at: 1775253599,
    ...extra,
  };
}

/**
 * A snake_case wire credit offer. NOTE: the real list envelope has only `data` + `has_more`
 * (no `object: 'list'` field) — the fixtures below reflect that contract reality.
 */
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

describe('transparent OAuth2 — the partner never touches /auth/token', () => {
  it('mints exactly one token transparently and reuses it across resource calls', async () => {
    const tokens = mock.mockToken();
    const created = mock.mockCustomer({ customer: wireCustomer('cust_1') });
    const fetched = mock.mockEndpoint({
      method: 'GET',
      path: '/customers/cust_1',
      responses: { statusCode: 200, body: wireCustomer('cust_1') },
    });
    const client = makeClient();

    // The partner calls only resource methods — there is NO public way to request a
    // token. The SDK acquires one transparently on the first call …
    await client.customers.create(CREATE_PARAMS);
    // … and reuses the cached token on the second (no second token POST).
    await client.customers.retrieve('cust_1');

    expect(tokens.callCount).toBe(1);
    expect(tokens.lastRequest?.method).toBe('POST');
    expect(tokens.lastRequest?.path).toBe('/auth/token');
    // Both resource calls carried the Bearer minted by that single token POST.
    expect(created.lastRequest?.headers['authorization']).toBe('Bearer dinie-test-access-token-1');
    expect(fetched.lastRequest?.headers['authorization']).toBe('Bearer dinie-test-access-token-1');
  });
});

describe('customers.create — auto idempotency + camelCase ↔ snake_case mapping', () => {
  it('attaches a stable Idempotency-Key and bridges the wire casing both ways', async () => {
    mock.mockToken();
    const endpoint = mock.mockCustomer({ customer: wireCustomer('cust_1') });
    const client = makeClient();

    const customer = await client.customers.create(CREATE_PARAMS);

    // Auto-generated X-Idempotency-Key (R4/D9) on the write.
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    // camelCase params → snake_case wire body (via serializeCreateCustomerRequest).
    expect(JSON.parse(endpoint.lastRequest!.body)).toEqual({
      cnpj: '12.345.678/0001-90',
      cpf: '123.456.789-00',
      email: 'ops@acme.test',
      name: 'Acme Pagamentos Ltda',
      phone: '+5511999999999',
    });
    // snake_case wire response → camelCase Customer (via deserializeCustomer).
    expect(customer).toEqual({
      id: 'cust_1',
      externalId: null,
      name: 'Acme Pagamentos Ltda',
      email: 'ops@acme.test',
      phone: '+5511999999999',
      cpf: '123.456.789-00',
      cnpj: '12.345.678/0001-90',
      tradingName: 'Acme',
      status: 'active',
      createdAt: 1775253599,
      updatedAt: 1775253599,
    });
  });
});

describe('customers.retrieve — round-trips a customer by id', () => {
  it('GETs the resource path and maps the wire response to a camelCase Customer', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: '/customers/cust_42',
      responses: { statusCode: 200, body: wireCustomer('cust_42') },
    });
    const client = makeClient();

    const customer = await client.customers.retrieve('cust_42');

    expect(endpoint.lastRequest?.path).toBe('/customers/cust_42');
    expect(customer.id).toBe('cust_42');
    expect(customer.cpf).toBe('123.456.789-00');
    expect(customer.createdAt).toBe(1775253599);
  });
});

describe('customers.list — auto-pagination via for await', () => {
  it('iterates every customer across pages, threading starting_after, stopping on has_more:false', async () => {
    mock.mockToken();
    const endpoint = mock.mockCustomerPage({
      pages: [[wireCustomer('cust_a'), wireCustomer('cust_b')], [wireCustomer('cust_c')]],
    });
    const client = makeClient();

    const collected: Customer[] = [];
    for await (const customer of client.customers.list({ limit: 2 })) {
      collected.push(customer);
    }

    // Every item of every page, in order, terminating on has_more:false.
    expect(collected.map((c) => c.id)).toEqual(['cust_a', 'cust_b', 'cust_c']);
    // Items are camelCase-mapped through the public surface, not raw wire.
    expect(collected[0]!.cpf).toBe('123.456.789-00');
    // Two page fetches: page 1 (no cursor), page 2 (starting_after = last id of page 1).
    expect(endpoint.callCount).toBe(2);
    expect(endpoint.requests[0]!.path).toContain('limit=2');
    expect(endpoint.requests[0]!.path).not.toContain('starting_after');
    expect(endpoint.requests[1]!.path).toContain('starting_after=cust_b');
  });
});

describe('client.rateLimit — reflects X-RateLimit-* of the last response', () => {
  it('is null before any call and populated from the response headers after one', async () => {
    mock.mockToken();
    mock.mockCustomer({
      customer: wireCustomer('cust_1'),
      headers: {
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '99',
        'x-ratelimit-reset': '60',
      },
    });
    const client = makeClient();

    // camelCase getter (D12/R7) — the V0.1 demo's `rate_limit` is gone.
    expect(client.rateLimit).toBeNull();
    await client.customers.create(CREATE_PARAMS);

    const rateLimit = client.rateLimit;
    expect(rateLimit).not.toBeNull();
    expect(rateLimit?.limit).toBe(100);
    expect(rateLimit?.remaining).toBe(99);
    expect(rateLimit?.resetAt).toBeInstanceOf(Date);
  });
});

describe('customers.update — PATCH with idempotency + camelCase mapping', () => {
  it('PATCHes only the set fields, attaches an Idempotency-Key, and maps the response', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'PATCH',
      path: '/customers/cust_1',
      responses: { statusCode: 200, body: wireCustomer('cust_1', { email: 'new@acme.test' }) },
    });
    const client = makeClient();

    const customer = await client.customers.update('cust_1', { email: 'new@acme.test' });

    expect(endpoint.lastRequest?.method).toBe('PATCH');
    expect(endpoint.lastRequest?.path).toBe('/customers/cust_1');
    // PATCH is a write → auto Idempotency-Key (D9).
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    // Only the set field is sent (PATCH subset via serializeUpdateCustomerRequest).
    expect(JSON.parse(endpoint.lastRequest!.body)).toEqual({ email: 'new@acme.test' });
    expect(customer.email).toBe('new@acme.test');
    expect(customer.id).toBe('cust_1');
  });
});

describe('customers.retrieveBankAccount — GET sub-path + snake→camel mapping', () => {
  it('GETs /bank-account and maps the wire account to a camelCase CustomerBankAccount', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: '/customers/cust_1/bank-account',
      responses: { statusCode: 200, body: wireBankAccount() },
    });
    const client = makeClient();

    const account = await client.customers.retrieveBankAccount('cust_1');

    expect(endpoint.lastRequest?.path).toBe('/customers/cust_1/bank-account');
    expect(account).toEqual({
      id: 'ba_1',
      bankId: '001',
      kind: 'checking',
      branch: '0001',
      number: '1234567',
      digit: '0',
      bankName: 'Banco do Brasil',
      updatedAt: 1775253599,
    });
  });
});

describe('customers.upsertBankAccount — POST wraps the body + idempotent', () => {
  it('wraps the account under `bank_account`, attaches an Idempotency-Key, maps the response', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/customers/cust_1/bank-account',
      responses: { statusCode: 200, body: wireBankAccount() },
    });
    const client = makeClient();

    const account = await client.customers.upsertBankAccount('cust_1', {
      bankId: '001',
      kind: 'checking',
      branch: '0001',
      number: '1234567',
      digit: '0',
    });

    expect(endpoint.lastRequest?.method).toBe('POST');
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    // Contract wraps the request under `bank_account`; the serializer emits the bare,
    // snake_case account fields (alphabetical).
    expect(JSON.parse(endpoint.lastRequest!.body)).toEqual({
      bank_account: {
        bank_id: '001',
        branch: '0001',
        digit: '0',
        kind: 'checking',
        number: '1234567',
      },
    });
    expect(account.id).toBe('ba_1');
    expect(account.bankName).toBe('Banco do Brasil');
  });
});

describe('customers.createBiometricsSession — POST with no request body', () => {
  it('POSTs /biometrics with an empty body + Idempotency-Key and maps the session', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/customers/cust_1/biometrics',
      responses: {
        statusCode: 200,
        body: {
          session_url: 'https://biometrics.dinie.com.br/session/abc',
          expires_at: 1775253599,
        },
      },
    });
    const client = makeClient();

    const session = await client.customers.createBiometricsSession('cust_1');

    expect(endpoint.lastRequest?.method).toBe('POST');
    expect(endpoint.lastRequest?.path).toBe('/customers/cust_1/biometrics');
    // The contract defines NO request body — the SDK sends none.
    expect(endpoint.lastRequest?.body).toBe('');
    // Still an idempotent write.
    expect(endpoint.lastRequest?.headers['x-idempotency-key']).toMatch(/^dinie-sdk-retry-/);
    expect(session).toEqual({
      sessionUrl: 'https://biometrics.dinie.com.br/session/abc',
      expiresAt: 1775253599,
    });
  });

  it('ignores the (empty) placeholder params arg and still sends no body', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'POST',
      path: '/customers/cust_1/biometrics',
      responses: { statusCode: 200, body: { session_url: 'https://x', expires_at: 1 } },
    });
    const client = makeClient();

    await client.customers.createBiometricsSession('cust_1', {});

    expect(endpoint.lastRequest?.body).toBe('');
  });
});

describe('customers.creditOffers.list — auto-pagination over a customer sub-path', () => {
  it('iterates offers across pages, threads starting_after, maps snake→camel', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: /^\/customers\/cust_1\/credit-offers(\?|$)/,
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
    for await (const offer of client.customers.creditOffers.list('cust_1', { limit: 2 })) {
      collected.push(offer);
    }

    expect(collected.map((o) => o.id)).toEqual(['co_a', 'co_b', 'co_c']);
    // camelCase-mapped through the public surface (not raw wire).
    expect(collected[0]!.customerId).toBe('cust_1');
    expect(collected[0]!.approvedAmount).toBe(50000);
    // Two fetches: page 1 (no cursor), page 2 (starting_after = last id of page 1).
    expect(endpoint.callCount).toBe(2);
    expect(endpoint.requests[0]!.path).toContain('limit=2');
    expect(endpoint.requests[0]!.path).not.toContain('starting_after');
    expect(endpoint.requests[1]!.path).toContain('starting_after=co_b');
  });

  it('passes the status filter as a query param', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: /^\/customers\/cust_1\/credit-offers(\?|$)/,
      responses: { statusCode: 200, body: { data: [], has_more: false } },
    });
    const client = makeClient();

    await client.customers.creditOffers.list('cust_1', { status: 'available' });

    expect(endpoint.lastRequest?.path).toContain('status=available');
  });
});

describe('customers.list — PagePromise.withResponse threads the real first-page response', () => {
  it('exposes the real first-page status + headers (no synthetic bridge — story 003)', async () => {
    mock.mockToken();
    mock.mockCustomerPage({
      pages: [[wireCustomer('cust_a')], [wireCustomer('cust_b')]],
      headers: { 'x-request-id': 'req_123' },
    });
    const client = makeClient();

    const { data: page, response } = await client.customers.list({ limit: 1 }).withResponse();

    expect(response.status).toBe(200);
    // Real transport header from the first-page fetch — proves the synthetic
    // `{ status: 200, headers: {} }` bridge is gone (the paginator now threads the
    // APIPromise's real response).
    expect(response.headers['x-request-id']).toBe('req_123');
    expect(page.data.map((c) => c.id)).toEqual(['cust_a']);
    expect(page.hasMore).toBe(true);
  });
});

describe('cancellation — options.signal aborts the request', () => {
  it('rejects with APIConnectionError when the caller signal is already aborted', async () => {
    mock.mockToken();
    mock.mockEndpoint({
      method: 'GET',
      path: '/customers/cust_1',
      responses: { statusCode: 200, body: wireCustomer('cust_1') },
    });
    const client = makeClient();

    const controller = new AbortController();
    controller.abort();

    await expect(
      client.customers.retrieve('cust_1', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(APIConnectionError);
  });
});
