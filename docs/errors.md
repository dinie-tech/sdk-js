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
    WebhookTimestampError
```

- **`DinieError`** — raiz de toda exceção do SDK.
- **`APIError`** — base de tudo que se origina de uma requisição à API.
- **`APIStatusError`** — uma resposta não-2xx. Carrega `status`, `headers`, `body`,
  `request_id` (first-class, para suporte), e os campos RFC 9457 `type` / `title` /
  `detail` / `instance`. É a base que o catálogo server-response estende.

## Erros client-side

Os 5 erros abaixo **não têm resposta do servidor** — descrevem falhas locais do SDK.

| Erro                    | Estende              | Disparado quando                                                                                                      |
| ----------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `APIConnectionError`    | `APIError`           | A requisição nunca produziu resposta: falha de DNS, socket reset, ou cancelamento pelo caller.                        |
| `APITimeoutError`       | `APIConnectionError` | A requisição excedeu o `timeout` (default 30s) e o orçamento de retry se esgotou.                                     |
| `OAuthError`            | `DinieError`         | Aquisição/refresh do token OAuth2 client-credentials falhou.                                                          |
| `WebhookSignatureError` | `DinieError`         | Nenhuma assinatura no header bateu (payload adulterado), header obrigatório ausente, ou secret não fornecido.         |
| `WebhookTimestampError` | `DinieError`         | O `webhook-timestamp` está ausente, malformado, ou fora da janela de tolerância (velho **ou** futuro — replay guard). |

### Atributos

- `APIConnectionError` / `APITimeoutError`: `message`, `cause` (o erro de transporte
  subjacente, quando houver).
- `OAuthError` / `WebhookSignatureError` / `WebhookTimestampError`: `message`.

### Exemplo — chamadas de API

```typescript
import { APIConnectionError, APIStatusError, APITimeoutError, RateLimitError } from '@dinie/sdk';

try {
  await client.customers.create({ taxId, name });
} catch (err) {
  if (err instanceof APITimeoutError) {
    // Timeout (já houve backoff/retry) — trate como falha transitória.
  } else if (err instanceof APIConnectionError) {
    // Falha de transporte (DNS/socket) — sem resposta do servidor.
  } else if (err instanceof RateLimitError) {
    console.log('retry após', err.retryAfter, 'segundos');
  } else if (err instanceof APIStatusError) {
    // Qualquer erro de resposta do servidor (ver catálogo abaixo).
    console.error(err.status, err.type, err.request_id);
  }
}
```

### Exemplo — verificação de webhook

```typescript
import { Webhooks, WebhookSignatureError, WebhookTimestampError } from '@dinie/sdk';

try {
  const event = Webhooks.extract({ headers: req.headers, body: req.rawBody, secret });
  // ... processa o evento verificado
} catch (err) {
  if (err instanceof WebhookTimestampError) {
    // Timestamp fora da janela — possível replay ou clock skew.
  } else if (err instanceof WebhookSignatureError) {
    // Assinatura inválida — NUNCA processe o payload.
  }
}
```

## Erros de resposta do servidor

Quando a API responde com erro, o SDK despacha a resposta RFC 9457 para uma classe tipada
(via `APIError.fromResponse`, por `type` URL e, em fallback, por status). Todas estendem
`APIStatusError` e vivem em `src/generated/errors/` (espelho de `openapi.yaml`).

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

> **V0.1:** 503 dobra em `ServerError` (sem `ServiceUnavailableError`) e idempotency-key
> reuse dobra em `ValidationError` (sem classe separada). A confirmar no freeze da V0.2.
