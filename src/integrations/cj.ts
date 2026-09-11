import { config, hasCJ } from '../config.js';

const base = 'https://developers.cjdropshipping.com/api2.0/v1';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function cjRequest<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  if (!hasCJ()) throw new Error('CJ is not configured');
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('CJ-Access-Token', config.CJ_ACCESS_TOKEN!);
  if (config.CJ_PLATFORM_TOKEN) headers.set('platformToken', config.CJ_PLATFORM_TOKEN);

  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await fetch(`${base}${path}`, { ...init, headers });
      if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 3) break;
      const retryAfter = Number(response.headers.get('retry-after') ?? '');
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : attempt * 1000);
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
      await sleep(attempt * 1000);
    }
  }
  if (!response) throw lastError ?? new Error('CJ request failed');
  const text = await response.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`CJ API returned non-JSON (${response.status})`); }
  if (!response.ok || json.success === false || (json.code !== undefined && json.code !== 200)) {
    throw new Error(`CJ API error: ${JSON.stringify(json)}`);
  }
  return json as T;
}

export async function getCJBalance() {
  return cjRequest('/shopping/pay/getBalance', { method: 'GET' });
}

export async function getVariantStock(vid: string) {
  return cjRequest(`/product/stock/queryByVid?vid=${encodeURIComponent(vid)}`, { method: 'GET', headers: { Accept: 'application/json' } });
}

export interface CJOrderInput {
  orderNumber: string;
  shippingZip?: string;
  shippingCountryCode: string;
  shippingCountry: string;
  shippingProvince?: string;
  shippingCity: string;
  shippingCounty?: string;
  shippingPhone?: string;
  shippingCustomerName: string;
  shippingAddress: string;
  shippingAddress2?: string;
  email?: string;
  shopAmount?: string;
  logisticName: string;
  fromCountryCode: string;
  platform?: string;
  shopLogisticsType?: number;
  storeName?: string;
  orderFlow?: number;
  payType?: number;
  products: Array<{ vid?: string; sku?: string; storeProductId?: string; storeProductName?: string; storeSku?: string; variantOptions?: string; quantity: number; unitPrice?: string; storeLineItemId?: string }>;
}

export async function createCJOrder(input: CJOrderInput) {
  if (!input.products.length) throw new Error('CJ order must contain at least one product');
  return cjRequest('/shopping/order/createOrderV2', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      platform: input.platform ?? 'shopify',
      orderFlow: input.orderFlow ?? 2,
      shopLogisticsType: input.shopLogisticsType ?? 2,
      payType: input.payType ?? 2,
    }),
  });
}

export async function getCJOrderList(pageNum = 1, pageSize = 20) {
  return cjRequest(`/shopping/order/list?pageNum=${pageNum}&pageSize=${pageSize}`, { method: 'GET' });
}

export async function getCJOrderDetail(orderId: string) {
  return cjRequest(`/shopping/order/getOrderDetail?orderId=${encodeURIComponent(orderId)}`, { method: 'GET' });
}

export async function calculateFreight(payload: Record<string, unknown>) {
  return cjRequest('/logistic/freightCalculate', { method: 'POST', body: JSON.stringify(payload) });
}
