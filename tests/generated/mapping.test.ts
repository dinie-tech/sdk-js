/**
 * Focused tests for the generated-layer GLUE (story 009): the camelCase ↔ snake_case
 * wire mapping (D4) and the public `Webhooks.extract` type binding (D8). These exercise
 * the concerns this layer OWNS — they deliberately do NOT re-test OAuth transparency,
 * idempotency, or retry (runtime stories), nor the full surface E2E (story 010).
 */

import { Customers } from '../../src/generated/resources/customers.js';
import { HttpClient } from '../../src/runtime/http.js';
import { Dinie, Webhooks } from '../../src/index.js';
import type {
  Customer,
  CustomerCreatedEvent,
  CustomerCreateParams,
  CustomerListParams,
  PagePromise,
  RateLimit,
  RequestOptions,
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
  const createParams: CustomerCreateParams = { taxId: '1', name: 'n' };
  const listParams: CustomerListParams = { limit: 10 };
  const options: RequestOptions = {};

  expectTypeOf(client.customers.create(createParams, options)).resolves.toEqualTypeOf<Customer>();
  expectTypeOf(client.customers.get('cus_1', options)).resolves.toEqualTypeOf<Customer>();
  expectTypeOf(client.customers.list(listParams)).toEqualTypeOf<PagePromise<Customer>>();
  expectTypeOf(client.rate_limit).toEqualTypeOf<RateLimit | null>();

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

/** A snake_case wire customer record. */
function wireCustomer(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    object: 'customer',
    tax_id: '12345678000190',
    name: 'Acme Pagamentos Ltda',
    status: 'active',
    created_at: '2026-05-27T12:00:00.000Z',
    ...extra,
  };
}

describe('Customers — camelCase ↔ snake_case mapping (D4)', () => {
  it('maps create params to the snake_case wire body and the response back to camelCase', async () => {
    mock.mockToken();
    const endpoint = mock.mockCustomer({
      customer: wireCustomer('cus_1', { email: 'ops@acme.test' }),
    });
    const customers = makeCustomers();

    const result = await customers.create({
      taxId: '12345678000190',
      name: 'Acme Pagamentos Ltda',
      email: 'ops@acme.test',
    });

    // Request body: camelCase params → snake_case wire.
    const sentBody = JSON.parse(endpoint.lastRequest!.body) as Record<string, unknown>;
    expect(sentBody).toEqual({
      tax_id: '12345678000190',
      name: 'Acme Pagamentos Ltda',
      email: 'ops@acme.test',
    });

    // Response: snake_case wire → camelCase surface.
    expect(result).toEqual({
      id: 'cus_1',
      object: 'customer',
      taxId: '12345678000190',
      name: 'Acme Pagamentos Ltda',
      email: 'ops@acme.test',
      status: 'active',
      createdAt: '2026-05-27T12:00:00.000Z',
    });
  });

  it('omits an absent optional email on both the wire body and the surface', async () => {
    mock.mockToken();
    const endpoint = mock.mockCustomer({ customer: wireCustomer('cus_2') });
    const customers = makeCustomers();

    const result = await customers.create({ taxId: '12345678000190', name: 'No Email Ltda' });

    const sentBody = JSON.parse(endpoint.lastRequest!.body) as Record<string, unknown>;
    expect('email' in sentBody).toBe(false);
    expect('email' in result).toBe(false);
  });

  it('maps get response to camelCase', async () => {
    mock.mockToken();
    mock.mockEndpoint({
      method: 'GET',
      path: /^\/v3\/customers\/cus_42/,
      responses: { statusCode: 200, body: wireCustomer('cus_42') },
    });
    const customers = makeCustomers();

    const result = await customers.get('cus_42');

    expect(result.id).toBe('cus_42');
    expect(result.taxId).toBe('12345678000190');
    expect(result.createdAt).toBe('2026-05-27T12:00:00.000Z');
  });

  it('maps list params (limit, startingAfter) to the wire query', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: /^\/v3\/customers/,
      responses: { statusCode: 200, body: { object: 'list', data: [], has_more: false } },
    });
    const customers = makeCustomers();

    await customers.list({ limit: 25, startingAfter: 'cus_seed' });

    const path = endpoint.lastRequest!.path;
    expect(path).toContain('limit=25');
    expect(path).toContain('starting_after=cus_seed');
  });

  it('feeds the last item id as the next-page starting_after cursor and maps each item', async () => {
    mock.mockToken();
    const endpoint = mock.mockEndpoint({
      method: 'GET',
      path: /^\/v3\/customers/,
      responses: [
        {
          statusCode: 200,
          body: {
            object: 'list',
            data: [wireCustomer('cus_a'), wireCustomer('cus_b')],
            has_more: true,
          },
        },
        {
          statusCode: 200,
          body: { object: 'list', data: [wireCustomer('cus_c')], has_more: false },
        },
      ],
    });
    const customers = makeCustomers();

    const collected: Customer[] = [];
    for await (const customer of customers.list({ limit: 2 })) {
      collected.push(customer);
    }

    expect(collected.map((c) => c.id)).toEqual(['cus_a', 'cus_b', 'cus_c']);
    // Items are camelCase-mapped, not raw wire.
    expect(collected[0]!.taxId).toBe('12345678000190');
    // The second request carries the cursor = the id of the last item of page 1.
    expect(endpoint.requests[1]!.path).toContain('starting_after=cus_b');
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
    // The discriminant narrows `data` to `Customer` at compile time AND runtime.
    if (event.type === 'customer.created') {
      expect(event.data.taxId).toBe('12345678000190');
    }
  });

  it('narrows event.data to Customer on the discriminant (type-level)', () => {
    const event = {} as WebhookEvent;
    expectTypeOf(event).toEqualTypeOf<CustomerCreatedEvent>();
    if (event.type === 'customer.created') {
      expectTypeOf(event.data).toEqualTypeOf<Customer>();
    }
  });
});
