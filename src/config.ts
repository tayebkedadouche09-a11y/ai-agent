import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.6'),
  SHOPIFY_STORE_DOMAIN: z.string().optional(),
  SHOPIFY_CLIENT_ID: z.string().optional(),
  SHOPIFY_CLIENT_SECRET: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default('2026-07'),
  SHOPIFY_WEBHOOK_SECRET: z.string().optional(),
  CJ_ACCESS_TOKEN: z.string().optional(),
  CJ_PLATFORM_TOKEN: z.string().optional(),
  CJ_OPEN_ID: z.string().optional(),
  CJ_LOGISTIC_NAME: z.string().optional(),
  CJ_FROM_COUNTRY_CODE: z.string().default('CN'),
  AGENT_MODE: z.enum(['approval', 'autopilot']).default('approval'),
  DASHBOARD_SECRET: z.string().optional(),
  MAX_AUTO_CJ_USD: z.coerce.number().positive().default(100),
  MAX_DAILY_CJ_USD: z.coerce.number().positive().default(500),
  DATA_DIR: z.string().default('./data'),
});

export const config = schema.parse(process.env);
export function hasShopify() {
  return Boolean(config.SHOPIFY_STORE_DOMAIN && config.SHOPIFY_CLIENT_ID && config.SHOPIFY_CLIENT_SECRET);
}
export function hasCJ() { return Boolean(config.CJ_ACCESS_TOKEN); }
export function hasOpenAI() { return Boolean(config.OPENAI_API_KEY); }
