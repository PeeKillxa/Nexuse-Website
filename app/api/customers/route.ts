import { NextRequest, NextResponse } from "next/server";
import { readStorageFile, writeStorageFile } from "@/app/lib/server-storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ============================================================================
// TYPES & INTERFACES FOR CUSTOMER ACCOUNTS / ORDERS SYSTEM
// ============================================================================

export type OrderStatus = "PENDING" | "FARMING" | "COMPLETED" | "CANCELLED";
export type PaymentStatus = "PAID" | "UNPAID" | "DEPOSIT";

export interface CustomerOrder {
  id: string;
  facebook_name: string; // ชื่อเฟสลูกค้า (เช่น "น้องโบ๊ท คนเดิม", "Somchai FB")
  facebook_link?: string; // ลิงก์โปรไฟล์เฟสบุ๊ค (ถ้ามี)
  username: string; // Roblox Username
  display_name?: string; // Roblox DisplayName
  avatar_url?: string; // Roblox Avatar Headshot URL
  target_item: string; // ของที่หา (เช่น "Goku Secret", "Reroll 500+", "Trait Unique", "ฟาร์มเลเวล 100")
  price?: number; // ราคา / ค่าบริการ (บาท)
  paid_status: PaymentStatus; // สถานะการจ่ายเงิน
  order_status: OrderStatus; // สถานะงาน
  assigned_device?: string; // จอ / Emu ที่รับผิดชอบ (เช่น "Android Device-5", "Android Device-4", "PC")
  handled_by?: string; // ผู้รับงาน (เช่น "เรา", "เพื่อน")
  note?: string; // หมายเหตุเพิ่มเติม
  created_at: number; // Unix epoch seconds
  updated_at: number; // Unix epoch seconds
}

export interface CustomerStoreState {
  orders: CustomerOrder[];
  updated_at: number;
}

const KV_CUSTOMERS_KEY = "roblox:farm:customers:v1";

declare global {
  // eslint-disable-next-line no-var
  var __ROBLOX_FARM_CUSTOMERS__: CustomerStoreState | undefined;
}

function createDefaultState(): CustomerStoreState {
  return {
    orders: [],
    updated_at: 0,
  };
}

if (!globalThis.__ROBLOX_FARM_CUSTOMERS__) {
  globalThis.__ROBLOX_FARM_CUSTOMERS__ = createDefaultState();
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

async function loadCustomersState(): Promise<CustomerStoreState> {
  // 1. Try file storage first (NAS)
  const fileState = readStorageFile<CustomerStoreState | null>(
    "customers.json",
    null
  );
  if (fileState && Array.isArray(fileState.orders)) {
    globalThis.__ROBLOX_FARM_CUSTOMERS__ = fileState;
    return fileState;
  }

  // 2. Try KV
  if (hasVercelKV()) {
    const raw = await kvCommand<string>(["GET", KV_CUSTOMERS_KEY]);
    if (raw) {
      try {
        const parsed =
          typeof raw === "string"
            ? (JSON.parse(raw) as CustomerStoreState)
            : (raw as CustomerStoreState);
        if (parsed && Array.isArray(parsed.orders)) {
          globalThis.__ROBLOX_FARM_CUSTOMERS__ = parsed;
          return parsed;
        }
      } catch {
        // Fallback to memory
      }
    }
  }
  return globalThis.__ROBLOX_FARM_CUSTOMERS__!;
}

async function saveCustomersState(state: CustomerStoreState): Promise<void> {
  state.updated_at = Math.floor(Date.now() / 1000);
  globalThis.__ROBLOX_FARM_CUSTOMERS__ = state;

  // 1. Save to persistent file storage
  writeStorageFile("customers.json", state);

  // 2. Save to KV
  if (hasVercelKV()) {
    await kvCommand(["SET", KV_CUSTOMERS_KEY, JSON.stringify(state)]);
  }
}

// ============================================================================
// ROBLOX PROFILE & AVATAR RESOLVER
// ============================================================================

async function resolveRobloxInfo(rawUsername: string): Promise<{
  cleanUsername: string;
  displayName: string;
  avatarUrl: string;
  userId?: number;
}> {
  const clean = rawUsername.trim().replace(/^@/, "");
  let displayName = clean;
  let userId: number | undefined;
  let avatarUrl = `https://www.roblox.com/headshot-thumbnail/image?userId=1&width=150&height=150&format=png`;

  try {
    const res = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [clean],
        excludeBannedUsers: false,
      }),
      cache: "force-cache",
    });

    if (res.ok) {
      const data = (await res.json()) as {
        data?: Array<{ id: number; name: string; displayName: string }>;
      };
      const user = data?.data?.[0];
      if (user) {
        userId = user.id;
        displayName = user.displayName || user.name;

        // Fetch Avatar Headshot
        try {
          const avRes = await fetch(
            `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=false`,
            { cache: "force-cache" }
          );
          if (avRes.ok) {
            const avJson = (await avRes.json()) as {
              data?: Array<{ imageUrl?: string }>;
            };
            const img = avJson?.data?.[0]?.imageUrl;
            if (img) avatarUrl = img;
          }
        } catch {
          // fallback
        }
      }
    }
  } catch {
    // ignore
  }

  return { cleanUsername: clean, displayName, avatarUrl, userId };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ============================================================================
