import { config } from './config.js';
import { createCJOrder } from './integrations/cj.js';
import { getOrder, createFulfillment } from './integrations/shopify.js';
import { getState, log, mutate } from './state.js';

function cleanAddress(address: any) {
  if (!address) throw new Error('Customer shipping address is missing');
  if (!address.countryCode || !address.city || !address.address1 || !address.name) throw new Error('Customer shipping address is incomplete');
  return address;
}

export async function processShopifyOrder(orderId: string) {
  const state = await getState();
  if (state.processedShopifyOrders.includes(orderId)) return { status: 'already_processed', orderId };

  const { order } = await getOrder(orderId);
  if (!order) throw new Error('Shopify order not found');
  if (order.displayFinancialStatus !== 'PAID' && order.displayFinancialStatus !== 'PARTIALLY_PAID') {
    await log('warn', 'order.not_paid', { orderId, status: order.displayFinancialStatus });
    return { status: 'waiting_payment', orderId };
  }

  const address = cleanAddress(order.shippingAddress);
  const products = order.lineItems.nodes.map((item: any) => {
    const mapping = state.mappings[item.sku ?? item.id] ?? {};
    return {
      vid: mapping.vid,
      sku: mapping.cjSku,
      storeProductId: item.product?.id?.split('/').pop(),
      storeProductName: item.title,
      storeSku: item.sku,
      quantity: item.quantity,
      storeLineItemId: item.id.split('/').pop(),
    };
  });

  if (products.some((p: any) => !p.vid && !p.sku && !p.storeSku)) throw new Error('A Shopify line item has no SKU/mapping');

  const proposal = {
    shopifyOrderId: order.id,
    orderNumber: order.name,
    customer: address,
    products,
    total: order.totalPriceSet.shopMoney,
    requiredLogistics: Boolean(process.env.CJ_LOGISTIC_NAME),
  };

  if (config.AGENT_MODE === 'approval' || !process.env.CJ_LOGISTIC_NAME) {
    await mutate(s => { s.pendingApprovals[order.id] = proposal; });
    await log('info', 'order.awaiting_approval', proposal);
    return { status: 'awaiting_approval', proposal };
  }

  const result = await createCJOrder({
    orderNumber: order.name,
    shippingZip: address.zip,
    shippingCountryCode: address.countryCode,
    shippingCountry: address.country,
    shippingProvince: address.province ?? '',
    shippingCity: address.city,
    shippingPhone: address.phone ?? '',
    shippingCustomerName: address.name,
    shippingAddress: address.address1,
    shippingAddress2: address.address2 ?? '',
    email: '',
    shopAmount: order.totalPriceSet.shopMoney.amount,
    logisticName: process.env.CJ_LOGISTIC_NAME,
    fromCountryCode: process.env.CJ_FROM_COUNTRY_CODE ?? 'CN',
    products,
    payType: 2,
  });

  await mutate(s => {
    s.processedShopifyOrders.push(order.id);
    s.cjOrders[order.id] = result;
    delete s.pendingApprovals[order.id];
  });
  await log('info', 'order.sent_to_cj', { orderId, result });
  return { status: 'sent_to_cj', result };
}

export async function approveOrder(orderId: string) {
  const state = await getState();
  const proposal = state.pendingApprovals[orderId];
  if (!proposal) throw new Error('No pending approval for this order');
  if (!process.env.CJ_LOGISTIC_NAME) throw new Error('CJ_LOGISTIC_NAME is required before approval');
  const address = proposal.customer;
  const result = await createCJOrder({
    orderNumber: proposal.orderNumber,
    shippingZip: address.zip,
    shippingCountryCode: address.countryCode,
    shippingCountry: address.country,
    shippingProvince: address.province ?? '',
    shippingCity: address.city,
    shippingPhone: address.phone ?? '',
    shippingCustomerName: address.name,
    shippingAddress: address.address1,
    shippingAddress2: address.address2 ?? '',
    logisticName: process.env.CJ_LOGISTIC_NAME,
    fromCountryCode: process.env.CJ_FROM_COUNTRY_CODE ?? 'CN',
    products: proposal.products,
    payType: 2,
  });
  await mutate(s => { s.processedShopifyOrders.push(orderId); s.cjOrders[orderId] = result; delete s.pendingApprovals[orderId]; });
  await log('info', 'order.approved_to_cj', { orderId, result });
  return result;
}

export async function applyTrackingToShopify(shopifyOrderId: string, trackingNumber: string, trackingUrl?: string) {
  if (!trackingNumber) return { skipped: true };
  const result = await createFulfillment(shopifyOrderId, trackingNumber, trackingUrl);
  await log('info', 'tracking.synced', { shopifyOrderId, trackingNumber });
  return result;
}
