# @dinie/sdk

SDK oficial TypeScript/JavaScript para a API V3 da Dinie.

> 🚧 Em desenvolvimento ativo (privado). Walking skeleton (V0.1) — superfície
> pública ainda **não congelada** (congela na V0.2).

**Backend-only.** O SDK lança erro se rodar no browser: o `clientSecret` do OAuth2
não pode existir no front-end. OAuth2 Client Credentials é **transparente** — o
parceiro nunca chama o endpoint de auth; o SDK obtém e renova o token sozinho.

- **Runtime:** Node.js ≥ 18, ESM.
- **Dependência de runtime:** apenas [`undici`](https://github.com/nodejs/undici).

## Instalação

```bash
npm install @dinie/sdk
```

## Quickstart (Customers)

```typescript
import { Dinie, Webhooks } from '@dinie/sdk';
import type { Customer } from '@dinie/sdk';

// OAuth2 transparente — o parceiro nunca chama /auth/token.
const client = new Dinie({
  clientId: process.env.DINIE_CLIENT_ID!,
  clientSecret: process.env.DINIE_CLIENT_SECRET!,
  baseUrl: 'https://staging.dinie.com.br',
});

// create + get
const customer = await client.customers.create({ taxId: '...', name: '...' });
const fetched = await client.customers.get(customer.id); // cus_...

// paginação automática via AsyncIterable
for await (const c of client.customers.list({ limit: 50 })) {
  console.log(c.id);
}

// verificação de webhook (module-function, não exige client OAuth)
const event = Webhooks.extract({
  headers: req.headers,
  body: req.rawBody, // raw, antes do JSON.parse
  secret: process.env.DINIE_WEBHOOK_SECRET!,
});
if (event.type === 'customer.created') {
  const created: Customer = event.data;
}
```

A V0.1 entrega `create` / `get` / `list` (paginado) em `Customers` e
`Webhooks.extract` tipado para `customer.created`. Os 16 endpoints e 14 webhook
events restantes chegam na V0.2.

**Erros:** o SDK lança uma hierarquia tipada rooted em `DinieError`. Ver
[`docs/errors.md`](./docs/errors.md) para os erros client-side (transporte, timeout,
webhook, OAuth) e o mapeamento das classes de resposta do servidor para o
[catálogo de erros](https://docs.dinie.com/errors/).

## Configuração

| Opção          | Default    | Env var               |
| -------------- | ---------- | --------------------- |
| `clientId`     | —          | `DINIE_CLIENT_ID`     |
| `clientSecret` | —          | `DINIE_CLIENT_SECRET` |
| `baseUrl`      | produção   | `DINIE_BASE_URL`      |
| `timeout`      | `30000` ms | —                     |
| `maxRetries`   | `3`        | —                     |
| `logLevel`     | `off`      | `DINIE_LOG`           |

## Desenvolvimento

```bash
npm install
npm run type-check   # tsc --noEmit (strict)
npm test             # Vitest — testes de runtime sem rede (mock undici)
npm run format:check # Prettier
```

O smoke E2E ao vivo (`npm run smoke`) está **adiado** e não é gate de CI: depende
das credenciais `sdk-smoke-test` da Dinie. Copie `.env.example` para `.env` para
habilitá-lo quando as credenciais existirem.

## Licença

[MIT](./LICENSE)
