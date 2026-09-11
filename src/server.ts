import express from 'express';
import crypto from 'node:crypto';
import { config, hasCJ, hasOpenAI, hasShopify } from './config.js';
import { shopifyGraphql, getOrders } from './integrations/shopify.js';
import { getCJBalance, getCJOrderList } from './integrations/cj.js';
import { askAgent } from './agent.js';
import { approveOrder, applyTrackingToShopify, processShopifyOrder } from './workflow.js';
import { getState, log } from './state.js';

const app = express();
app.use(express.json({ limit: '1mb', verify: (req: any, _res, buf) => { req.rawBody = Buffer.from(buf); } }));

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length > 0 && aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function verifyHmac(raw: Buffer, signature: string | undefined, secret: string | undefined) {
  if (!secret || !signature) return false;
  return safeEqual(crypto.createHmac('sha256', secret).update(raw).digest('base64'), signature);
}
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!config.DASHBOARD_SECRET) return res.status(503).json({ error: 'DASHBOARD_SECRET is not configured' });
  if (!safeEqual(req.header('X-Admin-Secret') ?? '', config.DASHBOARD_SECRET)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/health', async (_req, res) => {
  const s = await getState();
  res.json({ ok: true, integrations: { openai: hasOpenAI(), shopify: hasShopify(), cj: hasCJ() }, mode: config.AGENT_MODE, pendingApprovals: Object.keys(s.pendingApprovals).length, processed: s.processedShopifyOrders.length });
});

