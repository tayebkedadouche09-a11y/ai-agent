import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from './config.js';

const file = join(config.DATA_DIR, 'state.json');

export interface State {
  processedShopifyOrders: string[];
  mappings: Record<string, { vid?: string; sku?: string; cjSku?: string }>;
  pendingApprovals: Record<string, any>;
  cjOrders: Record<string, any>;
  dailySpend: Record<string, number>;
  logs: Array<{ at: string; level: 'info' | 'warn' | 'error'; event: string; data?: any }>;
}

const empty: State = { processedShopifyOrders: [], mappings: {}, pendingApprovals: {}, cjOrders: {}, dailySpend: {}, logs: [] };
let cache: State | null = null;
let saveQueue = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(file, 'utf8')) as State;
    cache.dailySpend ??= {};
    cache.processedShopifyOrders ??= [];
    cache.mappings ??= {};
    cache.pendingApprovals ??= {};
    cache.cjOrders ??= {};
    cache.logs ??= [];
  } catch {
    cache = structuredClone(empty);
    await save();
  }
  return cache!;
}

async function save() {
  await mkdir(config.DATA_DIR, { recursive: true });
  const snapshot = JSON.stringify(cache ?? empty, null, 2);
  saveQueue = saveQueue.then(() => writeFile(file, snapshot, 'utf8'));
  await saveQueue;
}

export async function getState() { return load(); }
export async function mutate(fn: (state: State) => void) { const state = await load(); fn(state); await save(); return state; }
export async function log(level: 'info' | 'warn' | 'error', event: string, data?: any) {
  await mutate(s => { s.logs.unshift({ at: new Date().toISOString(), level, event, data }); s.logs = s.logs.slice(0, 500); });
}

export function utcDay() { return new Date().toISOString().slice(0, 10); }
