# AI Store Agent

Private AI operations agent for one Shopify + CJdropshipping store.

## Current architecture

Shopify <-> Agent API <-> OpenAI

CJdropshipping is isolated behind `src/integrations/cj.ts` so the exact CJ API endpoints can be mapped to the user's active CJ API version/account without scattering provider-specific code through the agent.

## Safety

The default `AGENT_MODE=approval` is intentional. The agent must not place paid orders, issue refunds, or perform other irreversible actions until the user explicitly enables the relevant automation after verification.

## Local setup

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Add the user's OpenAI, Shopify, and CJ credentials locally. Never commit `.env`.
4. Run `npm install`.
5. Run `npm run dev`.
6. Check `GET /health`.
7. Test the agent with `POST /api/agent/run` and `{ "task": "Analyze my recent orders and tell me what needs attention." }`.

## Next implementation gates

- Shopify OAuth/webhook installation flow.
- Exact CJ API authentication and product/order/fulfillment endpoints for the user's CJ account.
- Persistent database for orders, mappings, tasks, audit logs, and approvals.
- Scheduled worker for order monitoring.
- Approval dashboard.
- Customer messaging integration.
- Production deployment and secret management.
- End-to-end tests using a test order before enabling autopilot.
