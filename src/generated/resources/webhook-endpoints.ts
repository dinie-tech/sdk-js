/**
 * `WebhookEndpoints` resource — REST management of webhook endpoints (architecture §3.1, §6,
 * §7.1). Hand-authored in V0.2 to mirror future generator output (D1); V0.4 overwrites it. A
 * mechanical copy of the `customers.ts` convention (story 003): inject the {@link HttpClient},
 * delegate the camelCase ↔ snake_case bridge to the per-type generated serializers, methods
 * alphabetical.
 *
 * ── NOT the webhook RUNTIME (§3.1 note) ──
 * This is the MANAGEMENT surface (`client.webhookEndpoints`) — create/configure/delete the
 * endpoints Dinie delivers events to. It is DISTINCT from event RECEPTION: verifying + parsing a
 * delivered event is `Webhooks.extract` (runtime, story 007). This resource never touches the
 * `WebhookEvent` union.
 *
 * ── The 6 methods (alphabetical — minimal diff for the V0.4 generator) ──
 *   create        POST     /v3/webhooks/endpoints                  → WebhookEndpointWithSecret (201, idempotent)
 *   delete        DELETE   /v3/webhooks/endpoints/{id}             → void (204)
 *   get           GET      /v3/webhooks/endpoints/{id}             → WebhookEndpoint
 *   list          GET      /v3/webhooks/endpoints                  → PagePromise<WebhookEndpoint>
 *   rotateSecret  POST     /v3/webhooks/endpoints/{id}/rotate-secret → WebhookSecretRotation (idempotent)
 *   update        PATCH    /v3/webhooks/endpoints/{id}             → WebhookEndpoint (idempotent)
 *
 * ── Method naming (§7.1 — strip the resource noun) ──
 *   createWebhookEndpoint → create   getWebhookEndpoint → get   listWebhookEndpoints → list
 *   updateWebhookEndpoint → update   deleteWebhookEndpoint → delete
 *   rotateWebhookSecret   → rotateSecret   (strip `Webhook`)
 *
 * ── Sub-path (D3): the parent id is the 1st positional arg ──
 * `POST /webhooks/endpoints/{id}/rotate-secret` becomes `rotateSecret(id, params?, opts?)` — the
 * `{webhook_endpoint_id}` segment is the leading `id`, `encodeURIComponent`-escaped.
 *
 * ── Secret-bearing responses (§3.1) ──
 * `create` → {@link WebhookEndpointWithSecret} and `rotateSecret` → {@link WebhookSecretRotation}
 * are the ONLY responses carrying the HMAC `secret` (shown once). `list`/`get`/`update` return
 * plain {@link WebhookEndpoint}s (no secret). The runtime logger redacts `secret` (story 001).
 *
 * ── Idempotency (§7.4 / §3.1) ──
 * `create`/`update`/`rotateSecret` (POST/PATCH writes) pass `idempotent: true` → the runtime
 * mints a stable `X-Idempotency-Key` reused across retries (even `update`/`rotateSecret`, whose
 * openapi ops omit the `IdempotencyKey` parameter — §7.4 derives idempotency from the HTTP
 * method, not the annotation). `delete` is a DELETE: naturally idempotent server-side, marked "—"
 * in the §3.1 idempotency column, so `idempotent: false` (no key). `get`/`list` are GETs.
 *
 * ── runtime ↔ generated boundary ──
 * Lives in `generated/`. Imports ONLY from `runtime/` (`HttpClient`, `RequestOptions`,
 * `PagePromise`/`FetchPage`, `ListEnvelope`) plus sibling generated types — never the reverse.
 * The `HttpClient` is injected by `client.ts`; this class never builds one.
 */

import type { HttpClient, ListEnvelope, RequestOptions } from '../../runtime/http.js';
import { PagePromise, type FetchPage } from '../../runtime/paginator.js';
import {
  deserializeWebhookEndpoint,
  deserializeWebhookEndpointWithSecret,
  deserializeWebhookSecretRotation,
  serializeCreateWebhookEndpointRequest,
  serializeRotateWebhookSecretParams,
  serializeUpdateWebhookEndpointRequest,
  type CreateWebhookEndpointRequest,
  type RotateWebhookSecretParams,
  type UpdateWebhookEndpointRequest,
  type WebhookEndpoint,
  type WebhookEndpointsListParams,
  type WebhookEndpointWire,
  type WebhookEndpointWithSecret,
  type WebhookEndpointWithSecretWire,
  type WebhookSecretRotation,
  type WebhookSecretRotationWire,
} from '../types/webhook-endpoint.js';

/** Path of the webhook-endpoints collection. */
const WEBHOOK_ENDPOINTS_PATH = '/v3/webhooks/endpoints';

/** Path of a single webhook endpoint (sub-paths hang off this). */
function webhookEndpointPath(id: string): string {
  return `${WEBHOOK_ENDPOINTS_PATH}/${encodeURIComponent(id)}`;
}

