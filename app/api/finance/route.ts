import { NextRequest, NextResponse } from "next/server";
import { readStorageFile, writeStorageFile } from "@/app/lib/server-storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ============================================================================
// TYPES & INTERFACES FOR 50/50 PARTNER FINANCE SYSTEM
// ============================================================================

export type PartnerId = "A" | "B";

export type FinanceTxType =
  | "income" // ลูกค้าโอนเงินเข้าบัญชี A หรือ B (นำมาหาร 2)
  | "advance" // เบิกเงินไปใช้ก่อน (หักจากโควต้าส่วนแบ่งของคนเบิก และเลือกได้ว่าดึงจากบัญชีตัวเองหรืออีกคนโอนให้)
  | "settlement" // โอนเคลียร์ยอดระหว่างกัน (A โอนให้ B หรือ B โอนให้ A)
  | "expense"; // ค่าใช้จ่ายส่วนกลาง (หักออกจากยอดรวมก่อนหาร 2)

export interface FinanceTransaction {
  id: string;
  type: FinanceTxType;
  amount: number;
  partner: PartnerId; // income: บัญชีที่ลูกค้าโอนเข้า | advance: คนที่เบิกไปใช้ | settlement: คนที่โอนเงินออก | expense: คนที่สำรองจ่าย
  advance_source?: "self_held" | "other_partner_transfer"; // สำหรับ advance: ดึงจากเงินในบัญชีตัวเอง หรือ อีกคนโอนมาให้เบิก
  note: string;
  customer_name?: string;
  created_at: number; // Unix timestamp (seconds)
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

// ============================================================================
// DUAL-MODE STORAGE ENGINE (Vercel KV REST API + Global Memory Fallback)
// ============================================================================

const KV_FINANCE_KEY = "roblox:farm:finance:v1";

declare global {
  // eslint-disable-next-line no-var
  var __ROBLOX_FINANCE_STATE__: FinanceState | undefined;
}

const defaultFinanceState: FinanceState = {
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

function hasVercelKV(): boolean {
  return Boolean(
    (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) &&
      (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
  );
}

async function kvCommand<T = unknown>(command: unknown[]): Promise<T | null> {
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

async function loadFinanceState(): Promise<FinanceState> {
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

async function saveFinanceState(state: FinanceState): Promise<void> {
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

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  try {
    const state = await loadFinanceState();
    return NextResponse.json(
      {
        ok: true,
        storage_mode: hasVercelKV() ? "vercel-kv" : "in-memory",
        state,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load finance state",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action || "add_transaction");
    const state = await loadFinanceState();

    if (action === "add_transaction") {
      const txRaw = body.transaction as Partial<FinanceTransaction> | undefined;
      if (!txRaw || typeof txRaw.amount !== "number" || txRaw.amount <= 0) {
        return NextResponse.json(
          { ok: false, error: "Invalid transaction amount" },
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const id =
        txRaw.id ||
        `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const newTx: FinanceTransaction = {
        id,
        type:
          txRaw.type === "income" ||
          txRaw.type === "advance" ||
          txRaw.type === "settlement" ||
          txRaw.type === "expense"
            ? txRaw.type
            : "income",
        amount: Math.round(Number(txRaw.amount) * 100) / 100,
        partner: txRaw.partner === "B" ? "B" : "A",
        advance_source:
          txRaw.advance_source === "other_partner_transfer"
            ? "other_partner_transfer"
            : "self_held",
        note: String(txRaw.note || "").trim(),
        customer_name: String(txRaw.customer_name || "").trim(),
        created_at: Number(txRaw.created_at) || Math.floor(Date.now() / 1000),
      };

      const exists = state.transactions.some((t) => t.id === newTx.id);
      if (!exists) {
        state.transactions.unshift(newTx);
      }
      await saveFinanceState(state);
      return NextResponse.json(
        { ok: true, state, added: newTx },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    if (action === "update_settings") {
      const settingsRaw = body.settings as Partial<FinanceSettings> | undefined;
      if (settingsRaw) {
        state.settings = {
          partner_a_name:
            String(settingsRaw.partner_a_name || "").trim() || "พี",
          partner_b_name:
            String(settingsRaw.partner_b_name || "").trim() || "บ๊วย",
        };
        await saveFinanceState(state);
      }
      return NextResponse.json(
        { ok: true, state },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    if (action === "sync_client_state") {
      const clientTxs = Array.isArray(body.transactions)
        ? (body.transactions as FinanceTransaction[])
        : [];
      const clientSettings = body.settings as Partial<FinanceSettings> | undefined;

      const deletedSet = new Set(state.deleted_ids || []);
      const existingIds = new Set(state.transactions.map((t) => t.id));

      let changed = false;
      for (const cTx of clientTxs) {
        if (
          cTx &&
          cTx.id &&
          !existingIds.has(cTx.id) &&
          !deletedSet.has(cTx.id) &&
          typeof cTx.amount === "number" &&
          cTx.amount > 0
        ) {
          state.transactions.push(cTx);
          existingIds.add(cTx.id);
          changed = true;
        }
      }

      if (
        clientSettings &&
        (state.settings.partner_a_name === "เรา (ตัวเอง)" || !state.settings.partner_a_name) &&
        (state.settings.partner_b_name === "เพื่อน (หุ้นส่วน)" || !state.settings.partner_b_name) &&
        (clientSettings.partner_a_name || clientSettings.partner_b_name)
      ) {
        state.settings = {
          partner_a_name:
            String(clientSettings.partner_a_name || "").trim() ||
            "พี",
          partner_b_name:
            String(clientSettings.partner_b_name || "").trim() ||
            "บ๊วย",
        };
        changed = true;
      }

      if (changed) {
        await saveFinanceState(state);
      }
      return NextResponse.json(
        { ok: true, state },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    return NextResponse.json(
      { ok: false, error: "Unknown action" },
      { status: 400, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid POST request",
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const mode = searchParams.get("mode");
    const state = await loadFinanceState();

    if (mode === "all") {
      const allIds = state.transactions.map((t) => t.id);
      state.deleted_ids = Array.from(new Set([...state.deleted_ids, ...allIds]));
      state.transactions = [];
      await saveFinanceState(state);
      return NextResponse.json(
        { ok: true, state },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    if (id) {
      state.transactions = state.transactions.filter((t) => t.id !== id);
      if (!state.deleted_ids.includes(id)) {
        state.deleted_ids.push(id);
      }
      await saveFinanceState(state);
      return NextResponse.json(
        { ok: true, state },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    return NextResponse.json(
      { ok: false, error: "Specify ?id= or ?mode=all" },
      { status: 400, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to delete",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
