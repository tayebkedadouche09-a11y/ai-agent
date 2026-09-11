import { config } from '../config.js';

async function cjFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!config.CJ_ACCESS_TOKEN) throw new Error('CJ_ACCESS_TOKEN is not configured');
  const base = config.CJ_API_BASE_URL.replace(/\/$/, '');
  const response = await fetch(`${base}/${path.replace(/^\//, '')}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'CJ-Access-Token': config.CJ_ACCESS_TOKEN,
      ...(init?.headers ?? {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`CJ ${response.status}: ${text}`);
  return text ? JSON.parse(text) as T : ({} as T);
}

/**
 * CJ API calls are kept behind this adapter so endpoint changes do not leak
 * into the agent. Concrete endpoints are added only after the user's CJ API
 * account/version is confirmed.
 */
export async function cjHealthCheck() {
  return { configured: true, baseUrl: config.CJ_API_BASE_URL };
}

export async function cjRequest<T>(path: string, init?: RequestInit) {
  return cjFetch<T>(path, init);
}
