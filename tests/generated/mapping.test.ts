/**
 * Focused tests for the generated-layer GLUE (story 009): the camelCase ↔ snake_case
 * wire mapping (now delegated to the story-002 serializers) and the public
 * `Webhooks.extract` type binding (D8). These exercise the concerns this layer OWNS —
 * they deliberately do NOT re-test OAuth transparency, idempotency, or retry (runtime
 * stories), nor the full surface E2E (story 010).
 */

import { Customers } from '../../src/generated/resources/customers.js';
import { HttpClient } from '../../src/runtime/http.js';
import { Dinie, Webhooks } from '../../src/index.js';
import type {
  BiometricsSession,
  CreateCustomerRequest,
  CreditOffer,
  Customer,
  CustomerBankAccount,
  CustomerBankAccountRequest,
  CustomerCreatedData,
  CustomerCreatedEvent,
  CustomerListParams,
  PagePromise,
  RateLimit,
  RequestOptions,
  UpdateCustomerRequest,
  WebhookEvent,
} from '../../src/index.js';
import { useMockUndici } from '../_helpers/mock-undici.js';
import { signWebhook } from '../_helpers/webhook-fixtures.js';

const mock = useMockUndici();

// Compile-only guard: the §5.2 public-surface demo must type-check against the curated
// barrel. Never executed — the value is that `tsc --noEmit` fails if the public surface
// drifts from the documented shape (the runtime behavior is covered by story 010).
async function _publicSurfaceTypeCheck(): Promise<void> {
  const client = new Dinie({ clientId: 'id', clientSecret: 'secret', baseUrl: 'https://x' });
  const createParams: CreateCustomerRequest = {
    email: 'a@b.test',
    phone: '+5511999999999',
    cpf: '123.456.789-00',
    cnpj: '12.345.678/0001-90',
  };
  const listParams: CustomerListParams = { limit: 10 };
  const options: RequestOptions = {};

  const updateParams: UpdateCustomerRequest = { email: 'a@b.test' };
  const bankAccountParams: CustomerBankAccountRequest = {
    bankId: '001',
    kind: 'checking',
    branch: '0001',
    number: '1234567',
    digit: '0',
  };

  expectTypeOf(client.customers.create(createParams, options)).resolves.toEqualTypeOf<Customer>();
  expectTypeOf(client.customers.retrieve('cust_1', options)).resolves.toEqualTypeOf<Customer>();
  expectTypeOf(client.customers.list(listParams)).toEqualTypeOf<PagePromise<Customer>>();
  expectTypeOf(
    client.customers.update('cust_1', updateParams, options),
  ).resolves.toEqualTypeOf<Customer>();
  expectTypeOf(
    client.customers.retrieveBankAccount('cust_1', options),
  ).resolves.toEqualTypeOf<CustomerBankAccount>();
  expectTypeOf(
    client.customers.upsertBankAccount('cust_1', bankAccountParams, options),
  ).resolves.toEqualTypeOf<CustomerBankAccount>();
  expectTypeOf(
    client.customers.createBiometricsSession('cust_1'),
  ).resolves.toEqualTypeOf<BiometricsSession>();
  expectTypeOf(client.customers.creditOffers.list('cust_1', { status: 'available' })).toEqualTypeOf<
    PagePromise<CreditOffer>
  >();
  // camelCase getter (D12/R7) — the V0.1 demo's snake_case `rate_limit` is gone.
  expectTypeOf(client.rateLimit).toEqualTypeOf<RateLimit | null>();

  for await (const customer of client.customers.list()) {
    expectTypeOf(customer).toEqualTypeOf<Customer>();
  }

  const event = Webhooks.extract({
    headers: {},
    body: '',
    secret: 'whsec_x',
    toleranceSeconds: 300,
  });
  expectTypeOf(event).toEqualTypeOf<WebhookEvent>();
}
void _publicSurfaceTypeCheck;

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

/** A valid `CreateCustomerRequest` (R1 — no `taxId`). */
const CREATE_PARAMS: CreateCustomerRequest = {
  email: 'ops@acme.test',
  phone: '+5511999999999',
  cpf: '123.456.789-00',
  cnpj: '12.345.678/0001-90',
  name: 'Acme Pagamentos Ltda',
};

/** A snake_case wire customer record (reconciled shape, story 002). */
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

