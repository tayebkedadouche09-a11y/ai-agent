import { config, hasShopify } from '../config.js';

const endpoint = () => `https://${config.SHOPIFY_STORE_DOMAIN}/admin/api/${config.SHOPIFY_API_VERSION}/graphql.json`;
const tokenEndpoint = () => `https://${config.SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function requestWithRetry(url: string, init: RequestInit, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) return response;
      const retryAfter = Number(response.headers.get('retry-after') ?? '');
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : attempt * 1000);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await sleep(attempt * 1000);
    }
  }
  throw lastError ?? new Error('Shopify request failed');
}

type TokenCache = { accessToken: string; expiresAt: number };
let tokenCache: TokenCache | null = null;
let tokenRequest: Promise<string> | null = null;

async function getShopifyAccessToken(forceRefresh = false): Promise<string> {
  if (!hasShopify()) throw new Error('Shopify is not configured');

  const now = Date.now();
  if (!forceRefresh && tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.accessToken;

  if (tokenRequest) return tokenRequest;

  tokenRequest = (async () => {
    const response = await requestWithRetry(tokenEndpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.SHOPIFY_CLIENT_ID!,
        client_secret: config.SHOPIFY_CLIENT_SECRET!,
      }).toString(),
    });

    const text = await response.text();
    let json: any;
    try { json = JSON.parse(text); } catch { throw new Error(`Shopify token endpoint returned non-JSON (${response.status})`); }
    if (!response.ok || !json.access_token) {
      throw new Error(`Shopify token error: ${JSON.stringify(json)}`);
    }

    const expiresIn = Number(json.expires_in ?? 86400);
    tokenCache = {
      accessToken: json.access_token,
      expiresAt: Date.now() + Math.max(60_000, expiresIn * 1000),
    };
    return json.access_token as string;
  })();

  try {
    return await tokenRequest;
  } finally {
    tokenRequest = null;
  }
}

export async function shopifyGraphql<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!hasShopify()) throw new Error('Shopify is not configured');

  for (let attempt = 0; attempt < 2; attempt++) {
    const accessToken = await getShopifyAccessToken(attempt === 1);
    const response = await requestWithRetry(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
      body: JSON.stringify({ query, variables }),
    });

    const text = await response.text();
    let json: any;
    try { json = JSON.parse(text); } catch { throw new Error(`Shopify API returned non-JSON (${response.status})`); }

    if ((response.status === 401 || response.status === 403) && attempt === 0) {
      tokenCache = null;
      continue;
    }
    if (!response.ok || json.errors) throw new Error(`Shopify API error: ${JSON.stringify(json.errors ?? json)}`);
    return json.data as T;
  }

  throw new Error('Shopify authentication failed after token refresh');
}

function assertUserErrors(result: any, operation: string) {
  const errors = result?.userErrors ?? [];
  if (errors.length) throw new Error(`Shopify ${operation} error: ${JSON.stringify(errors)}`);
  return result;
}

const orderFields = `id name createdAt email displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } shippingAddress { name address1 address2 city province country countryCode zip phone } lineItems(first: 50) { nodes { id title quantity sku variant { id } product { id title } } }`;

export async function getOrders(first = 20) {
  return shopifyGraphql<{ orders: { edges: { node: any }[] } }>(`query Orders($first: Int!) { orders(first: $first, sortKey: CREATED_AT, reverse: true) { edges { node { ${orderFields} } } } }`, { first });
}

export async function getOrder(id: string) {
  return shopifyGraphql<{ order: any }>(`query Order($id: ID!) { order(id: $id) { ${orderFields} } }`, { id });
}

export async function createFulfillment(orderId: string, trackingNumber: string, trackingUrl?: string) {
  const fulfillmentOrderData = await shopifyGraphql<any>(`query FulfillmentOrders($id: ID!) { order(id: $id) { fulfillmentOrders(first: 20) { nodes { id status lineItems(first: 100) { nodes { id remainingQuantity } } } } } }`, { id: orderId });
  const fo = fulfillmentOrderData.order?.fulfillmentOrders?.nodes?.find((x: any) => x.status === 'OPEN' || x.status === 'IN_PROGRESS');
  if (!fo) return { skipped: true, reason: 'No open fulfillment order' };
  const lineItems = fo.lineItems.nodes.filter((x: any) => x.remainingQuantity > 0).map((x: any) => ({ id: x.id, quantity: x.remainingQuantity }));
  if (!lineItems.length) return { skipped: true, reason: 'No remaining fulfillment line items' };
  const mutation = `mutation Fulfill($input: FulfillmentInput!) { fulfillmentCreate(fulfillment: $input) { fulfillment { id status trackingInfo { number url } } userErrors { field message } } }`;
  const data = await shopifyGraphql<any>(mutation, { input: { lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: lineItems }], notifyCustomer: true, trackingInfo: { number: trackingNumber, url: trackingUrl } } });
  return assertUserErrors(data.fulfillmentCreate, 'fulfillmentCreate');
}

export async function updateOrderNote(orderId: string, note: string) {
  const data = await shopifyGraphql<any>(`mutation UpdateOrder($input: OrderInput!) { orderUpdate(input: $input) { order { id note } userErrors { field message } } }`, { input: { id: orderId, note } });
  return assertUserErrors(data.orderUpdate, 'orderUpdate');
}
