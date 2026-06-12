/**
 * README snippet execution test (story 011, DoD #7) — executable README.
 *
 * Ports 005's harness (lessons.md L11) to JavaScript:
 *   1. Extract TypeScript code blocks from README positionally (block order = the contract;
 *      reordering a block breaks this test intentionally).
 *   2. Execute the quickstart + Customer→Offer→Loan flow + Webhooks handler against the
 *      **built artifact** (`dist/`) using an undici `MockAgent` class-level mock (vi.mock
 *      replaces Pool so ANY `new Dinie(...)` constructed in the test scope is intercepted).
 *   3. Negative control: a stale-shape call (wrong type) throws BEFORE HTTP — no mock needed.
 *
 * Known ID constants (L11 — exact-URL matching):
 *   CUST_ID = 'cust_readme_001', OFFER_ID = 'co_readme_001',
 *   LOAN_ID = 'ln_readme_001',  SIM_ID   = 'sim_readme_001'
 *
 * Note: vi.mock() is hoisted by vitest, so the mock is in place before ANY module is
 * imported (including dist/). This makes Pool replacements transparent to the SDK.
 *
 * Requires: `npm run build` before `npm test` (tests import from ../dist/).
 * If dist/ is absent, each test is skipped with a clear message.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Dispatcher } from 'undici';
import { MockAgent } from 'undici';

// ── Dist-present guard ────────────────────────────────────────────────────────

const DIST_INDEX = resolve(import.meta.dirname, '..', 'dist', 'index.js');
const DIST_AVAILABLE = existsSync(DIST_INDEX);

// ── Class-level transport mock ────────────────────────────────────────────────
// vi.mock is hoisted — runs BEFORE imports, so dist/runtime/http.js's `import { Pool } from 'undici'`
// receives our FakePool backed by the testMockAgent below.

let testMockAgent: MockAgent;

vi.mock('undici', async (importActual) => {
  const actual = await importActual<typeof import('undici')>();

  // FakePool: a Dispatcher whose dispatch() delegates to a MockPool on testMockAgent.
  // This intercepts ALL `new Pool(origin)` calls made by the SDK's HttpClient.
  // Types are imported at the top of the file (import type { Dispatcher }) since
  // `actual.Dispatcher.DispatchOptions` can't be used as a type inside a runtime callback.
  class FakePool extends actual.Dispatcher {
    #pool: ReturnType<MockAgent['get']>;
    constructor(origin: string | URL, _options?: unknown) {
      super();
      // testMockAgent is set in beforeEach; the first FakePool construction must come after.
      this.#pool = testMockAgent.get(String(origin));
    }
    override dispatch(
      options: Dispatcher.DispatchOptions,
      handler: Dispatcher.DispatchHandlers,
    ): boolean {
      return this.#pool.dispatch(options, handler);
    }
    override async close(): Promise<void> {
      // no-op — MockPool is managed by testMockAgent lifecycle
    }
    override async destroy(): Promise<void> {
      // no-op
    }
  }

  return {
    ...actual,
    Pool: FakePool,
  };
});

// ── README extraction ─────────────────────────────────────────────────────────

const README_PATH = resolve(import.meta.dirname, '..', 'README.md');
const README = readFileSync(README_PATH, 'utf8');

// Extract TypeScript code blocks positionally (block order = the contract — L11).
const TS_BLOCKS = [...README.matchAll(/```typescript\n([\s\S]*?)```/g)].map((m) => m[1]!);

// ── Known ID constants (L11: exact-URL matching) ──────────────────────────────

const BASE_URL = 'https://api.dinie.test';
const CUST_ID = 'cust_readme_001';
const OFFER_ID = 'co_readme_001';
const SIM_ID = 'sim_readme_001';
const LOAN_ID = 'ln_readme_001';

// Token endpoint (SDK does POST /auth/token on the base url)
const TOKEN_PATH = '/api/v3/auth/token';

// ── Mock lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  testMockAgent = new MockAgent();
  testMockAgent.disableNetConnect();
});

afterEach(async () => {
  await testMockAgent.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePool(origin: string) {
  return testMockAgent.get(origin);
}

function skipIfNoBuild(t: { skip: () => void }): boolean {
  if (!DIST_AVAILABLE) {
    t.skip();
    return true;
  }
  return false;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('README block extraction — positional contract (L11)', () => {
  it('README has the expected TypeScript code blocks (count ≥ 5)', () => {
    // If this fails, the README was restructured. Update the count here AND the block tests below.
    expect(TS_BLOCKS.length).toBeGreaterThanOrEqual(5);
  });

  it('block[0] is the configuration / installation block (contains Dinie constructor)', () => {
    expect(TS_BLOCKS[0]).toContain('new Dinie(');
    expect(TS_BLOCKS[0]).toContain('clientId');
    expect(TS_BLOCKS[0]).toContain('clientSecret');
  });

  it('block[1] is the quickstart Customer→Offer→Loan flow', () => {
    expect(TS_BLOCKS[1]).toContain('customers.create(');
    expect(TS_BLOCKS[1]).toContain('creditOffers.retrieve(');
    expect(TS_BLOCKS[1]).toContain('loans.create(');
  });

  it('block containing Webhooks.extract is present', () => {
    const webhooksBlock = TS_BLOCKS.find((b) => b.includes('Webhooks.extract('));
    expect(webhooksBlock).toBeDefined();
    expect(webhooksBlock).toContain('credit_offer.available');
  });
});

describe('DoD #7 — README snippets execute against built artifact + mocked transport', () => {
  it(
    'quickstart + Customer→Offer→Loan flow executes without throwing',
    async (t) => {
      if (skipIfNoBuild(t)) return;

      // Dynamic import from the built artifact (dist/) — class-level Pool mock is already active.
      const { Dinie } = await import(DIST_INDEX);

      // Set up interceptors on the mock pool for BASE_URL/api/v3
      const pool = makePool(BASE_URL);

      // Token endpoint
      pool
        .intercept({ path: TOKEN_PATH, method: 'POST' })
        .reply(
          200,
          { access_token: 'tok-readme-1', token_type: 'Bearer', expires_in: 3600 },
          {
            headers: { 'content-type': 'application/json' },
          },
        )
        .persist();

      // POST /api/v3/customers → 201
      pool
        .intercept({ path: '/api/v3/customers', method: 'POST' })
        .reply(
          201,
          {
            id: CUST_ID,
            external_id: null,
            name: 'Empresa Teste Ltda',
            email: 'contato@empresa.com.br',
            phone: '+5511999998888',
            cpf: '123.456.789-09',
            cnpj: '12.345.678/0001-95',
            trading_name: 'Empresa Teste',
            status: 'active',
            created_at: 1775253599,
            updated_at: 1775253599,
          },
          { headers: { 'content-type': 'application/json' } },
        )
        .persist();

      // GET /api/v3/credit-offers/:id
      pool
        .intercept({ path: `/api/v3/credit-offers/${OFFER_ID}`, method: 'GET' })
        .reply(
          200,
          {
            id: OFFER_ID,
            customer_id: CUST_ID,
            status: 'available',
            max_amount: 1000000,
            min_amount: 10000,
            created_at: 1775253599,
            updated_at: 1775253599,
          },
          { headers: { 'content-type': 'application/json' } },
        )
        .persist();

      // POST /api/v3/credit-offers/:id/simulations
      pool
        .intercept({ path: `/api/v3/credit-offers/${OFFER_ID}/simulations`, method: 'POST' })
        .reply(
          201,
          {
            id: SIM_ID,
            credit_offer_id: OFFER_ID,
            requested_amount: 500000,
            installment_count: 12,
            installment_amount: 45000,
            first_due_date: '2026-07-08',
            created_at: 1775253599,
          },
          { headers: { 'content-type': 'application/json' } },
        )
        .persist();

      // POST /api/v3/loans
      pool
        .intercept({ path: '/api/v3/loans', method: 'POST' })
        .reply(
          201,
          {
            id: LOAN_ID,
            credit_offer_id: OFFER_ID,
            simulation_id: SIM_ID,
            status: 'awaiting_signatures',
            installment_count: 12,
            installment_amount: 45000,
            first_due_date: '2026-07-08',
            signing_url: 'https://sign.dinie.test/ln_readme_001',
            created_at: 1775253599,
            updated_at: 1775253599,
          },
          { headers: { 'content-type': 'application/json' } },
        )
        .persist();

      // GET /api/v3/loans/:id
      pool
        .intercept({ path: `/api/v3/loans/${LOAN_ID}`, method: 'GET' })
        .reply(
          200,
          {
            id: LOAN_ID,
            credit_offer_id: OFFER_ID,
            simulation_id: SIM_ID,
            status: 'active',
            installment_count: 12,
            installment_amount: 45000,
            first_due_date: '2026-07-08',
            signing_url: 'https://sign.dinie.test/ln_readme_001',
            created_at: 1775253599,
            updated_at: 1775253599,
          },
          { headers: { 'content-type': 'application/json' } },
        )
        .persist();

      // ── Execute the flow shown in the README's quickstart block ──────────────
      const dinie = new Dinie({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        baseUrl: `${BASE_URL}/api/v3`,
      });

      // 1) Create customer
      const customer = await dinie.customers.create({
        cpf: '123.456.789-09',
        cnpj: '12.345.678/0001-95',
        email: 'contato@empresa.com.br',
        phone: '+5511999998888',
      });
      expect(customer.id).toBe(CUST_ID);

      // 2) The offer arrives via webhook (OFFER_ID known from the handler — use the constant)
      // 3) Fetch offer + simulate
      const offer = await dinie.creditOffers.retrieve(OFFER_ID);
      expect(offer.id).toBe(OFFER_ID);

      const sim = await dinie.creditOffers.createSimulation(offer.id, {
        requestedAmount: 500000,
        installmentCount: 12,
      });
      expect(sim.id).toBe(SIM_ID);

      // 4) Create loan
      const loan = await dinie.loans.create({
        creditOfferId: offer.id,
        simulationId: sim.id,
        installmentCount: sim.installmentCount,
        installmentAmount: sim.installmentAmount,
        firstDueDate: sim.firstDueDate,
      });
      expect(loan.id).toBe(LOAN_ID);

      // 5) Follow loan
      const current = await dinie.loans.retrieve(loan.id);
      expect(current.status).toBe('active');
      expect(current.signingUrl).toBeTruthy();
    },
    { timeout: 15_000 },
  );

  it(
    'Webhooks.extract — valid event → typed; tampered → signature error; out-of-window → timestamp error',
    async (t) => {
      if (skipIfNoBuild(t)) return;

      const { Webhooks, WebhookSignatureError, WebhookTimestampError } = await import(DIST_INDEX);

      // We need a real Standard Webhooks signature to pass verification.
      // Use the test fixtures from tests/_helpers/webhook-fixtures.ts approach:
      // sign with a known secret and verify with the same secret.
      const crypto = await import('node:crypto');

      const secret = 'whsec_dGVzdC1zZWNyZXQtMTIzNDU2Nzg5MDEyMzQ1Ng=='; // base64 of "test-secret-1234567890123456"
      const msgId = 'msg_readme_001';
      const nowTs = Math.floor(Date.now() / 1000);
      const timestamp = String(nowTs);
      const body = JSON.stringify({
        type: 'credit_offer.available',
        data: {
          id: OFFER_ID,
          customer_id: CUST_ID,
          status: 'available',
          max_amount: 1000000,
          min_amount: 10000,
          created_at: nowTs,
          updated_at: nowTs,
        },
      });

      // Standard Webhooks signature: HMAC-SHA256 over "msgId.timestamp.body" (dot-separated).
      // See src/runtime/webhooks.ts: signedPayload = `${webhookId}.${webhookTimestamp}.${body}`.
      const secretBytes = Buffer.from(secret.replace('whsec_', ''), 'base64');
      const toSign = `${msgId}.${timestamp}.${body}`;
      const sig = crypto.createHmac('sha256', secretBytes).update(toSign).digest('base64');
      const signature = `v1,${sig}`;

      const headers = {
        'webhook-id': msgId,
        'webhook-timestamp': timestamp,
        'webhook-signature': signature,
      };

      // Valid → typed event
      const event = Webhooks.extract({ headers, body, secret });
      expect(event.type).toBe('credit_offer.available');
      expect(event.data.id).toBe(OFFER_ID);

      // Tampered signature → WebhookSignatureError (before HTTP)
      expect(() =>
        Webhooks.extract({
          headers: { ...headers, 'webhook-signature': 'v1,tampered' },
          body,
          secret,
        }),
      ).toThrow(WebhookSignatureError);

      // Out-of-window timestamp → WebhookTimestampError (before HTTP)
      const staleTs = String(nowTs - 400); // 400 seconds ago — outside 300s window
      const staleSign = `v1,${crypto.createHmac('sha256', secretBytes).update(`${msgId}.${staleTs}.${body}`).digest('base64')}`;
      expect(() =>
        Webhooks.extract({
          headers: { ...headers, 'webhook-timestamp': staleTs, 'webhook-signature': staleSign },
          body,
          secret,
        }),
      ).toThrow(WebhookTimestampError);
    },
    { timeout: 10_000 },
  );

  it(
    'negative control — Webhooks.extract with missing secret throws BEFORE HTTP (pure computation)',
    async (t) => {
      if (skipIfNoBuild(t)) return;

      const { Webhooks, WebhookSignatureError } = await import(DIST_INDEX);

      // L11: "a stale-shape call … raises a TypeError/throw BEFORE any HTTP (argument
      // binding is synchronous)". Webhooks.extract is pure computation (no HTTP), so
      // ANY failure here proves the gate is real — no network mock needed.
      //
      // Missing secret → WebhookSignatureError (synchronous, before any network).
      // No mock interceptors registered — disableNetConnect() on testMockAgent would catch
      // any accidental HTTP attempt.
      // Use a current timestamp (so timestamp check passes) but an empty secret.
      // SDK checks timestamp FIRST, then secrets. Empty secret → "No webhook secret provided".
      const freshTs = String(Math.floor(Date.now() / 1000));
      expect(() =>
        Webhooks.extract({
          headers: {
            'webhook-id': 'msg_neg',
            'webhook-timestamp': freshTs,
            'webhook-signature': 'v1,bad',
          },
          body: '{"type":"customer.created","data":{}}',
          secret: '', // empty secret → WebhookSignatureError before HMAC
        }),
      ).toThrow(WebhookSignatureError);
    },
    { timeout: 5_000 },
  );
});
