import { readStorageFile, writeStorageFile } from "@/app/lib/server-storage";

export type PartnerId = "A" | "B";

export type FinanceTxType =
  | "income"
  | "advance"
  | "settlement"
  | "expense";

export interface FinanceTransaction {
  id: string;
  type: FinanceTxType;
  amount: number;
  partner: PartnerId;
  advance_source?: "self_held" | "other_partner_transfer";
  note: string;
  customer_name?: string;
  created_at: number;
}

export interface FinanceSettings {
  partner_a_name: string;
  partner_b_name: string;
}

export interface FinanceState {
  settings: FinanceSettings;
  transactions: FinanceTransaction[];
  deleted_ids: string[];
  updated_at: number;
}

export const KV_FINANCE_KEY = "roblox:farm:finance:v1";

declare global {
  // eslint-disable-next-line no-var
  var __ROBLOX_FINANCE_STATE__: FinanceState | undefined;
}

export const defaultFinanceState: FinanceState = {
  settings: {
    partner_a_name: "พี",
    partner_b_name: "บ๊วย",
  },
  transactions: [],
  deleted_ids: [],
  updated_at: Math.floor(Date.now() / 1000),
};

if (!globalThis.__ROBLOX_FINANCE_STATE__) {
  globalThis.__ROBLOX_FINANCE_STATE__ = {
    settings: { ...defaultFinanceState.settings },
    transactions: [],
    deleted_ids: [],
    updated_at: Math.floor(Date.now() / 1000),
  };
}

export function hasVercelKV(): boolean {
  return Boolean(
    (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
      (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
  );
}

export async function kvCommand<T = unknown>(command: unknown[]): Promise<T | null> {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (!url || !token) return null;

  try {
    const res = await fetch(url.replace(/\/$/, ""), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: T };
    return data.result ?? null;
  } catch {
    return null;
  }
}

export async function loadFinanceState(): Promise<FinanceState> {
  // 1. Try persistent file storage first (NAS / local disk)
  const fileState = readStorageFile<FinanceState | null>("finance.json", null);
  if (fileState && Array.isArray(fileState.transactions)) {
    globalThis.__ROBLOX_FINANCE_STATE__ = {
      settings: fileState.settings || { ...defaultFinanceState.settings },
      transactions: fileState.transactions || [],
      deleted_ids: Array.isArray(fileState.deleted_ids)
        ? fileState.deleted_ids
        : [],
      updated_at: fileState.updated_at || Math.floor(Date.now() / 1000),
    };
    return globalThis.__ROBLOX_FINANCE_STATE__;
  }

  // 2. Try Vercel KV / Upstash Redis
  if (hasVercelKV()) {
    const raw = await kvCommand<string>(["GET", KV_FINANCE_KEY]);
    if (raw) {
      try {
        const parsed =
          typeof raw === "string"
            ? (JSON.parse(raw) as FinanceState)
            : (raw as FinanceState);
        if (parsed && Array.isArray(parsed.transactions)) {
          globalThis.__ROBLOX_FINANCE_STATE__ = {
            settings: parsed.settings || { ...defaultFinanceState.settings },
            transactions: parsed.transactions || [],
            deleted_ids: Array.isArray(parsed.deleted_ids)
              ? parsed.deleted_ids
              : [],
            updated_at: parsed.updated_at || Math.floor(Date.now() / 1000),
          };
          return globalThis.__ROBLOX_FINANCE_STATE__;
        }
      } catch {
        // Fallback to memory
      }
    }
  }
  return globalThis.__ROBLOX_FINANCE_STATE__!;
}

export async function saveFinanceState(state: FinanceState): Promise<void> {
  state.updated_at = Math.floor(Date.now() / 1000);
  // Sort newest first and cap at 2000 transactions
  state.transactions.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  if (state.transactions.length > 2000) {
    state.transactions = state.transactions.slice(0, 2000);
  }
  if (state.deleted_ids.length > 1000) {
    state.deleted_ids = state.deleted_ids.slice(-1000);
  }
  globalThis.__ROBLOX_FINANCE_STATE__ = state;

  // 1. Save to persistent file storage (NAS / local disk)
  writeStorageFile("finance.json", state);

  // 2. Save to Vercel KV if available
  if (hasVercelKV()) {
    await kvCommand(["SET", KV_FINANCE_KEY, JSON.stringify(state)]);
  }
}

/**
 * Link and sync a customer order into Finance Split 50/50:
 * - Amount: order.price
 * - Customer: [Facebook] (@Username)
 * - Note: What to do (target_item)
 * - Partner: B (บ๊วย) by default, or A (พี)
 */
export async function upsertFinanceFromOrder(
  order: {
    id: string;
    facebook_name: string;
    username: string;
    target_item: string;
    price?: number;
    created_at?: number;
    finance_tx_id?: string;
  },
  partner: PartnerId = "B"
): Promise<string | null> {
  const price = Number(order.price) || 0;
  if (price <= 0) return null;

  const state = await loadFinanceState();
  const txId = order.finance_tx_id || `tx_order_${order.id}`;

  const cleanCustName = `${order.facebook_name || "ลูกค้า"} (@${order.username || "Roblox"})`;
  const cleanNote = order.target_item || "ลูกค้าโอนค่าฟาร์ม";

  const existingIdx = state.transactions.findIndex((t) => t.id === txId);
  const txObj: FinanceTransaction = {
    id: txId,
    type: "income",
    amount: Math.round(price * 100) / 100,
    partner: partner,
    advance_source: "self_held",
    customer_name: cleanCustName,
    note: cleanNote,
    created_at: Number(order.created_at) || Math.floor(Date.now() / 1000),
  };

  if (existingIdx >= 0) {
    state.transactions[existingIdx] = txObj;
  } else {
    state.transactions.unshift(txObj);
  }

  // Remove from deleted_ids if it was previously marked deleted
  if (state.deleted_ids && state.deleted_ids.includes(txId)) {
    state.deleted_ids = state.deleted_ids.filter((id) => id !== txId);
  }

  await saveFinanceState(state);
  return txId;
}

export async function removeFinanceFromOrder(
  orderId: string,
  txId?: string
): Promise<void> {
  const state = await loadFinanceState();
  const targetId = txId || `tx_order_${orderId}`;
  state.transactions = state.transactions.filter((t) => t.id !== targetId);
  if (!state.deleted_ids.includes(targetId)) {
    state.deleted_ids.push(targetId);
  }
  await saveFinanceState(state);
}
