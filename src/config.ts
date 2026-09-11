import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-5.6'),
  SHOPIFY_STORE_DOMAIN: z.string().optional(),
  SHOPIFY_ACCESS_TOKEN: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default('2026-07'),
  CJ_API_BASE_URL: z.string().default('https://developers.cjdropshipping.com'),
  CJ_ACCESS_TOKEN: z.string().optional(),
  AGENT_MODE: z.enum(['approval', 'autopilot']).default('approval')
});

export const config = envSchema.parse(process.env);

export const isConfigured = {
  openai: Boolean(config.OPENAI_API_KEY),
  shopify: Boolean(config.SHOPIFY_STORE_DOMAIN && config.SHOPIFY_ACCESS_TOKEN),
  cj: Boolean(config.CJ_ACCESS_TOKEN)
};
