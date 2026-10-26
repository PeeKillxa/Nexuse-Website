import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface TelemetryPayload {
  user_id: number;
  username: string;
  display_name?: string;
  avatar_url?: string;
  account_age?: number;
  game_name?: string;
  place_id?: number;
  job_id?: string;
  status?: "ONLINE" | "OFFLINE" | string;
  level?: number;
  gems?: number;
  gold?: number;
  wins?: number;
  disconnects?: number;
  extra_stats?: Record<string, number | string | boolean>;
  ping?: number;
  fps?: number;
  uptime_seconds?: number;
  updated_at?: number;
}

export interface StoredAccount extends Required<Omit<TelemetryPayload, "extra_stats">> {
  extra_stats: Record<string, number | string | boolean>;
  previous_gems: number;
  gems_delta: number;
  last_gem_gain_at: number;
  server_updated_at: number;
  counted_current_offline: boolean;
}

export interface AccountWithComputedStatus extends StoredAccount {
  effective_status: "ONLINE" | "OFFLINE";
  seconds_since_update: number;
}

// ============================================================================
// CONFIGURATION & GLOBAL IN-MEMORY CACHE (+ OPTIONAL VERCEL KV / UPSTASH REDIS)
// ============================================================================

const OFFLINE_TIMEOUT_SECONDS = 120; // Account is marked OFFLINE if no heartbeat > 120s
const KV_HASH_KEY = "roblox:farm:accounts:v1";

declare global {
  // eslint-disable-next-line no-var
  var __ROBLOX_FARM_STORE__: Map<string, StoredAccount> | undefined;
  // eslint-disable-next-line no-var
  var __ROBLOX_AVATAR_CACHE__: Map<number, string> | undefined;
}

const memoryStore: Map<string, StoredAccount> =
  globalThis.__ROBLOX_FARM_STORE__ ??
  (globalThis.__ROBLOX_FARM_STORE__ = new Map<string, StoredAccount>());

const avatarCache: Map<number, string> =
  globalThis.__ROBLOX_AVATAR_CACHE__ ??
  (globalThis.__ROBLOX_AVATAR_CACHE__ = new Map<number, string>());

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
};

// ============================================================================
// OPTIONAL VERCEL KV / UPSTASH REDIS REST HELPER (Zero external packages needed)
// ============================================================================

function getKvConfig(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (url && token) {
    return { url: url.replace(/\/$/, ""), token };
  }
  return null;
}