// GET /api/customers
// ============================================================================

export async function GET() {
  try {
    const state = await loadCustomersState();
    const orders = state.orders || [];

    const summary = orders.reduce(
      (acc, ord) => {
        acc.total_orders += 1;
        if (ord.order_status === "FARMING") acc.farming_count += 1;
        if (ord.order_status === "COMPLETED") acc.completed_count += 1;
        if (ord.order_status === "PENDING") acc.pending_count += 1;
        if (ord.order_status === "CANCELLED") acc.cancelled_count += 1;

        const price = Number(ord.price || 0);
        acc.total_value += price;
        if (ord.paid_status === "PAID") {
          acc.total_paid += price;
        } else if (ord.paid_status === "UNPAID") {
          acc.total_unpaid += price;
        } else if (ord.paid_status === "DEPOSIT") {
          acc.total_deposit += price;
        }
        return acc;
      },
      {
        total_orders: 0,
        farming_count: 0,
        completed_count: 0,
        pending_count: 0,
        cancelled_count: 0,
        total_value: 0,
        total_paid: 0,
        total_unpaid: 0,
        total_deposit: 0,
      }
    );

    return NextResponse.json(
      {
        ok: true,
        storage_mode: hasVercelKV() ? "vercel-kv" : "in-memory",
        summary,
        orders,
        updated_at: state.updated_at,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load customers",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// ============================================================================
// POST /api/customers
// ============================================================================

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action || "");
    const state = await loadCustomersState();
    const nowSec = Math.floor(Date.now() / 1000);

    // 1. Add new customer order
    if (action === "add_customer") {
      const facebook_name = String(body.facebook_name || "").trim();
      const rawUsername = String(body.username || "").trim();
      const target_item = String(body.target_item || "").trim();

      if (!facebook_name) {
        return NextResponse.json(
          { ok: false, error: "กรุณาระบุชื่อเฟสลูกค้า" },
          { status: 400, headers: CORS_HEADERS }
        );
      }
      if (!rawUsername) {
        return NextResponse.json(
          { ok: false, error: "กรุณาระบุ Username Roblox ของลูกค้า" },
          { status: 400, headers: CORS_HEADERS }
        );
      }
      if (!target_item) {
        return NextResponse.json(
          { ok: false, error: "กรุณาระบุของที่หา / เป้าหมายที่ฟาร์ม" },
          { status: 400, headers: CORS_HEADERS }
        );
      }

      // Resolve Roblox Details
      const { cleanUsername, displayName, avatarUrl } =
        await resolveRobloxInfo(rawUsername);

      const newOrder: CustomerOrder = {
        id: `cust_${nowSec}_${Math.random().toString(36).slice(2, 7)}`,
        facebook_name,
        facebook_link: String(body.facebook_link || "").trim() || undefined,
        username: cleanUsername,
        display_name: displayName,
        avatar_url: avatarUrl,
        target_item,
        price: body.price !== undefined ? Math.max(0, Number(body.price)) : 0,
        paid_status: (["PAID", "UNPAID", "DEPOSIT"].includes(
          String(body.paid_status)
        )
          ? String(body.paid_status)
          : "UNPAID") as PaymentStatus,
        order_status: (["PENDING", "FARMING", "COMPLETED", "CANCELLED"].includes(
          String(body.order_status)
        )
          ? String(body.order_status)
          : "FARMING") as OrderStatus,
        assigned_device: String(body.assigned_device || "").trim() || "PC",
        handled_by: String(body.handled_by || "").trim() || undefined,
        note: String(body.note || "").trim() || undefined,
        created_at: nowSec,
        updated_at: nowSec,
      };

      state.orders.unshift(newOrder);
      await saveCustomersState(state);

      return NextResponse.json(
        { ok: true, order: newOrder, orders: state.orders },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 2. Update existing customer order
    if (action === "update_customer") {
      const id = String(body.id || "");
      const target = state.orders.find((o) => o.id === id);
      if (!target) {
        return NextResponse.json(
          { ok: false, error: "ไม่พบข้อมูลออเดอร์นี้" },
          { status: 404, headers: CORS_HEADERS }
        );
      }

      if (body.facebook_name !== undefined) {
        target.facebook_name = String(body.facebook_name).trim();
      }
      if (body.facebook_link !== undefined) {
        target.facebook_link = String(body.facebook_link).trim() || undefined;
      }
      if (body.target_item !== undefined) {
        target.target_item = String(body.target_item).trim();
      }
      if (body.price !== undefined) {
        target.price = Math.max(0, Number(body.price));
      }
      if (
        body.paid_status &&
        ["PAID", "UNPAID", "DEPOSIT"].includes(String(body.paid_status))
      ) {
        target.paid_status = String(body.paid_status) as PaymentStatus;
      }
      if (
        body.order_status &&
        ["PENDING", "FARMING", "COMPLETED", "CANCELLED"].includes(
          String(body.order_status)
        )
      ) {
        target.order_status = String(body.order_status) as OrderStatus;
      }
      if (body.assigned_device !== undefined) {
        target.assigned_device = String(body.assigned_device).trim() || "PC";
      }
      if (body.handled_by !== undefined) {
        target.handled_by = String(body.handled_by).trim() || undefined;
      }
      if (body.note !== undefined) {
        target.note = String(body.note).trim() || undefined;
      }

      // If username changed, re-resolve avatar
      if (
        body.username &&
        String(body.username).trim().toLowerCase() !==
          target.username.toLowerCase()
      ) {
        const { cleanUsername, displayName, avatarUrl } =
          await resolveRobloxInfo(String(body.username));
        target.username = cleanUsername;
        target.display_name = displayName;
        target.avatar_url = avatarUrl;
      }

      target.updated_at = nowSec;
      await saveCustomersState(state);

      return NextResponse.json(
        { ok: true, order: target, orders: state.orders },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 3. Delete customer order
    if (action === "delete_customer") {
      const id = String(body.id || "");
      state.orders = state.orders.filter((o) => o.id !== id);
      await saveCustomersState(state);
      return NextResponse.json(
        { ok: true, deleted_id: id, orders: state.orders },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 4. Sync client state (handles serverless cold-start)
    if (action === "sync_client_state") {
      const incoming = body.state as CustomerStoreState | undefined;
      if (
        incoming &&
        Array.isArray(incoming.orders) &&
        (incoming.updated_at || 0) > (state.updated_at || 0)
      ) {
        state.orders = incoming.orders;
        state.updated_at = incoming.updated_at;
        globalThis.__ROBLOX_FARM_CUSTOMERS__ = state;
        if (hasVercelKV()) {
          await kvCommand(["SET", KV_CUSTOMERS_KEY, JSON.stringify(state)]);
        }
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
        error: err instanceof Error ? err.message : "Invalid POST body",
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }
}