describe('Customers — camelCase ↔ snake_case mapping via the generated serializers', () => {
  it('maps create params to the snake_case wire body and the response back to camelCase', async () => {
    mock.mockToken();
    const endpoint = mock.mockCustomer({ customer: wireCustomer('cust_1') });
    const customers = makeCustomers();

    const result = await customers.create(CREATE_PARAMS);

    // Request body: camelCase params → snake_case wire (serializeCreateCustomerRequest).
    const sentBody = JSON.parse(endpoint.lastRequest!.body) as Record<string, unknown>;
    expect(sentBody).toEqual({
      cnpj: '12.345.678/0001-90',
      cpf: '123.456.789-00',
      email: 'ops@acme.test',
      name: 'Acme Pagamentos Ltda',
      phone: '+5511999999999',
    });

    // Response: snake_case wire → camelCase surface (deserializeCustomer).
    expect(result).toEqual({
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

  it('omits absent optionals on the wire body and an absent kyc array on the surface', async () => {
    mock.mockToken();
    const endpoint = mock.mockCustomer({ customer: wireCustomer('cust_2') });
    const customers = makeCustomers();

    // No `name`/`externalId` → they must not appear on the wire body (exactOptionalPropertyTypes).
    const result = await customers.create({
      email: 'ops@acme.test',
      phone: '+5511999999999',
      cpf: '123.456.789-00',
      cnpj: '12.345.678/0001-90',
    });

    const sentBody = JSON.parse(endpoint.lastRequest!.body) as Record<string, unknown>;
    expect('name' in sentBody).toBe(false);
    expect('external_id' in sentBody).toBe(false);
    // The wire customer carries no `kyc`, so the deserialized surface omits it entirely.
    expect('kyc' in result).toBe(false);
  });

  it('maps retrieve response to camelCase', async () => {
    mock.mockToken();
    mock.mockEndpoint({
      method: 'GET',
      path: /^\/customers\/cust_42/,
      responses: { statusCode: 200, body: wireCustomer('cust_42') },
    });
    const customers = makeCustomers();

    const result = await customers.retrieve('cust_42');

    expect(result.id).toBe('cust_42');
    expect(result.cpf).toBe('123.456.789-00');
    expect(result.createdAt).toBe(1775253599);
  });

  it('maps list params (limit, startingAfter) to the wire query', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: /^\/customers/,
      responses: { statusCode: 200, body: { object: 'list', data: [], has_more: false } },
    });
    const customers = makeCustomers();

    await customers.list({ limit: 25, startingAfter: 'cust_seed' });

    const path = endpoint.lastRequest!.path;
    expect(path).toContain('limit=25');
    expect(path).toContain('starting_after=cust_seed');
  });

  it('feeds the last item id as the next-page starting_after cursor and maps each item', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: /^\/customers/,
      responses: [
        {
          statusCode: 200,
          body: {
            object: 'list',
            data: [wireCustomer('cust_a'), wireCustomer('cust_b')],
            has_more: true,
          },
        },
        {
          statusCode: 200,
          body: { object: 'list', data: [wireCustomer('cust_c')], has_more: false },
        },
      ],
    });
    const customers = makeCustomers();

    const collected: Customer[] = [];
    for await (const customer of customers.list({ limit: 2 })) {
      collected.push(customer);
    }

    expect(collected.map((c) => c.id)).toEqual(['cust_a', 'cust_b', 'cust_c']);
    // Items are camelCase-mapped, not raw wire.
    expect(collected[0]!.cpf).toBe('123.456.789-00');
    // The second request carries the cursor = the id of the last item of page 1.
    expect(endpoint.requests[1]!.path).toContain('starting_after=cust_b');
  });
});

describe('public Webhooks.extract — typed WebhookEvent binding (D8)', () => {
  it('verifies and returns a narrowable customer.created event', () => {
    const fixture = signWebhook();

    const event = Webhooks.extract({
      headers: fixture.headers,
      body: fixture.body,
      secret: fixture.secret,
    });

    expect(event.type).toBe('customer.created');
    // The discriminant narrows `data` to the bespoke event payload at compile time AND runtime.
    if (event.type === 'customer.created') {
      expect(event.data.cpf).toBe('123.456.789-00');
    }
  });

  it('narrows event.data to its event payload on the discriminant (type-level)', () => {
    const event = {} as WebhookEvent;
    if (event.type === 'customer.created') {
      // The 15-member union narrows to the exact member. `data` is the BESPOKE event payload
      // (`CustomerCreatedData`), NOT the `Customer` read-model — story 007 surfaced that the
      // openapi `WebhookEvent_CustomerCreated.data` is a slimmer, event-specific shape.
      expectTypeOf(event).toEqualTypeOf<CustomerCreatedEvent>();
      expectTypeOf(event.data).toEqualTypeOf<CustomerCreatedData>();
    }
  });
});
