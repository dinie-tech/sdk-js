# Erros do SDK

Todo erro lançado pelo SDK desce de `DinieError`. Há duas famílias:

- **Erros client-side** — originados no próprio SDK (transporte, timeout, fluxo OAuth,
  verificação de webhook). **Não há resposta do servidor para descrever**, então vivem em
  `src/runtime/` e são documentados **aqui**.
- **Erros de resposta do servidor** — a API respondeu com um status de erro (4xx/5xx) em
  formato RFC 9457. O catálogo é definido em [`openapi.yaml`](https://docs.dinie.com/errors/)
  (a fonte da verdade) e documentado em `dinie-tech/api-docs` — **este doc não os
  duplica**. Ver [Erros de resposta do servidor](#erros-de-resposta-do-servidor) abaixo.

## Hierarquia base

```
DinieError (extends Error)
├── APIError                      — algo deu errado ao falar com a API
│   ├── APIConnectionError        — client-side (sem resposta)
│   │   └── APITimeoutError
│   └── APIStatusError            — a API respondeu não-2xx (catálogo server-response)
└── OAuthError                    — client-side (fluxo OAuth)
    WebhookSignatureError         — client-side (verificação de webhook)
    WebhookTimestampError         — client-side (verificação de webhook)
    UnknownWebhookEventError      — client-side (evento verificado, `type` fora do catálogo)
```

- **`DinieError`** — raiz de toda exceção do SDK.
- **`APIError`** — base de tudo que se origina de uma requisição à API.
- **`APIStatusError`** — uma resposta não-2xx. Carrega `status`, `headers`, `body`,
  `request_id` (first-class, para suporte), e os campos RFC 9457 `type` / `title` /
  `detail` / `instance`. É a base que o catálogo server-response estende.

## Erros client-side

Os 6 erros abaixo **não têm resposta do servidor** — descrevem falhas locais do SDK.

| Erro                       | Estende              | Disparado quando                                                                                                      |
| -------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `APIConnectionError`       | `APIError`           | A requisição nunca produziu resposta: falha de DNS, socket reset, ou cancelamento pelo caller.                        |
| `APITimeoutError`          | `APIConnectionError` | A requisição excedeu o `timeout` (default 30s) e o orçamento de retry se esgotou.                                     |
| `OAuthError`               | `DinieError`         | Aquisição/refresh do token OAuth2 client-credentials falhou.                                                          |
| `WebhookSignatureError`    | `DinieError`         | Nenhuma assinatura no header bateu (payload adulterado), header obrigatório ausente, ou secret não fornecido.         |
| `WebhookTimestampError`    | `DinieError`         | O `webhook-timestamp` está ausente, malformado, ou fora da janela de tolerância (velho **ou** futuro — replay guard). |
| `UnknownWebhookEventError` | `DinieError`         | A assinatura do webhook **verificou**, mas o `type` do payload não está no catálogo do openapi (`generated/events`).  |

### Atributos

- `APIConnectionError` / `APITimeoutError`: `message`, `cause` (o erro de transporte
  subjacente, quando houver).
- `OAuthError` / `WebhookSignatureError` / `WebhookTimestampError`: `message`.
- `UnknownWebhookEventError`: `message` + `eventType` (o `type` desconhecido, preservado do
  payload verificado). **Lançar** — em vez de devolver um evento não-tipado — é deliberado:
  um `type` novo é uma mudança de contrato, e o erro força a atualização do SDK a partir do
  openapi antes de processar o payload (story 007 / OQ#2).

### Exemplo — chamadas de API

```typescript
import {
  APIConnectionError,
  APIStatusError,
  APITimeoutError,
  parseRetryAfter,
  RateLimitError,
} from '@dinie/sdk';

try {
  await client.customers.create({ cpf, cnpj, email, phone });
} catch (err) {
  if (err instanceof APITimeoutError) {
    // Timeout (já houve backoff/retry) — trate como falha transitória.
  } else if (err instanceof APIConnectionError) {
    // Falha de transporte (DNS/socket) — sem resposta do servidor.
  } else if (err instanceof RateLimitError) {
    // O cliente já respeitou o Retry-After no loop de retry; para lógica custom:
    const waitMs = parseRetryAfter(err.headers['retry-after']); // ms ou null
    console.log('rate limited — esperar', waitMs, 'ms');
  } else if (err instanceof APIStatusError) {
    // Qualquer erro de resposta do servidor (ver catálogo abaixo).
    console.error(err.status, err.code, err.type, err.request_id);
  }
}
```

### Esperando o `Retry-After`

`RateLimitError` é um typed marker minimal — **não** expõe getter próprio de `Retry-After`. O
cliente já respeita o header `Retry-After` automaticamente no loop de retry interno (capado em
≤60s). Quando você quer programar lógica custom **depois** de capturar a exceção (avisar o
usuário, agendar seu próprio backoff), use o helper público `parseRetryAfter`:

```typescript
import { parseRetryAfter, RateLimitError } from '@dinie/sdk';

try {
  await client.customers.create({ cpf, cnpj, email, phone });
} catch (err) {
  if (err instanceof RateLimitError) {
    const waitMs = parseRetryAfter(err.headers['retry-after']); // ms, ou null se ausente
    if (waitMs !== null) {
      console.log(`rate limited — tentar de novo em ${waitMs}ms`);
    }
  }
}
```

`parseRetryAfter(retryAfter?: string | string[]): number | null` aceita as duas formas do
RFC 7231 (delta-seconds ou HTTP-date) e retorna milissegundos (ou `null` quando
ausente/inválido). A assinatura aceita `string | string[]` (D11): `err.headers['retry-after']`
tem tipo `string | string[] | undefined`, então o exemplo acima **type-checa em strict sem
cast** (um header repetido usa o primeiro valor).

### Exemplo — verificação de webhook

```typescript
import {
  Webhooks,
  WebhookSignatureError,
  WebhookTimestampError,
  UnknownWebhookEventError,
} from '@dinie/sdk';

try {
  const event = Webhooks.extract({ headers: req.headers, body: req.rawBody, secret });
  // ... processa o evento verificado
} catch (err) {
  if (err instanceof WebhookTimestampError) {
    // Timestamp fora da janela — possível replay ou clock skew.
  } else if (err instanceof WebhookSignatureError) {
    // Assinatura inválida — NUNCA processe o payload.
  } else if (err instanceof UnknownWebhookEventError) {
    // Assinatura OK, mas `type` fora do catálogo (err.eventType) — atualize o SDK do contrato.
  }
}
```

## Erros de resposta do servidor

Quando a API responde com erro, o SDK despacha a resposta RFC 9457 para uma classe tipada
(via `APIError.fromResponse`, por `type` URL e, em fallback, por status). Todas estendem
`APIStatusError` e vivem em `src/generated/errors/` (espelho de `openapi.yaml`).

As classes em `generated/errors/` são **typed markers minimais** — para os detalhes do erro,
acesse `.status`, `.body`, `.headers`, `.code`, `.request_id` (todos na base `APIStatusError`).
Parsing de header (ex.: `Retry-After`) vive em helpers do runtime (`parseRetryAfter`), não na
classe de erro.

| Status    | Classe (`@dinie/sdk`) | `type` URL (catálogo)                                                                  |
| --------- | --------------------- | -------------------------------------------------------------------------------------- |
| 400       | `BadRequestError`     | [`/errors/invalid-request`](https://docs.dinie.com/errors/invalid-request)             |
| 401       | `AuthError`           | [`/errors/authentication-failed`](https://docs.dinie.com/errors/authentication-failed) |
| 403       | `PermissionError`     | [`/errors/forbidden`](https://docs.dinie.com/errors/forbidden)                         |
| 404       | `NotFoundError`       | [`/errors/not-found`](https://docs.dinie.com/errors/not-found)                         |
| 409       | `ConflictError`       | [`/errors/conflict`](https://docs.dinie.com/errors/conflict)                           |
| 422       | `ValidationError`     | [`/errors/validation-failed`](https://docs.dinie.com/errors/validation-failed)         |
| 429       | `RateLimitError`      | [`/errors/rate-limit-exceeded`](https://docs.dinie.com/errors/rate-limit-exceeded)     |
| 500 / 503 | `ServerError`         | [`/errors/internal`](https://docs.dinie.com/errors/internal)                           |

A descrição de cada erro (causas, códigos, remediação) está no catálogo —
**[https://docs.dinie.com/errors/](https://docs.dinie.com/errors/)** e em `dinie-tech/api-docs`.
Este doc não a duplica.

> **V0.2 (freeze confirmado):** `503` dobra em `ServerError` (vacuamente — o contrato não tem
> `503`; o fallback `status ≥ 500 → ServerError` cobre `502`/`504` e qualquer `503` futuro).
> `410 Gone` (sem `type` URL) cai num `APIStatusError` genérico com `code`/`request_id` — sem
> classe nova. Idempotency-key reuse não tem classe dedicada; o servidor escolhe o status
> (`409`/`422`) e o parceiro discrimina por `err.code`.
>
> **Idempotência:** todo request non-GET envia o header **`X-Idempotency-Key`** (auto
> `dinie-sdk-retry-<uuid>`, estável entre retries — R4/D9). Override por chamada via
> `options.idempotencyKey`; opt-out global via `new Dinie({ idempotency: false })` (foot-gun
> documentado). O log redige `access_token`/`phone` além de `cpf`/`cnpj`/`secret`/… (§5.4).
