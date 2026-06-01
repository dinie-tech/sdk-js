/**
 * Generated-surface E2E (story 010) — the CAPSTONE glue test. Exercises the public
 * `@dinie/sdk` surface end to end over a mocked `undici` transport (D3), with ZERO
 * network (`MockAgent` + `disableNetConnect`, owned by `useMockUndici`). It proves the
 * partner-facing entry point — `new Dinie(...)` → `customers.create/get/list` +
 * `client.rate_limit` — behaves as the version demo promises (§Demo, §5.2, §9.2):
 *
 *   - transparent OAuth2 — the partner NEVER calls `/auth/token`; the SDK mints ONE
 *     token transparently and reuses it across calls;
 *   - `create` auto-attaches a stable `X-Idempotency-Key` (`dinie-sdk-retry-…`) and bridges
 *     camelCase ↔ snake_case across the wire (now via the generated serializers — story 002);
 *   - `get` round-trips a customer;
 *   - `list` auto-paginates via `for await`, threading the `starting_after` cursor and
 *     terminating on `has_more: false`;
 *   - `client.rate_limit` reflects the `X-RateLimit-*` headers of the last response.
 *
 * It imports ONLY the curated barrel (`../../src/index.js`) — the REAL partner entrypoint
 * — never internal runtime/generated paths. The risky runtime mechanics (retry matrix,
 * token concurrency, error mapping, redaction) are covered exhaustively by the runtime
 * tests; here we prove they compose correctly behind the public surface.
 */

import { Dinie } from '../../src/index.js';
import type { Customer } from '../../src/index.js';
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

describe('transparent OAuth2 — the partner never touches /auth/token', () => {
  it('mints exactly one token transparently and reuses it across resource calls', async () => {
    const tokens = mock.mockToken();
    const created = mock.mockCustomer({ customer: wireCustomer('cust_1') });
    const fetched = mock.mockEndpoint({
      method: 'GET',
      path: '/v3/customers/cust_1',
      responses: { statusCode: 200, body: wireCustomer('cust_1') },
    });
    const client = makeClient();

    // The partner calls only resource methods — there is NO public way to request a
    // token. The SDK acquires one transparently on the first call …
    await client.customers.create(CREATE_PARAMS);
    // … and reuses the cached token on the second (no second token POST).
    await client.customers.get('cust_1');

    expect(tokens.callCount).toBe(1);
    expect(tokens.lastRequest?.method).toBe('POST');
    expect(tokens.lastRequest?.path).toBe('/v3/auth/token');
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

describe('customers.get — round-trips a customer by id', () => {
  it('GETs the resource path and maps the wire response to a camelCase Customer', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: '/v3/customers/cust_42',
      responses: { statusCode: 200, body: wireCustomer('cust_42') },
    });
    const client = makeClient();

    const customer = await client.customers.get('cust_42');

    expect(endpoint.lastRequest?.path).toBe('/v3/customers/cust_42');
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

describe('client.rate_limit — reflects X-RateLimit-* of the last response', () => {
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

    expect(client.rate_limit).toBeNull();
    await client.customers.create(CREATE_PARAMS);

    const rateLimit = client.rate_limit;
    expect(rateLimit).not.toBeNull();
    expect(rateLimit?.limit).toBe(100);
    expect(rateLimit?.remaining).toBe(99);
    expect(rateLimit?.resetAt).toBeInstanceOf(Date);
  });
});
