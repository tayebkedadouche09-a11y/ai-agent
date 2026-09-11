import OpenAI from 'openai';
import { config, hasOpenAI } from './config.js';
import { getOrders, getOrder } from './integrations/shopify.js';
import { getCJBalance, getCJOrderList } from './integrations/cj.js';
import { getState, log } from './state.js';

const client = () => new OpenAI({ apiKey: config.OPENAI_API_KEY });

const tools: any[] = [
  { type: 'function', name: 'shopify_recent_orders', description: 'Read recent Shopify orders.', parameters: { type: 'object', properties: { first: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false } },
  { type: 'function', name: 'shopify_order', description: 'Read one Shopify order by GraphQL ID.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { type: 'function', name: 'cj_balance', description: 'Read CJ account balance.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'cj_recent_orders', description: 'Read recent CJ orders.', parameters: { type: 'object', { }, additionalProperties: false } },
  { type: 'function', name: 'agent_state', description: 'Read agent mappings, approvals and recent logs.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
];

async function execute(name: string, args: any) {
  switch (name) {
    case 'shopify_recent_orders': return getOrders(args.first ?? 10);
    case 'shopify_order': return getOrder(args.id);
    case 'cj_balance': return getCJBalance();
    case 'cj_recent_orders': return getCJOrderList(args.page ?? 1, args.pageSize ?? 20);
    case 'agent_state': { const s = await getState(); return { mappings: s.mappings, pendingApprovals: s.pendingApprovals, logs: s.logs.slice(0, 30) }; }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

export async function askAgent(input: string) {
  if (!hasOpenAI()) return { text: 'OpenAI is not configured yet. Add OPENAI_API_KEY to .env.', configured: false };
  const api = client();
  const instructions = `You are the user's autonomous Shopify + CJ store manager. Be operational and concise. Never invent order, stock, cost, payment or tracking data. Use tools for live facts. Current mode: ${config.AGENT_MODE}. In approval mode, never claim a real CJ order was paid or submitted unless the API confirms it.`;
  let response = await api.responses.create({ model: config.OPENAI_MODEL, instructions, input, tools, store: false });

  for (let round = 0; round < 4; round++) {
    const calls = (response.output as any[]).filter(x => x.type === 'function_call');
    if (!calls.length) break;
    const outputs: any[] = [];
    for (const call of calls) {
      try {
        const args = JSON.parse(call.arguments ?? '{}');
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(await execute(call.name, args)) });
      } catch (error) {
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ error: String(error) }) });
      }
    }
    response = await api.responses.create({ model: config.OPENAI_MODEL, instructions, previous_response_id: response.id, input: outputs, tools, store: false });
  }

  const stillHasCalls = (response.output as any[]).some(x => x.type === 'function_call');
  if (stillHasCalls) await log('warn', 'agent.tool_round_limit', {});
  await log('info', 'agent.query', { inputLength: input.length });
  return { text: response.output_text, configured: true };
}
