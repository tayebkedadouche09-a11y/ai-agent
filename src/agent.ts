import OpenAI from 'openai';
import { config, hasOpenAI } from './config.js';
import { getOrders, getOrder, updateOrderNote } from './integrations/shopify.js';
import { getCJBalance, getCJOrderList } from './integrations/cj.js';
import { getState, log } from './state.js';

const client = () => new OpenAI({ apiKey: config.OPENAI_API_KEY });

const tools: any[] = [
  { type: 'function', name: 'shopify_recent_orders', description: 'Read recent Shopify orders.', parameters: { type: 'object', properties: { first: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false } },
  { type: 'function', name: 'shopify_order', description: 'Read one Shopify order by GraphQL ID.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { type: 'function', name: 'cj_balance', description: 'Read CJ account balance.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'cj_recent_orders', description: 'Read recent CJ orders.', parameters: { type: 'object', properties: { page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false } },
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
  const response = await client().responses.create({
    model: config.OPENAI_MODEL,
    instructions: `You are the user's autonomous Shopify + CJ store manager. Be operational and concise. Never invent order, stock, cost, payment or tracking data. Use tools for live facts. Current mode: ${config.AGENT_MODE}. In approval mode, never claim a real CJ order was paid or submitted unless the API confirms it.`,
    input,
    tools,
    store: false,
  });

  const calls = (response.output as any[]).filter(x => x.type === 'function_call');
  if (!calls.length) return { text: response.output_text, configured: true };

  const outputs: any[] = [];
  for (const call of calls) {
    try { outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(await execute(call.name, JSON.parse(call.arguments))) }); }
    catch (error) { outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ error: String(error) }) }); }
  }
  const final = await client().responses.create({ model: config.OPENAI_MODEL, instructions: 'Summarize the tool results accurately. Do not invent actions.', previous_response_id: response.id, input: outputs, store: false });
  await log('info', 'agent.query', { input });
  return { text: final.output_text, configured: true };
}
