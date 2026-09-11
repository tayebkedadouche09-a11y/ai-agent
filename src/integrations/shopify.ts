import { config } from '../config.js';

function shopifyUrl(path: string) {
  if (!config.SHOPIFY_STORE_DOMAIN) throw new Error('SHOPIFY_STORE_DOMAIN is not configured');
  return `https://${config.SHOPIFY_STORE_DOMAIN}/admin/api/${config.SHOPIFY_API_VERSION}/${path}`;
}

async function shopifyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!config.SHOPIFY_ACCESS_TOKEN) throw new Error('SHOPIFY_ACCESS_TOKEN is not configured');
  const response = await fetch(shopifyUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': config.SHOPIFY_ACCESS_TOKEN,
      ...(init?.headers ?? {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Shopify ${response.status}: ${text}`);
  return text ? JSON.parse(text) as T : ({} as T);
}

export async function getShopifyOrders(limit = 20) {
  return shopifyFetch<{ orders: unknown[] }>(`orders.json?status=any&limit=${Math.min(limit, 250)}`);
}

export async function getShopifyProducts(limit = 50) {
  return shopifyFetch<{ products: unknown[] }>(`products.json?limit=${Math.min(limit, 250)}`);
}

export async function updateShopifyOrderNote(orderId: string, note: string) {
  return shopifyFetch<{ order: unknown }>(`orders/${orderId}.json`, {
    method: 'PUT',
    body: JSON.stringify({ order: { id: orderId, note } })
  });
}
