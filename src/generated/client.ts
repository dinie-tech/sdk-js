/**
 * `Dinie` — the SDK entry point (architecture §6, §9.1).
 * Hand-authored in V0.1 to mirror future generator output (D1); V0.4 overwrites it.
 *
 * Responsibilities:
 *   1. Browser guard — throw if running in a browser. The SDK is backend-only: an OAuth2
 *      `client_secret` in the front end violates the threat model (architecture §12).
 *   2. Env-var resolution — fall back to `DINIE_CLIENT_ID` / `DINIE_CLIENT_SECRET` /
 *      `DINIE_BASE_URL` when the corresponding config field is absent. (`DINIE_LOG` is
 *      resolved inside the runtime logger, so it is intentionally not handled here.)
 *   3. Compose the transport + resources — build one {@link HttpClient} (which builds the
 *      `TokenManager` internally on the same dispatcher) and hang each resource off it.
 *   4. Expose `rateLimit` — the latest rate-limit snapshot. camelCase (D12/R7), correcting the
 *      `rate_limit` the V0.1 demo inherited: the SDK surface is camelCase end to end.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports only from `runtime/` (the transport, config type, error
 * base, rate-limit type) and a sibling generated resource — never the reverse.
 */

import { DinieError } from '../runtime/errors.js';
import { HttpClient, type DinieConfig } from '../runtime/http.js';
import type { RateLimit } from '../runtime/rate-limit.js';

import { Banks } from './resources/banks.js';
import { Credentials } from './resources/credentials.js';
import { CreditOffers } from './resources/credit-offers.js';
import { Customers } from './resources/customers.js';
import { Loans } from './resources/loans.js';
import { WebhookEndpoints } from './resources/webhook-endpoints.js';

/**
 * The Dinie API client. Construct once and reuse — it owns a connection pool and an
 * in-memory OAuth2 token cache.
 *
 * @example
 * const client = new Dinie({ clientId, clientSecret });
 * const customer = await client.customers.create({ email, phone, cpf, cnpj });
 */
export class Dinie {
  /** The banks resource — list the bank directory (flat, non-paginated). */
  readonly banks: Banks;

  /** The credentials resource — create/list/revoke API keys (create returns the one-time secret). */
  readonly credentials: Credentials;

  /** The credit-offers resource — list/retrieve offers + createSimulation (no create — R10). */
  readonly creditOffers: CreditOffers;

  /**
   * The customers resource — the full surface: create/retrieve/list/update + singleton sub-paths
   * (retrieveBankAccount/upsertBankAccount/createBiometricsSession/startKycReview) + the nested
   * collections `customers.creditOffers.list` and `customers.kycAttachments.create`.
   */
  readonly customers: Customers;

  /** The loans resource — create/retrieve loans + the nested collection `loans.transactions.list`. */
  readonly loans: Loans;

  /** The webhook-endpoints resource — create/list/retrieve/update/delete/rotateSecret (REST management). */
  readonly webhookEndpoints: WebhookEndpoints;

  readonly #http: HttpClient;

  constructor(config: DinieConfig) {
    // 1. Backend-only guard — refuse to run where the client secret could leak. Probe
    //    `window` via `globalThis` so the check compiles without the DOM lib (Node types).
    if (typeof (globalThis as { window?: unknown }).window !== 'undefined') {
      throw new DinieError(
        'The Dinie SDK is backend-only and must not run in a browser: the OAuth2 client secret would be exposed. Call it from a server-side runtime.',
      );
    }

    // 2. Resolve credentials + base URL, env vars filling any gap.
    const clientId = firstNonEmpty(config.clientId, process.env['DINIE_CLIENT_ID']);
    if (clientId === undefined) {
      throw new DinieError('Missing Dinie client id: pass `clientId` or set DINIE_CLIENT_ID.');
    }
    const clientSecret = firstNonEmpty(config.clientSecret, process.env['DINIE_CLIENT_SECRET']);
    if (clientSecret === undefined) {
      throw new DinieError(
        'Missing Dinie client secret: pass `clientSecret` or set DINIE_CLIENT_SECRET.',
      );
    }
    const baseUrl = firstNonEmpty(config.baseUrl, process.env['DINIE_BASE_URL']);

    // 3. Compose the transport + resources. HttpClient builds the TokenManager itself on
    //    the same dispatcher, so there is no separate token wiring here.
    const resolvedConfig: DinieConfig = {
      ...config,
      clientId,
      clientSecret,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    };
    this.#http = new HttpClient(resolvedConfig);
    this.banks = new Banks(this.#http);
    this.credentials = new Credentials(this.#http);
    this.creditOffers = new CreditOffers(this.#http);
    this.customers = new Customers(this.#http);
    this.loans = new Loans(this.#http);
    this.webhookEndpoints = new WebhookEndpoints(this.#http);
  }

  /** Latest rate-limit snapshot from the most recent response; `null` before the first call. */
  get rateLimit(): RateLimit | null {
    return this.#http.rateLimit;
  }
}

/** First of the candidates that is a non-empty string, else `undefined`. */
function firstNonEmpty(...candidates: (string | undefined)[]): string | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== '') return candidate;
  }
  return undefined;
}
