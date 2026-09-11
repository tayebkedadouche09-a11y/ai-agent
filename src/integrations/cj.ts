import { config, hasCJ } from '../config.js';

const base = 'https://developers.cjdropshipping.com/api2.0/v1';

async function cjRequest<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  if (!hasCJ()) throw new Error('CJ is not configured');
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('CJ-Access-Token', config.CJ_ACCESS_TOKEN!);
  if (config.CJ_PLATFORM_TOKEN) headers.set('platformToken', config.CJ_PLATFORM_TOKEN);
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const json = await response.json() as any;
  if (!response.ok || json.success === false || (json.code && json.code !== 200)) {
    throw new Error(`CJ API error: ${JSON.stringify(json)}`);
  }
  return json as T;
}

export async function getCJBalance() {
  return cjRequest('/shopping/pay/getBalance', { method: 'GET' });
}

export async function getVariantStock(vid: string) {
  return cjRequest('/product/stock/queryByVid', { method: 'GET', headers: { Accept: 'application/json' } });
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
  return cjRequest('/shopping/order/createOrderV3', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      platform: input.platform ?? 'shopify',
      orderFlow: input.orderFlow ?? 2,
      shopLogisticsType: input.shopLogisticsType ?? 2,
      payType: input.payType ?? 3,
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
