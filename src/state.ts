import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const file = join(process.cwd(), 'data', 'state.json');

export interface State {
  processedShopifyOrders: string[];
  mappings: Record<string, { vid?: string; sku?: string; cjSku?: string }>;
  pendingApprovals: Record<string, any>;
  cjOrders: Record<string, any>;
  logs: Array<{ at: string; level: 'info' | 'warn' | 'error'; event: string; data?: any }>;
}

const empty: State = { processedShopifyOrders: [], mappings: {}, pendingApprovals: {}, cjOrders: {}, logs: [] };
let cache: State | null = null;

async function load() {
  if (cache) return cache;
  try { cache = JSON.parse(await readFile(file, 'utf8')); }
  catch { cache = structuredClone(empty); await save(); }
  return cache!;
}

async function save() {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(cache ?? empty, null, 2));
}

export async function getState() { return load(); }
export async function mutate(fn: (state: State) => void) { const state = await load(); fn(state); await save(); return state; }
export async function log(level: 'info' | 'warn' | 'error', event: string, data?: any) {
  await mutate(s => { s.logs.unshift({ at: new Date().toISOString(), level, event, data }); s.logs = s.logs.slice(0, 500); });
}
