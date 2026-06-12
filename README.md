# dinie-sdk

SDK oficial TypeScript/JavaScript para a **API V3 da Dinie** — crédito como serviço
(Crédito-as-a-Service) para parceiros. Uma superfície tipada sobre os 6 resources da
API (clientes, ofertas de crédito, empréstimos, bancos, credenciais e endpoints de
webhook), com OAuth2 transparente, retries idempotentes, paginação automática, erros
tipados (RFC 9457) e verificação de webhook — tudo em código que `tsc --noEmit` strict
aceita.

**Backend-only.** O SDK lança erro se rodar no browser: o `clientSecret` do OAuth2 não
pode existir no front-end. A autenticação OAuth2 Client Credentials é **transparente** —
o parceiro nunca chama o endpoint de auth; o SDK obtém e renova o token sozinho.

- **Runtime:** Node.js ≥ 18, ESM.
- **Dependência de runtime:** apenas [`undici`](https://github.com/nodejs/undici).

## Instalação

```bash
npm install dinie-sdk
```

## Configuração

Crie **uma** instância de `Dinie` por processo (ver [Auth](#autenticação-oauth2)) e reuse-a:

```typescript
import { Dinie } from 'dinie-sdk';

const dinie = new Dinie({
  clientId: process.env.DINIE_CLIENT_ID!,
  clientSecret: process.env.DINIE_CLIENT_SECRET!,
  // omita p/ usar produção; o sandbox carrega o mesmo prefixo de versão `/api/v3`:
  baseUrl: 'https://sandbox.api.dinie.com.br/api/v3',
});
```

> **A `baseUrl` carrega o prefixo de versão `/api/v3`** (o `servers` do openapi). Os paths dos
> resources são "bare" (`/customers`, `/loans/{id}`), então a versão vive na base — uma `baseUrl`
> custom **deve** incluir `/api/v3` (ex.: `https://sandbox.api.dinie.com.br/api/v3`).

Toda opção tem default; `clientId` e `clientSecret` são obrigatórios (via argumento **ou**
env var). As env vars são resolvidas quando o campo correspondente é omitido:

| Opção          | Default                           | Env var               | Descrição                                           |
| -------------- | --------------------------------- | --------------------- | --------------------------------------------------- |
| `clientId`     | —                                 | `DINIE_CLIENT_ID`     | Client id do OAuth2 (obrigatório).                  |
| `clientSecret` | —                                 | `DINIE_CLIENT_SECRET` | Client secret do OAuth2 (obrigatório).              |
| `baseUrl`      | `https://api.dinie.com.br/api/v3` | `DINIE_BASE_URL`      | URL base da API **incluindo** `/api/v3`.            |
| `timeout`      | `30000` (ms)                      | —                     | Timeout por requisição.                             |
| `maxRetries`   | `3`                               | —                     | Tentativas para erros retryable (`429`/`5xx`/rede). |
| `logLevel`     | `'off'`                           | `DINIE_LOG`           | `'off' \| 'error' \| 'warn' \| 'info' \| 'debug'`.  |
| `logger`       | console                           | —                     | Logger custom (ver [Logging](#logging)).            |
| `idempotency`  | `true`                            | —                     | Opt-out global de idempotency-key (foot-gun).       |
| `dispatcher`   | `undici.Pool`                     | —                     | Seam de transporte (injeção de `undici` em testes). |

O getter `client.rateLimit` (camelCase) expõe o último estado de rate-limit visto
(`{ limit, remaining, resetAt }`, ou `null` antes da primeira resposta) — populado dos
headers `X-RateLimit-*`.

## Autenticação (OAuth2)

O fluxo é **OAuth2 Client Credentials, transparente**. O parceiro **nunca** chama
`POST /auth/token`: na primeira requisição o SDK adquire um access token, o cacheia em
memória e o renova antes de expirar. Cada `new Dinie(...)` tem seu **próprio** cache de
token — por isso **reuse uma única instância por processo** (#11). Criar uma instância
nova por requisição força um novo handshake OAuth a cada chamada.

> Em caso de falha na aquisição/refresh do token, o SDK lança `OAuthError`.

## Quickstart — Customer → Offer → Loan

O fluxo central da metodologia (arquitetura §15.2). A oferta de crédito **não** é criada
pelo parceiro: ela é emitida pelo Core da Dinie e chega via webhook `credit_offer.available`.

```typescript
import { Dinie, Webhooks } from 'dinie-sdk';

const dinie = new Dinie({
  clientId: process.env.DINIE_CLIENT_ID!,
  clientSecret: process.env.DINIE_CLIENT_SECRET!,
  baseUrl: process.env.DINIE_BASE_URL ?? 'https://sandbox.api.dinie.com.br/api/v3',
});

// 1) Cria o cliente — cpf + cnpj + email + phone (sem `taxId`; o id retornado é `cust_…`).
const customer = await dinie.customers.create({
  cpf: '123.456.789-09',
  cnpj: '12.345.678/0001-95',
  email: 'contato@empresa.com.br',
  phone: '+5511999998888',
});

// 2) Após o KYC, o Core emite a oferta. Ela chega via webhook (NÃO há creditOffers.create):
//    o parceiro recebe `credit_offer.available` e extrai o id da oferta de `event.data`.
//    (ver a seção Webhooks abaixo para o handler completo de `Webhooks.extract`.)
//    Suponha que o handler tenha guardado `offerId` (event.data.id, prefixo `co_…`):
const offerId = '<co_… vindo do webhook credit_offer.available>';

// 3) Busca a oferta e simula.
const offer = await dinie.creditOffers.retrieve(offerId);
const sim = await dinie.creditOffers.createSimulation(offer.id, {
  requestedAmount: 500000, // BRL
  installmentCount: 12,
});

// 4) Cria o empréstimo — 5 campos vindos da oferta + da simulação aceita.
const loan = await dinie.loans.create({
  creditOfferId: offer.id,
  simulationId: sim.id,
  installmentCount: sim.installmentCount,
  installmentAmount: sim.installmentAmount,
  firstDueDate: sim.firstDueDate, // string ISO `date` (`'2026-04-03'`), não epoch
});

// 5) Acompanha o empréstimo (status: awaiting_signatures → processing → active).
const current = await dinie.loans.retrieve(loan.id);
console.log(current.status, current.signingUrl);
```

> **Por que não `creditOffers.create`?** O contrato (`openapi.yaml`, fonte da verdade) não
> tem `POST /credit-offers` — ofertas nascem no Core. O "Demo" do version spec mostrava
> `creditOffers.create({ customerId })` e `customers.create({ taxId })`; ambos são
> ilustrativos e **não** batem com o contrato. A superfície congelada segue o openapi
> (arquitetura §4, R1/R10).

## Webhooks

`Webhooks.extract` é uma module-function (não exige client OAuth): ela verifica a
assinatura (Standard Webhooks v1 — HMAC-SHA256 em tempo constante, multi-assinatura para
rotação, janela de timestamp bidirecional) **e** desserializa o corpo para o membro
tipado da união `WebhookEvent`. Passe o corpo **cru** (antes de `JSON.parse`).

```typescript
import { Webhooks } from 'dinie-sdk';
import type { WebhookEvent } from 'dinie-sdk';

function handleDinieWebhook(req: {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
}): void {
  const event: WebhookEvent = Webhooks.extract({
    headers: req.headers,
    body: req.rawBody, // cru, exatamente como recebido
    secret: process.env.DINIE_WEBHOOK_SECRET!, // `whsec_…`; aceita também uma lista (rotação)
  });

  // `event.type` discrimina os 15 events; `event.data` é estreitado por tipo.
  switch (event.type) {
    case 'customer.created':
      // event.data: CustomerCreatedData (subset bespoke — NÃO o read-model Customer)
      console.log('cliente criado', event.data.id, event.data.status);
      break;

    case 'credit_offer.available':
      // event.data: CreditOfferEventData — guarde event.data.id (co_…) p/ o fluxo do Quickstart
      console.log('oferta disponível', event.data.id, event.data.customerId);
      break;

    case 'loan.payment_received':
      // event.data.payment é um objeto INLINE { amount, paidAt, installmentNumber }
      console.log('parcela paga', event.data.payment.installmentNumber, event.data.payment.amount);
      break;

    default:
      // os demais 12 events (customer.active, loan.active, loan.finished, …)
      break;
  }
}
```

> **`event.data` é um payload bespoke por evento**, não o resource completo. Ex.:
> `credit_offer.available` carrega `CreditOfferEventData` (sem `createdAt`/`updatedAt`), não
> um `CreditOffer`; `loan.payment_received` traz `data.payment` inline, não um `Transaction`.
> As chaves são camelCase honesto (o wire snake_case é desserializado por tipo).

Falhas de verificação são tipadas: `WebhookSignatureError` (nenhuma assinatura bateu /
header ausente / secret faltando), `WebhookTimestampError` (timestamp fora da janela —
guard de replay) e `UnknownWebhookEventError` (assinatura válida, mas o `type` não está no
catálogo — força a conversa de contrato em vez de devolver um blob não-tipado).

## Tratamento de erros

Toda resposta de erro do servidor vira uma classe tipada que estende `APIStatusError`
(despachada por `type` URL RFC 9457, com fallback por status). Discrimine com `instanceof`:

```typescript
import { Dinie, NotFoundError, ValidationError, RateLimitError, parseRetryAfter } from 'dinie-sdk';

try {
  await dinie.loans.retrieve('ln_inexistente');
} catch (err) {
  if (err instanceof NotFoundError) {
    console.error('não encontrado', err.status, err.code, err.request_id);
  } else if (err instanceof ValidationError) {
    console.error('inválido', err.code, err.detail); // err.code: ex. 'missing_required_field'
  } else if (err instanceof RateLimitError) {
    // O loop de retry interno já respeitou o Retry-After (capado em ≤60s).
    // Para lógica custom pós-catch, parseie o header (aceita string | string[]):
    const waitMs = parseRetryAfter(err.headers['retry-after']);
    console.warn('rate limited — esperar', waitMs, 'ms');
  }
}
```

Todo `APIStatusError` carrega `status`, `code` (extensão `code` do catálogo), `type` /
`title` / `detail` / `instance` (RFC 9457), `headers` e `request_id` (first-class, para
suporte). As 8 classes de catálogo (`BadRequestError`, `AuthError`, `PermissionError`,
`NotFoundError`, `ConflictError`, `ValidationError`, `RateLimitError`, `ServerError`) são
**typed markers minimais** — os detalhes vivem nesses atributos da base. Erros sem resposta
do servidor (transporte, timeout, OAuth, webhook) são client-side. Catálogo completo e
exemplos em [`docs/errors.md`](./docs/errors.md).

## Paginação

Métodos `list*` cujo envelope tem `has_more` retornam um `PagePromise<T>` auto-paginado.
Itere com `for await` (o cursor `starting_after` é gerenciado pelo SDK; o fim é `has_more`,
nunca `data.length === limit`):

```typescript
for await (const customer of dinie.customers.list({ limit: 50 })) {
  console.log(customer.id);
}
```

Sub-recursos que são **coleções** (0..N por pai) vivem em **namespaces aninhados** — o id do
pai é o primeiro argumento (mesmo padrão de `client.beta.threads.messages` da OpenAI):

```typescript
// ofertas de crédito de um cliente (coleção → namespace aninhado)
for await (const offer of dinie.customers.creditOffers.list(customerId, { limit: 50 })) {
  console.log(offer.id);
}
// transações de um empréstimo
for await (const tx of dinie.loans.transactions.list(loanId)) {
  console.log(tx.id, tx.status);
}
```

Sub-recursos **singleton** (≤1 por pai — `bank-account`, `biometrics`) permanecem métodos
planos no pai: `dinie.customers.retrieveBankAccount(customerId)`.

`await` num `PagePromise` devolve a **primeira** página (`Page<T>`); `.withResponse()`
expõe a resposta HTTP. Recursos sem `has_more` no contrato — como `/banks` — retornam uma
lista plana (`Promise<Bank[]>`), não um paginador:

```typescript
const banks = await dinie.banks.list(); // Bank[] — diretório fixo, uma chamada só
```

## Idempotência

Toda escrita **POST/PATCH** recebe automaticamente um header `X-Idempotency-Key`
(`dinie-sdk-retry-<uuid v4>`), **estável através dos retries** — torna seguro retentar uma
criação após um `500`/timeout. `GET` e `DELETE` não enviam key (`DELETE` é idempotente por
semântica HTTP).

- **Override por chamada:** `await dinie.customers.create(params, { idempotencyKey: 'sua-key' })`.
- **Opt-out global:** `new Dinie({ ..., idempotency: false })` (foot-gun em fintech —
  documentado; o override por chamada ainda vence o opt-out).

## Logging

Logging é opt-in. Ligue com `logLevel: 'debug'` (ou env `DINIE_LOG=debug`) para ver a
request line, o status e o `request_id` de cada chamada:

```typescript
const dinie = new Dinie({ clientId, clientSecret, baseUrl, logLevel: 'debug' });
```

O logger **redige PII e segredos** por nome de campo, recursivamente. Headers redatados:
`authorization`, `webhook-signature`, `x-dinie-client-secret`, `proxy-authorization`.
Campos de corpo redatados: `cpf`, `cnpj`, `account`, `cvv`, `password`, `secret`,
`client_secret`, `access_token`, `phone`. Bodies grandes são truncados. Default `'off'` não
loga nada. Injete um `logger` custom (`{ debug, info, warn, error }`) para integrar ao seu
stack de observabilidade.

## Cancelamento

Todo método aceita `options.signal` (um `AbortSignal`) como último argumento, encadeado com
o timeout interno:

```typescript
const controller = new AbortController();
const promise = dinie.customers.list({ limit: 100 }, { signal: controller.signal });
controller.abort(); // cancela a requisição em voo
```

`options.timeout` e `options.maxRetries` também podem ser sobrescritos por chamada.

## Referências

- [`docs/errors.md`](./docs/errors.md) — catálogo completo de erros (client-side +
  resposta do servidor) e exemplos.
- **`specs/api-surface/principles.md`** (repo de specs) — as _determinism shapes_: as
  regras que tornam esta superfície reproduzível por um gerador (insumo da V0.4).
- **Contrato (fonte da verdade):** `api-docs/apis/openapi.yaml` — todo nome, tipo e shape
  deste SDK deriva do OpenAPI; onde este README e o contrato divergirem, o contrato vence.

## Desenvolvimento

```bash
npm install
npm run type-check   # tsc --noEmit (strict)
npm test             # Vitest — sem rede (undici mockado + conformance contra examples)
npm run format:check # Prettier
```

O smoke E2E ao vivo (`npm run smoke`) está **adiado** e não é gate de CI: depende das
credenciais `sdk-smoke-test` da Dinie.

## Licença

[MIT](./LICENSE)
