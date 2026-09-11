import { config, hasShopify } from '../config.js';

const endpoint = () => `https://${config.SHOPIFY_STORE_DOMAIN}/admin/api/${config.SHOPIFY_API_VERSION}/graphql.json`;

export async function shopifyGraphql<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!hasShopify()) throw new Error('Shopify is not configured');
  const response = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': config.SHOPIFY_ACCESS_TOKEN! }, body: JSON.stringify({ query, variables }) });
  const text = await response.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`Shopify API returned non-JSON (${response.status})`); }
  if (!response.ok || json.errors) throw new Error(`Shopify API error: ${JSON.stringify(json.errors ?? json)}`);
  return json.data as T;
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
  return shopifyGraphql<any>(mutation, { input: { lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: lineItems }], notifyCustomer: true, trackingInfo: { number: trackingNumber, url: trackingUrl } } });
}

export async function updateOrderNote(orderId: string, note: string) {
  return shopifyGraphql<any>(`mutation UpdateOrder($input: OrderInput!) { orderUpdate(input: $input) { order { id note } userErrors { field message } } }`, { input: { id: orderId, note } });
}