async function kvCommand<T = unknown>(command: (string | number)[]): Promise<T | null> {
  const kv = getKvConfig();
  if (!kv) return null;
  try {
    const res = await fetch(kv.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${kv.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result: T };
    return data.result;
  } catch {
    return null;
  }
}

async function getAllStoredAccounts(): Promise<StoredAccount[]> {
  const kv = getKvConfig();
  if (kv) {
    const raw = await kvCommand<string[]>(["HGETALL", KV_HASH_KEY]);
    if (Array.isArray(raw) && raw.length > 0) {
      const list: StoredAccount[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        try {
          const parsed = JSON.parse(raw[i + 1]) as StoredAccount;
          list.push(parsed);
          memoryStore.set(String(parsed.user_id), parsed);
        } catch {
          // ignore malformed entry
        }
      }
      return list;
    }
  }
  return Array.from(memoryStore.values());
}

async function getStoredAccount(userId: number): Promise<StoredAccount | undefined> {
  const key = String(userId);
  const kv = getKvConfig();
  if (kv) {
    const raw = await kvCommand<string>(["HGET", KV_HASH_KEY, key]);
    if (raw) {
      try {
        return JSON.parse(raw) as StoredAccount;
      } catch {
        // fallback to memory
      }
    }
  }
  return memoryStore.get(key);
}

async function saveStoredAccount(account: StoredAccount): Promise<void> {
  const key = String(account.user_id);
  memoryStore.set(key, account);
  const kv = getKvConfig();
  if (kv) {
    await kvCommand(["HSET", KV_HASH_KEY, key, JSON.stringify(account)]);
  }
}

async function deleteStoredAccount(userId: string): Promise<void> {
  memoryStore.delete(userId);
  const kv = getKvConfig();
  if (kv) {
    await kvCommand(["HDEL", KV_HASH_KEY, userId]);
  }
}

async function clearAllStoredAccounts(): Promise<void> {
  memoryStore.clear();
  const kv = getKvConfig();
  if (kv) {
    await kvCommand(["DEL", KV_HASH_KEY]);
  }
}

// ============================================================================
// ROBLOX HEADSHOT CDN RESOLVER
// ============================================================================

async function resolveRobloxAvatar(
  userId: number,
  providedUrl?: string
): Promise<string> {
  if (avatarCache.has(userId)) {
    return avatarCache.get(userId)!;
  }

  if (
    providedUrl &&
    (providedUrl.includes("rbxcdn.com") ||
      providedUrl.startsWith("data:") ||
      providedUrl.includes("dicebear.com"))
  ) {
    avatarCache.set(userId, providedUrl);
    return providedUrl;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800);
    const res = await fetch(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`,
      { signal: controller.signal, cache: "force-cache" }
    );
    clearTimeout(timeout);

    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{ imageUrl?: string; state?: string }>;
      };
      const imageUrl = json?.data?.[0]?.imageUrl;
      if (imageUrl) {
        avatarCache.set(userId, imageUrl);
        return imageUrl;
      }
    }
  } catch {
    // Ignore network timeout and use fallback
  }

  return (
    providedUrl ||
    `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`
  );
}

// ============================================================================
// HELPER: NORMALIZE & UPSERT TELEMETRY
// ============================================================================

function normalizeEpochSeconds(ts?: number): number {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!ts || typeof ts !== "number" || Number.isNaN(ts)) return nowSec;
  if (ts > 1e11) return Math.floor(ts / 1000);
  return Math.floor(ts);
}

async function upsertAccountTelemetry(
  payload: TelemetryPayload
): Promise<StoredAccount> {
  const nowSec = Math.floor(Date.now() / 1000);
  const userId = Number(payload.user_id);

  if (!userId || Number.isNaN(userId)) {
    throw new Error("Invalid or missing 'user_id'");
  }

  const existing = await getStoredAccount(userId);
  const incomingGems = Number(payload.gems ?? existing?.gems ?? 0);
  const prevGems = existing ? existing.gems : incomingGems;

  let gemsDelta = existing?.gems_delta ?? 0;
  let lastGemGainAt = existing?.last_gem_gain_at ?? 0;

  if (existing && incomingGems > prevGems) {
    gemsDelta = incomingGems - prevGems;
    lastGemGainAt = nowSec;
  } else if (existing && incomingGems < prevGems) {
    gemsDelta = 0;
  }

  const incomingStatus = String(payload.status || "ONLINE").toUpperCase();
  const prevWins = existing?.wins ?? 0;
  const incomingWins = Number(payload.wins ?? prevWins);
  const wins = Math.max(prevWins, incomingWins);

  const prevDisconnects = existing?.disconnects ?? 0;
  const incomingDisconnects = Number(payload.disconnects ?? prevDisconnects);
  let disconnects = Math.max(prevDisconnects, incomingDisconnects);
  let countedOffline = existing?.counted_current_offline ?? false;

  if (incomingStatus === "OFFLINE") {
    if (!countedOffline) {
      if (incomingDisconnects <= prevDisconnects) {
        disconnects = prevDisconnects + 1;
      }
      countedOffline = true;
    }
  } else {
    countedOffline = false;
  }

  const avatarUrl = await resolveRobloxAvatar(userId, payload.avatar_url);

  const record: StoredAccount = {
    user_id: userId,
    username: String(payload.username || existing?.username || `User_${userId}`),
    display_name: String(
      payload.display_name ||
        existing?.display_name ||
        payload.username ||
        `Farmer_${userId}`
    ),
    avatar_url: avatarUrl,
    account_age: Number(payload.account_age ?? existing?.account_age ?? 0),
    game_name: String(
      payload.game_name || existing?.game_name || "Anime Adventures"
    ),
    place_id: Number(payload.place_id ?? existing?.place_id ?? 8304191830),
    job_id: String(payload.job_id || existing?.job_id || "unknown-job-id"),
    status: incomingStatus,
    level: Number(payload.level ?? existing?.level ?? 1),
    gems: incomingGems,
    gold: Number(payload.gold ?? existing?.gold ?? 0),
    wins,
    disconnects,
    extra_stats:
      payload.extra_stats && typeof payload.extra_stats === "object"
        ? payload.extra_stats
        : existing?.extra_stats || {},
    ping: Number(payload.ping ?? existing?.ping ?? 0),
    fps: Number(payload.fps ?? existing?.fps ?? 60),
    uptime_seconds: Number(
      payload.uptime_seconds ?? existing?.uptime_seconds ?? 0
    ),
    updated_at: normalizeEpochSeconds(payload.updated_at),
    previous_gems: prevGems,
    gems_delta: gemsDelta,
    last_gem_gain_at: lastGemGainAt,
    server_updated_at: nowSec,
    counted_current_offline: countedOffline,
  };

  await saveStoredAccount(record);
  return record;
}

// ============================================================================
// OPTIONAL API KEY CHECK
// ============================================================================

function isAuthorized(req: NextRequest): boolean {
  const configuredKey = process.env.FARM_API_KEY;
  if (!configuredKey) return true;

  const headerKey =
    req.headers.get("x-api-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return headerKey === configuredKey;
}

// ============================================================================
// OPTIONS /api/telemetry (CORS Preflight)
// ============================================================================

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ============================================================================
// GET /api/telemetry
// Returns all accounts + real-time ONLINE/OFFLINE state (120s timeout) + summary metrics
// ============================================================================

export async function GET() {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const rawAccounts = await getAllStoredAccounts();

    const accounts: AccountWithComputedStatus[] = [];

    for (const acc of rawAccounts) {
      const referenceTime = acc.server_updated_at || acc.updated_at || nowSec;
      const secondsSinceUpdate = Math.max(0, nowSec - referenceTime);

      // 120s timeout + 15-second grace period for room teleports / match replays
      const isTimedOut = secondsSinceUpdate > OFFLINE_TIMEOUT_SECONDS;
      const isExplicitOffline = acc.status === "OFFLINE" && secondsSinceUpdate > 15;
      const effectiveStatus: "ONLINE" | "OFFLINE" =
        isTimedOut || isExplicitOffline ? "OFFLINE" : "ONLINE";

      let wins = acc.wins ?? 0;
      let disconnects = acc.disconnects ?? 0;
      let countedOffline = acc.counted_current_offline ?? false;

      if (effectiveStatus === "OFFLINE" && !countedOffline) {
        disconnects += 1;
        countedOffline = true;
        const updatedRecord: StoredAccount = {
          ...acc,
          wins,
          disconnects,
          counted_current_offline: true,
        };
        await saveStoredAccount(updatedRecord);
      }

      accounts.push({
        ...acc,
        wins,
        disconnects,
        counted_current_offline: countedOffline,
        effective_status: effectiveStatus,
        seconds_since_update: secondsSinceUpdate,
      });
    }

    // Compute Global Summary Statistics
    const summary = accounts.reduce(
      (totals, acc) => {
        totals.total_gems += acc.gems || 0;
        totals.total_gold += acc.gold || 0;
        totals.total_wins += acc.wins || 0;
        totals.total_disconnects += acc.disconnects || 0;
        totals.total_uptime_seconds += acc.uptime_seconds || 0;
        if (acc.effective_status === "ONLINE") {
          totals.online_count += 1;
        } else {
          totals.offline_count += 1;
        }
        return totals;
      },
      {
        total_accounts: accounts.length,
        online_count: 0,
        offline_count: 0,
        total_gems: 0,
        total_gold: 0,
        total_wins: 0,
        total_disconnects: 0,
        total_uptime_seconds: 0,
      }
    );

    return NextResponse.json(
      {
        ok: true,
        server_time: nowSec,
        offline_timeout_seconds: OFFLINE_TIMEOUT_SECONDS,
        storage_mode: getKvConfig() ? "vercel-kv" : "in-memory",
        summary,
        accounts,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to fetch telemetry",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// ============================================================================
// POST /api/telemetry
// Receives single account payload or batch payload from Roblox Luau Executor
// ============================================================================

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized: Invalid x-api-key" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  try {
    const body = await req.json();

    // Batch payload support: { accounts: [ ... ] } or Array
    if (Array.isArray(body) || Array.isArray(body?.accounts)) {
      const list: TelemetryPayload[] = Array.isArray(body)
        ? body
        : body.accounts;
      const results: StoredAccount[] = [];
      for (const item of list) {
        results.push(await upsertAccountTelemetry(item));
      }
      return NextResponse.json(
        {
          ok: true,
          updated_count: results.length,
          accounts: results,
        },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // Standard Single Account Telemetry Payload from Roblox Luau Executor
    const savedAccount = await upsertAccountTelemetry(body as TelemetryPayload);

    return NextResponse.json(
      {
        ok: true,
        account: savedAccount,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Invalid JSON payload",
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }
}

// ============================================================================
// DELETE /api/telemetry
// ?user_id=12345678  -> Remove single account
// ?mode=offline      -> Remove all offline accounts
// ?mode=all          -> Clear all accounts
// ============================================================================

export async function DELETE(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("user_id");
  const mode = searchParams.get("mode");

  if (userId) {
    await deleteStoredAccount(userId);
    return NextResponse.json(
      { ok: true, deleted_user_id: userId },
      { status: 200, headers: CORS_HEADERS }
    );
  }

  if (mode === "offline") {
    const nowSec = Math.floor(Date.now() / 1000);
    const all = await getAllStoredAccounts();
    let removed = 0;
    for (const acc of all) {
      const isOffline =
        acc.status === "OFFLINE" ||
        nowSec - (acc.server_updated_at || acc.updated_at) >
          OFFLINE_TIMEOUT_SECONDS;
      if (isOffline) {
        await deleteStoredAccount(String(acc.user_id));
        removed++;
      }
    }
    return NextResponse.json(
      { ok: true, removed_offline_count: removed },
      { status: 200, headers: CORS_HEADERS }
    );
  }

  if (mode === "all") {
    await clearAllStoredAccounts();
    return NextResponse.json(
      { ok: true, message: "Cleared all accounts" },
      { status: 200, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(
    { ok: false, error: "Specify ?user_id=... or ?mode=offline|all" },
    { status: 400, headers: CORS_HEADERS }
  );
}
