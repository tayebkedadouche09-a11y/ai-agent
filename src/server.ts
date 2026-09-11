import express from 'express';
import { config, isConfigured } from './config.js';
import { runAgentTask } from './agent.js';
import { getShopifyOrders, getShopifyProducts } from './integrations/shopify.js';
import { cjHealthCheck } from './integrations/cj.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'ai-store-agent', mode: config.AGENT_MODE, integrations: isConfigured });
});

app.get('/api/shopify/orders', async (_req, res) => {
  try { res.json(await getShopifyOrders()); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'Shopify error' }); }
});

app.get('/api/shopify/products', async (_req, res) => {
  try { res.json(await getShopifyProducts()); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'Shopify error' }); }
});

app.get('/api/cj/health', async (_req, res) => {
  try { res.json(await cjHealthCheck()); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : 'CJ error' }); }
});

app.post('/api/agent/run', async (req, res) => {
  const task = typeof req.body?.task === 'string' ? req.body.task.trim() : '';
  if (!task) return res.status(400).json({ error: 'task is required' });
  try { return res.json({ ok: true, result: await runAgentTask(task) }); }
  catch (error) { return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : 'Agent error' }); }
});

app.listen(config.PORT, () => {
  console.log(`AI Store Agent listening on http://localhost:${config.PORT}`);
});
