/**
 * README compile-check (story 010) — the guard against doc-rot.
 *
 * The quickstart, webhook, and error-handling snippets in `README.md` MUST keep compiling
 * against the frozen V0.2 public surface. The function bodies below mirror those snippets and
 * are type-checked by `npm run type-check` (tsconfig includes `tests/`): rename a method, change
 * a param shape, or drop an export and `tsc --noEmit` fails HERE. The Vitest assertions pin the
 * functions into the suite WITHOUT invoking the I/O ones — zero network. Imports come ONLY from
 * the curated barrel (`../src/index.js`), exactly what a consumer imports from `@dinie/sdk`.
 *
 * This plays the role V0.1's `_publicSurfaceTypeCheck` played: it keeps the docs honest by
 * making them part of the compile gate.
 */

import { describe, expect, it } from 'vitest';

import {
  Dinie,
  NotFoundError,
  parseRetryAfter,
  RateLimitError,
  ValidationError,
  Webhooks,
} from '../src/index.js';
import type { WebhookEvent } from '../src/index.js';

/** Quickstart — Customer → Offer → Loan (README §Quickstart). Never invoked (no network). */
async function readmeQuickstart(dinie: Dinie, offerId: string): Promise<void> {
  // 1) create customer — cpf + cnpj + email + phone (NO taxId; id is `cust_…`).
  const customer = await dinie.customers.create({
    cpf: '123.456.789-09',
    cnpj: '12.345.678/0001-95',
    email: 'contato@empresa.com.br',
    phone: '+5511999998888',
  });
  void customer.id;

  // 3) fetch the offer (arrived via webhook) and simulate.
  const offer = await dinie.creditOffers.get(offerId);
  const sim = await dinie.creditOffers.createSimulation(offer.id, {
    requestedAmount: 500000,
    installmentCount: 12,
  });

  // 4) create the loan — 5 fields from the offer + accepted simulation.
  const loan = await dinie.loans.create({
    creditOfferId: offer.id,
    simulationId: sim.id,
    installmentCount: sim.installmentCount,
    installmentAmount: sim.installmentAmount,
    firstDueDate: sim.firstDueDate,
  });

  // 5) follow the loan.
  const current = await dinie.loans.get(loan.id);
  void current.status;
  void current.signingUrl;

  // pagination — `for await` over a PagePromise; `/banks` is a flat list.
  for await (const c of dinie.customers.list({ limit: 50 })) {
    void c.id;
  }
  const banks = await dinie.banks.list();
  void banks.length;
}

/** Webhook handler (README §Webhooks). `event.data` narrows per `event.type`. */
function readmeWebhookHandler(raw: {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
}): void {
  const event: WebhookEvent = Webhooks.extract({
    headers: raw.headers,
    body: raw.rawBody,
    secret: 'whsec_test',
  });

  switch (event.type) {
    case 'customer.created':
      // CustomerCreatedData (bespoke subset — NOT the Customer read-model).
      void event.data.id;
      void event.data.status; // 'pending_kyc'
      break;
    case 'credit_offer.available':
      // CreditOfferEventData — the offer id (co_…) feeds the quickstart.
      void event.data.id;
      void event.data.customerId;
      break;
    case 'loan.payment_received':
      // data.payment is an INLINE object, not a Transaction.
      void event.data.payment.amount;
      void event.data.payment.paidAt;
      void event.data.payment.installmentNumber;
      break;
    default:
      break;
  }
}

/** Error handling (README §Tratamento de erros). */
async function readmeErrorHandling(dinie: Dinie): Promise<void> {
  try {
    await dinie.loans.get('ln_inexistente');
  } catch (err) {
    if (err instanceof NotFoundError) {
      void err.status;
      void err.code;
      void err.request_id;
    } else if (err instanceof ValidationError) {
      void err.code;
      void err.detail;
    } else if (err instanceof RateLimitError) {
      // `err.headers['retry-after']` is `string | string[] | undefined` — D11 widening means
      // this type-checks with no cast.
      const waitMs = parseRetryAfter(err.headers['retry-after']);
      void waitMs;
    }
  }
}

/** Construction (README §Configuração) — exercised offline (token is lazy; no socket on `new`). */
function readmeConstruct(): Dinie {
  const dinie = new Dinie({
    clientId: 'test-client',
    clientSecret: 'test-secret',
    baseUrl: 'https://staging.dinie.com.br',
    logLevel: 'debug',
    idempotency: true,
  });
  void dinie.rateLimit; // `RateLimit | null` getter (camelCase, D12)
  return dinie;
}

describe('README quickstart compile-check (story 010)', () => {
  it('the README snippets type-check against the frozen public surface', () => {
    // The real assertion is the type-check (npm run type-check). These pins keep the
    // functions referenced without invoking the I/O ones (no network).
    expect(typeof readmeQuickstart).toBe('function');
    expect(typeof readmeWebhookHandler).toBe('function');
    expect(typeof readmeErrorHandling).toBe('function');
    expect(readmeConstruct()).toBeInstanceOf(Dinie);
  });
});
