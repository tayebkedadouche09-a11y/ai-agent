import OpenAI from 'openai';
import { config, isConfigured } from './config.js';
import { getShopifyOrders, getShopifyProducts } from './integrations/shopify.js';
import { cjHealthCheck } from './integrations/cj.js';

const openai = config.OPENAI_API_KEY ? new OpenAI({ apiKey: config.OPENAI_API_KEY }) : null;

export async function runAgentTask(task: string) {
  if (!openai) throw new Error('OPENAI_API_KEY is not configured');

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
      type: 'function',
      function: {
        name: 'get_shopify_orders',
        description: 'Read recent Shopify orders.',
        parameters: { type: 'object', properties: { limit: { type: 'number' } } }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_shopify_products',
        description: 'Read Shopify products and inventory information.',
        parameters: { type: 'object', properties: { limit: { type: 'number' } } }
      }
    },
    {
      type: 'function',
      function: {
        name: 'cj_health_check',
        description: 'Check that the CJ integration is configured.',
        parameters: { type: 'object', properties: {} }
      }
    }
  ];

  let messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are the user's private Shopify + CJ store operations agent. Mode: ${config.AGENT_MODE}. Never invent order, inventory, customer, or CJ data. In approval mode, prepare actions but never claim an external action was completed unless a tool actually completed it. Configured integrations: ${JSON.stringify(isConfigured)}.`
    },
    { role: 'user', content: task }
  ];

  for (let round = 0; round < 5; round++) {
    const response = await openai.chat.completions.create({
      model: config.OPENAI_MODEL,
      messages,
      tools,
      tool_choice: 'auto'
    });
    const message = response.choices[0]?.message;
    if (!message) throw new Error('The AI returned no message');
    messages.push(message);

    if (!message.tool_calls?.length) return message.content ?? '';

    for (const call of message.tool_calls) {
      let result: unknown;
      const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      if (call.function.name === 'get_shopify_orders') result = await getShopifyOrders(args.limit ?? 20);
      else if (call.function.name === 'get_shopify_products') result = await getShopifyProducts(args.limit ?? 50);
      else if (call.function.name === 'cj_health_check') result = await cjHealthCheck();
      else result = { error: `Unknown tool: ${call.function.name}` };
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  throw new Error('Agent exceeded its tool-call limit');
}
