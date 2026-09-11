# AI Store Manager

Personal autonomous operations agent for a Shopify store connected to CJdropshipping.

## What it does

- Shopify Admin GraphQL integration
- Shopify order webhooks
- CJ API v2 integration
- Shopify -> CJ order workflow
- CJ tracking webhook -> Shopify fulfillment sync
- OpenAI Responses API agent with live Shopify/CJ tools
- Approval mode and autopilot mode
- Persistent local state and audit logs
- Browser dashboard at `/`
- Health/integration status endpoint
- Automated TypeScript CI

## Architecture

`Customer -> Shopify -> Webhook -> AI Store Manager -> CJdropshipping -> Tracking -> Shopify`

The AI is the decision layer. Deterministic code remains responsible for credentials, API calls, validation, idempotency and safety boundaries.

## Required configuration

Copy `.env.example` to `.env` and set:

- `OPENAI_API_KEY`
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_ACCESS_TOKEN`
- `CJ_ACCESS_TOKEN`
- `CJ_PLATFORM_TOKEN` when required by the CJ account
- `CJ_OPEN_ID` for verifying CJ webhook signatures
- `CJ_LOGISTIC_NAME` to the exact logistics name accepted by CJ for your workflow
- `CJ_FROM_COUNTRY_CODE`

Start with `AGENT_MODE=approval`. After testing, change to `autopilot` only when the CJ account, balance, product connections and logistics are verified.

## Run

```bash
npm install
npm run typecheck
npm start
```

Open `http://localhost:3000`.

## Shopify

The integration uses the Admin GraphQL API, not the legacy REST Admin API. Shopify's current documentation recommends GraphQL for new apps. Webhooks can be registered with `webhookSubscriptionCreate` for `ORDERS_CREATE` and `ORDERS_UPDATED`.

For production, expose `/webhooks/shopify/orders-create` through a public HTTPS deployment and configure the Shopify webhook secret if available.

## CJ

CJ API v2 is used for order creation, order queries, balance, logistics and webhook-driven tracking. CJ webhook signatures are HMAC-SHA256/Base64 using the account `openId` as the secret.

The order flow intentionally uses `payType=2` only when autopilot/approval execution is explicitly enabled, meaning the CJ balance can be charged. Never enable autopilot without testing with a low-risk order.

## Important safety behavior

1. Unpaid Shopify orders are not sent to CJ.
2. Duplicate Shopify webhook events are idempotent.
3. Missing shipping data stops processing.
4. Missing CJ logistics configuration stops automatic submission.
5. Approval mode queues the order instead of submitting it.
6. Every significant action is written to the audit log.
7. API credentials are environment variables and are never committed.

## Production deployment

Use a persistent HTTPS Node host for this personal agent. The service needs inbound webhooks and persistent state. Vercel/serverless can be used only after replacing the local JSON state with a persistent database and adapting webhook execution.
