/**
 * `Credentials` resource — API-key management (architecture §3.1, §6, §7.1). Hand-authored in
 * V0.2 to mirror future generator output (D1); V0.4 overwrites it. A mechanical copy of the
 * `customers.ts` convention (story 003): inject the {@link HttpClient}, delegate the camelCase ↔
 * snake_case bridge to the per-type generated serializers, methods alphabetical.
 *
 * ── The 3 methods (alphabetical — minimal diff for the V0.4 generator) ──
 *   create   POST     /v3/auth/credentials              → CredentialWithSecret (201, idempotent)
 *   list     GET      /v3/auth/credentials              → PagePromise<Credential>
 *   revoke   DELETE   /v3/auth/credentials/{client_id}  → void (204)
 *
 * ── Method naming (§7.1 — strip the resource noun) ──
 *   createCredential → create   (strip `Credential`)
 *   listCredentials  → list     (strip `Credentials`)
 *   revokeCredential → revoke   (strip `Credential`)
 *
 * The first path segment is `/auth`, but the architecture (§3.1, D3) groups the credential
 * operations under `client.credentials` (the `token` op under `/auth` is internal — the
 * `TokenManager`, never a public method).
 *
 * ── Secret-bearing creation (§3.1) ──
 * `create` returns {@link CredentialWithSecret} — the only response that carries `clientSecret`
 * (shown once). `list` returns plain {@link Credential}s (no secret). The runtime logger redacts
 * `client_secret` (story 001).
 *
 * ── Idempotency (§7.4 / §3.1) ──
 * `create` (POST write) passes `idempotent: true` → the runtime mints a stable
 * `X-Idempotency-Key` reused across retries. `revoke` is a DELETE: naturally idempotent
 * server-side and marked "—" in the §3.1 idempotency column, so it does NOT carry an
 * auto-generated key (`idempotent: false`). `list` is a GET (`idempotent: false`).
 * (Determinism note: §7.4 phrases the rule as "every non-GET", which would include DELETE; the
 * §3.1 table is more specific and marks DELETE as non-idempotent — surfaced for `principles.md`,
 * story 009.)
 *
 * ── `revoke` 409 (`last_active_credential`) ──
 * Revoking the last active credential fails `409 Conflict` with `code: last_active_credential`
 * (openapi @ 3fcfd83). No new error class is needed: the runtime maps `409` → `ConflictError`
 * (story 001) and the partner discriminates via `err.code` — `404` (`credential_not_found`) maps
 * to `NotFoundError` the same way.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports ONLY from `runtime/` (`HttpClient`, `RequestOptions`,
 * `PagePromise`/`FetchPage`, `ListEnvelope`) plus sibling generated types — never the reverse.
 * The `HttpClient` is injected by `client.ts`; this class never builds one.
 */

import type { HttpClient, ListEnvelope, RequestOptions } from '../../runtime/http.js';
import { PagePromise, type FetchPage } from '../../runtime/paginator.js';
import {
  deserializeCredential,
  deserializeCredentialWithSecret,
  serializeCreateCredentialRequest,
  type CreateCredentialRequest,
  type Credential,
  type CredentialsListParams,
  type CredentialWire,
  type CredentialWithSecret,
  type CredentialWithSecretWire,
} from '../types/credential.js';

/** Path of the credentials collection. */
const CREDENTIALS_PATH = '/v3/auth/credentials';

/** Path of a single credential. */
function credentialPath(clientId: string): string {
  return `${CREDENTIALS_PATH}/${encodeURIComponent(clientId)}`;
}

/**
 * The credentials resource, composed onto `client.credentials` by `Dinie` (architecture §6).
 * Holds the injected {@link HttpClient}; the casing bridge is delegated to the generated
 * serializers (story 002). Methods are alphabetical.
 */
export class Credentials {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Create an API credential. `POST /v3/auth/credentials` (idempotent — the runtime mints a
   * stable `X-Idempotency-Key` reused across retries). The wire `201` response is the ONLY place
   * the `clientSecret` appears, so the result is a {@link CredentialWithSecret} (store the secret
   * securely — it cannot be retrieved again).
   */
  async create(
    params: CreateCredentialRequest,
    options?: RequestOptions,
  ): Promise<CredentialWithSecret> {
    const wire = await this.#http.request<CredentialWithSecretWire>({
      method: 'POST',
      path: CREDENTIALS_PATH,
      body: serializeCreateCredentialRequest(params),
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeCredentialWithSecret(wire);
  }

  /**
   * List API credentials, auto-paginated. Returns a {@link PagePromise} (D7/D15): `await` it for
   * the first {@link import('../../runtime/paginator.js').Page}, `for await` over it to stream
   * every credential across every page, or `.withResponse()` for the first page's HTTP response.
   * Each item is a {@link Credential} (no secret). `params.limit`/`startingAfter` and the
   * paginator cursor drive pagination (mapped to the wire `limit`/`starting_after` query params).
   */
  list(params?: CredentialsListParams, options?: RequestOptions): PagePromise<Credential> {
    const fetchPage: FetchPage<Credential> = (cursor) => {
      const startingAfter = cursor ?? params?.startingAfter;
      return this.#http
        .requestPage<CredentialWire>({
          method: 'GET',
          path: CREDENTIALS_PATH,
          query: {
            ...(params?.limit !== undefined ? { limit: params.limit } : {}),
            ...(startingAfter !== undefined ? { starting_after: startingAfter } : {}),
          },
          idempotent: false,
          ...(options !== undefined ? { options } : {}),
        })
        ._thenUnwrap(toCredentialPage);
    };
    return new PagePromise<Credential>(fetchPage);
  }

  /**
   * Revoke an API credential immediately and permanently. `DELETE
   * /v3/auth/credentials/{client_id}`. Returns `void` (the contract replies `204` with an empty
   * body). Revoking the last active credential fails `409` (`code: last_active_credential`),
   * surfaced as a `ConflictError` discriminable by `err.code`.
   */
  async revoke(clientId: string, options?: RequestOptions): Promise<void> {
    await this.#http.request<void>({
      method: 'DELETE',
      path: credentialPath(clientId),
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
  }
}

/** Map a wire list envelope to one of deserialized {@link Credential}s (preserving `has_more`). */
function toCredentialPage(wire: ListEnvelope<CredentialWire>): ListEnvelope<Credential> {
  return {
    object: 'list',
    data: wire.data.map(deserializeCredential),
    has_more: wire.has_more,
  };
}