/**
 * The webhook-endpoints resource, composed onto `client.webhookEndpoints` by `Dinie`
 * (architecture §6). Holds the injected {@link HttpClient}; the casing bridge is delegated to the
 * generated serializers (story 002). Methods are alphabetical.
 */
export class WebhookEndpoints {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Create a webhook endpoint. `POST /v3/webhooks/endpoints` (idempotent). The wire `201`
   * response is the ONLY place the signing `secret` appears, so the result is a
   * {@link WebhookEndpointWithSecret} (store the secret securely — it cannot be retrieved again).
   */
  async create(
    params: CreateWebhookEndpointRequest,
    options?: RequestOptions,
  ): Promise<WebhookEndpointWithSecret> {
    const wire = await this.#http.request<WebhookEndpointWithSecretWire>({
      method: 'POST',
      path: WEBHOOK_ENDPOINTS_PATH,
      body: serializeCreateWebhookEndpointRequest(params),
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeWebhookEndpointWithSecret(wire);
  }

  /**
   * Delete a webhook endpoint and stop all deliveries. `DELETE /v3/webhooks/endpoints/{id}`.
   * Returns `void` (the contract replies `204` with an empty body).
   */
  async delete(id: string, options?: RequestOptions): Promise<void> {
    await this.#http.request<void>({
      method: 'DELETE',
      path: webhookEndpointPath(id),
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
  }

  /** Retrieve a webhook endpoint by id. `GET /v3/webhooks/endpoints/{id}`. */
  async get(id: string, options?: RequestOptions): Promise<WebhookEndpoint> {
    const wire = await this.#http.request<WebhookEndpointWire>({
      method: 'GET',
      path: webhookEndpointPath(id),
      idempotent: false,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeWebhookEndpoint(wire);
  }

  /**
   * List webhook endpoints, auto-paginated. Returns a {@link PagePromise} (D7/D15): `await` it for
   * the first {@link import('../../runtime/paginator.js').Page}, `for await` over it to stream
   * every endpoint across every page, or `.withResponse()` for the first page's HTTP response.
   * `params.limit`/`startingAfter` and the paginator cursor drive pagination (mapped to the wire
   * `limit`/`starting_after` query params).
   */
  list(
    params?: WebhookEndpointsListParams,
    options?: RequestOptions,
  ): PagePromise<WebhookEndpoint> {
    const fetchPage: FetchPage<WebhookEndpoint> = (cursor) => {
      const startingAfter = cursor ?? params?.startingAfter;
      return this.#http
        .requestPage<WebhookEndpointWire>({
          method: 'GET',
          path: WEBHOOK_ENDPOINTS_PATH,
          query: {
            ...(params?.limit !== undefined ? { limit: params.limit } : {}),
            ...(startingAfter !== undefined ? { starting_after: startingAfter } : {}),
          },
          idempotent: false,
          ...(options !== undefined ? { options } : {}),
        })
        ._thenUnwrap(toWebhookEndpointPage);
    };
    return new PagePromise<WebhookEndpoint>(fetchPage);
  }

  /**
   * Rotate the HMAC signing secret. `POST /v3/webhooks/endpoints/{id}/rotate-secret` (idempotent).
   * The previous secret stays valid for a grace period — `params.expireCurrentIn` (seconds, see
   * {@link RotateWebhookSecretParams}) overrides the server default; omit `params` to take the
   * default. The result is a {@link WebhookSecretRotation} carrying the new secret (shown once)
   * and the old secret's expiry.
   */
  async rotateSecret(
    id: string,
    params?: RotateWebhookSecretParams,
    options?: RequestOptions,
  ): Promise<WebhookSecretRotation> {
    const wire = await this.#http.request<WebhookSecretRotationWire>({
      method: 'POST',
      path: `${webhookEndpointPath(id)}/rotate-secret`,
      body: serializeRotateWebhookSecretParams(params ?? {}),
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeWebhookSecretRotation(wire);
  }

  /**
   * Update a webhook endpoint's URL, events, description, or status. `PATCH
   * /v3/webhooks/endpoints/{id}` (idempotent). Only the keys the caller set are sent (PATCH
   * semantics); the wire response is the full updated {@link WebhookEndpoint}.
   */
  async update(
    id: string,
    params: UpdateWebhookEndpointRequest,
    options?: RequestOptions,
  ): Promise<WebhookEndpoint> {
    const wire = await this.#http.request<WebhookEndpointWire>({
      method: 'PATCH',
      path: webhookEndpointPath(id),
      body: serializeUpdateWebhookEndpointRequest(params),
      idempotent: true,
      ...(options !== undefined ? { options } : {}),
    });
    return deserializeWebhookEndpoint(wire);
  }
}

/** Map a wire list envelope to one of deserialized {@link WebhookEndpoint}s (preserving `has_more`). */
function toWebhookEndpointPage(
  wire: ListEnvelope<WebhookEndpointWire>,
): ListEnvelope<WebhookEndpoint> {
  return {
    object: 'list',
    data: wire.data.map(deserializeWebhookEndpoint),
    has_more: wire.has_more,
  };
}
