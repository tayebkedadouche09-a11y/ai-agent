import { config } from './config.js';
import { createCJOrder } from './integrations/cj.js';
import { getOrder, createFulfillment } from './integrations/shopify.js';
import { getState, log, mutate, utcDay } from './state.js';

function cleanAddress(address: any) {
  if (!address) throw new Error('Customer shipping address is missing');
  if (!address.countryCode || !address.city || !address.address1 || !address.name) throw new Error('Customer shipping address is incomplete');
  return address;
}

function amountOf(order: any) { return Number(order.totalPriceSet?.shopMoney?.amount ?? 0); }

function validateAutopilotBudget(state: Awaited<ReturnType<typeof getState>>, amount: number) {
  if (amount > config.MAX_AUTO_CJ_USD) throw new Error(`Order value ${amount} exceeds MAX_AUTO_CJ_USD=${config.MAX_AUTO_CJ_USD}`);
  const day = utcDay();
  const spent = state.dailySpend[day] ?? 0;
  if (spent + amount > config.MAX_DAILY_CJ_USD) throw new Error(`Daily automation limit exceeded: ${spent + amount} > ${config.MAX_DAILY_CJ_USD}`);
}

function buildProducts(order: any, mappings: Awaited<ReturnType<typeof getState>>['mappings']) {
  return order.lineItems.nodes.map((item: any) => {
    const mapping = mappings[item.sku ?? item.id] ?? {};
    return {
      vid: mapping.vid,
      sku: mapping.cjSku ?? mapping.sku,
      storeProductId: item.product?.id?.split('/').pop(),
      storeProductName: item.title,
      storeSku: item.sku,
      quantity: item.quantity,
      storeLineItemId: item.id.split('/').pop(),
    };
  });
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
  if (order.displayFinancialStatus === 'PARTIALLY_PAID') {
    await log('warn', 'order.partially_paid', { orderId });
    return { status: 'waiting_full_payment', orderId };
  }
  if (order.displayFulfillmentStatus === 'FULFILLED') return { status: 'already_fulfilled', orderId };

  const address = cleanAddress(order.shippingAddress);
  const products = buildProducts(order, state.mappings);
  if (products.some((p: any) => !p.vid && !p.sku && !p.storeSku)) throw new Error('A Shopify line item has no SKU/mapping');

  const amount = amountOf(order);
  const proposal = {
    shopifyOrderId: order.id,
    orderNumber: order.name,
    customer: address,
    email: order.email ?? '',
    products,
    total: order.totalPriceSet.shopMoney,
    requiredLogistics: Boolean(config.CJ_LOGISTIC_NAME),
  };

  if (config.AGENT_MODE === 'approval' || !config.CJ_LOGISTIC_NAME) {
    await mutate(s => { s.pendingApprovals[order.id] = proposal; });
    await log('info', 'order.awaiting_approval', proposal);
    return { status: 'awaiting_approval', proposal };
  }

  validateAutopilotBudget(state, amount);
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
    email: order.email ?? '',
    shopAmount: String(amount),
    logisticName: config.CJ_LOGISTIC_NAME,
    fromCountryCode: config.CJ_FROM_COUNTRY_CODE,
    products,
    payType: 2,
  });

  await mutate(s => {
    s.processedShopifyOrders.push(order.id);
    s.cjOrders[order.id] = result;
    s.dailySpend[utcDay()] = (s.dailySpend[utcDay()] ?? 0) + amount;
    delete s.pendingApprovals[order.id];
  });
  await log('info', 'order.sent_to_cj', { orderId, result });
  return { status: 'sent_to_cj', result };
}

export async function approveOrder(orderId: string) {
  const state = await getState();
  const proposal = state.pendingApprovals[orderId];
  if (!proposal) throw new Error('No pending approval for this order');
  if (!config.CJ_LOGISTIC_NAME) throw new Error('CJ_LOGISTIC_NAME is required before approval');
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
    email: proposal.email ?? '',
    shopAmount: String(proposal.total?.amount ?? ''),
    logisticName: config.CJ_LOGISTIC_NAME,
    fromCountryCode: config.CJ_FROM_COUNTRY_CODE,
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