app.get('/api/orders', requireAdmin, async (_req, res) => { try { res.json(await getOrders(50)); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.get('/api/cj/orders', requireAdmin, async (_req, res) => { try { res.json(await getCJOrderList(1, 50)); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.get('/api/cj/balance', requireAdmin, async (_req, res) => { try { res.json(await getCJBalance()); } catch (e) { res.status(500).json({ error: String(e) }); } });
app.get('/api/state', requireAdmin, async (_req, res) => res.json(await getState()));

app.post('/api/agent', requireAdmin, async (req, res) => {
  try { res.json(await askAgent(String(req.body?.message ?? 'Give me a store status report.'))); }
  catch (e) { await log('error', 'agent.error', { error: String(e) }); res.status(500).json({ error: String(e) }); }
});

app.post('/api/approvals/:orderId/approve', requireAdmin, async (req, res) => {
  try {
    const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;
    res.json({ ok: true, result: await approveOrder(orderId) });
  } catch (e) { res.status(400).json({ error: String(e) }); }
});

app.post('/webhooks/shopify/orders-create', async (req: any, res) => {
  const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
  if (!verifyHmac(raw, req.header('X-Shopify-Hmac-Sha256'), config.SHOPIFY_WEBHOOK_SECRET)) return res.status(401).send('invalid signature');
  res.status(200).send('ok');
  try {
    const id = req.body?.admin_graphql_api_id ?? (req.body?.id ? `gid://shopify/Order/${req.body.id}` : undefined);
    if (id) await processShopifyOrder(id);
  } catch (e) { await log('error', 'shopify.webhook.failed', { error: String(e), body: req.body }); }
});

app.post('/webhooks/shopify/orders-updated', async (req: any, res) => {
  const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
  if (!verifyHmac(raw, req.header('X-Shopify-Hmac-Sha256'), config.SHOPIFY_WEBHOOK_SECRET)) return res.status(401).send('invalid signature');
  res.status(200).send('ok');
  try {
    const id = req.body?.admin_graphql_api_id ?? (req.body?.id ? `gid://shopify/Order/${req.body.id}` : undefined);
    if (id) await processShopifyOrder(id);
  } catch (e) { await log('error', 'shopify.updated.failed', { error: String(e), body: req.body }); }
});

app.post('/webhooks/cj', async (req: any, res) => {
  const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
  if (!verifyHmac(raw, req.header('sign'), config.CJ_OPEN_ID)) return res.status(401).send('invalid signature');
  res.status(200).send('ok');
  try {
    const body = req.body;
    const messageId = body?.messageId ?? body?.id;
    const state = await getState();
    if (messageId && state.logs.some(x => x.event === 'cj.webhook' && x.data?.messageId === messageId)) return;
    if (body?.type === 'LOGISTIC') {
      const p = body.params ?? {};
      const numbers = p.storeOrderNumbers ?? [];
      const orders = await getOrders(50);
      for (const number of numbers) {
        const found = orders.orders.edges.find((x: any) => x.node.name === number || x.node.name === `#${number}`);
        if (found && p.trackingNumber) await applyTrackingToShopify(found.node.id, p.trackingNumber, p.trackingUrl);
      }
    }
    await log('info', 'cj.webhook', { messageId, body });
  } catch (e) { await log('error', 'cj.webhook.failed', { error: String(e) }); }
});

app.post('/api/setup/shopify-webhooks', requireAdmin, async (req, res) => {
  try {
    const baseUrl = String(req.body?.publicBaseUrl ?? '').replace(/\/$/, '');
    if (!baseUrl.startsWith('https://')) throw new Error('publicBaseUrl must be HTTPS');
    const topics: Array<[string, string]> = [['ORDERS_CREATE', `${baseUrl}/webhooks/shopify/orders-create`], ['ORDERS_UPDATED', `${baseUrl}/webhooks/shopify/orders-updated`]];
    const results = [];
    for (const [topic, uri] of topics) {
      results.push(await shopifyGraphql<any>(`mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) { webhookSubscription { id topic uri } userErrors { field message } } }`, { topic, webhookSubscription: { uri } }));
    }
    res.json({ ok: true, results });
  } catch (e) { res.status(400).json({ error: String(e) }); }
});

async function syncPaidOrders() {
  if (!hasShopify()) return;
  try {
    const orders = await getOrders(20);
    for (const edge of orders.orders.edges) {
      const order = edge.node;
      if (order.displayFinancialStatus === 'PAID' && order.displayFulfillmentStatus !== 'FULFILLED') await processShopifyOrder(order.id);
    }
  } catch (e) { await log('error', 'polling.failed', { error: String(e) }); }
}

app.get('/', (_req, res) => res.type('html').send(DASHBOARD));

const DASHBOARD = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Store Manager</title><style>body{font-family:Inter,system-ui;margin:0;background:#0b1020;color:#eef2ff}main{max-width:1100px;margin:auto;padding:28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.card{background:#121a2e;border:1px solid #26304a;border-radius:16px;padding:18px}.ok{color:#5ee89a}.bad{color:#ff7272}button{background:#6d5dfc;color:white;border:0;padding:10px 14px;border-radius:10px;cursor:pointer}input,textarea{width:100%;box-sizing:border-box;background:#0b1020;color:white;border:1px solid #26304a;border-radius:10px;padding:12px}pre{white-space:pre-wrap;background:#080c16;padding:14px;border-radius:12px;max-height:360px;overflow:auto}.muted{color:#9aa7c2}</style></head><body><main><h1>🤖 AI Store Manager</h1><p class="muted">Shopify + CJdropshipping autonomous operations center</p><div class="card"><input id="secret" type="password" placeholder="Dashboard secret"><button onclick="saveSecret()">Unlock</button></div><div id="cards" class="grid" style="margin-top:14px"></div><div class="card" style="margin-top:14px"><h2>Ask the agent</h2><textarea id="q" rows="3" placeholder="Check my store status, orders, CJ balance..."></textarea><br><br><button onclick="ask()">Ask AI</button><pre id="answer">Ready.</pre></div><div class="card" style="margin-top:14px"><h2>Pending approvals</h2><pre id="pending">Loading...</pre></div><div class="card" style="margin-top:14px"><h2>Recent activity</h2><pre id="logs">Loading...</pre></div></main><script>const key=()=>sessionStorage.getItem('adminSecret')||'';function saveSecret(){sessionStorage.setItem('adminSecret',document.querySelector('#secret').value);load()}async function j(u,o={}){o.headers={...(o.headers||{}),'X-Admin-Secret':key()};let r=await fetch(u,o);return r.json()}async function load(){let h=await j('/api/health'),s=await j('/api/state');if(s.error){document.querySelector('#answer').textContent=s.error;return}document.querySelector('#cards').innerHTML=[['OpenAI',h.integrations.openai],['Shopify',h.integrations.shopify],['CJ',h.integrations.cj],['Mode',h.mode],['Pending',h.pendingApprovals],['Processed',h.processed]].map(x=>'<div class="card"><div class="muted">'+x[0]+'</div><h2 class="'+(typeof x[1]==='boolean'?(x[1]?'ok':'bad'):'')+'">'+x[1]+'</h2></div>').join('');document.querySelector('#pending').textContent=JSON.stringify(s.pendingApprovals,null,2);document.querySelector('#logs').textContent=JSON.stringify(s.logs.slice(0,30),null,2)}async function ask(){document.querySelector('#answer').textContent='Thinking...';let r=await j('/api/agent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:document.querySelector('#q').value})});document.querySelector('#answer').textContent=r.text||r.error;load()}load();setInterval(load,10000)</script></body></html>`;

app.listen(config.PORT, () => { console.log(`AI Store Manager listening on http://localhost:${config.PORT}`); void syncPaidOrders(); setInterval(syncPaidOrders, 60000); });
