import { NextRequest, NextResponse } from "next/server";
import { getKvConfig, kvCommandSafe as kvCommand } from "@/app/lib/kv-config";
import { readStorageFile, writeStorageFile } from "@/app/lib/server-storage";
import type {
  MatchLogEntry,
  PlacedUnitSummary,
  PortalSummary,
  TeamUnitInfo,
} from "@/app/lib/telemetry-types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KV_MATCH_LOGS_KEY = "roblox:farm:match_logs:v1";
const MAX_MATCH_LOGS = 250;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
};

declare global {
  // eslint-disable-next-line no-var
  var __ROBLOX_MATCH_LOGS__: Map<string, MatchLogEntry> | undefined;
}

const memoryMatchLogs: Map<string, MatchLogEntry> =
  globalThis.__ROBLOX_MATCH_LOGS__ ??
  (globalThis.__ROBLOX_MATCH_LOGS__ = new Map<string, MatchLogEntry>());

let hasLoadedFile = false;
function ensureLoadedFromFile() {
  if (hasLoadedFile) return;
  hasLoadedFile = true;
  const saved = readStorageFile<MatchLogEntry[] | null>("match_logs.json", null);
  if (Array.isArray(saved)) {
    saved.forEach((entry) => {
      if (entry && entry.id) {
        memoryMatchLogs.set(entry.id, entry);
      }
    });
  }
}

let saveTimeout: NodeJS.Timeout | null = null;
function scheduleFileSave() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    try {
      const sorted = Array.from(memoryMatchLogs.values()).sort(
        (a, b) => (b.logged_at || 0) - (a.logged_at || 0)
      );
      writeStorageFile("match_logs.json", sorted.slice(0, MAX_MATCH_LOGS));
    } catch {
      // ignore
    }
  }, 1500);
}

function isAuthorized(req: NextRequest): boolean {
  const configuredKey = process.env.FARM_API_KEY;
  if (!configuredKey) return true;
  const headerKey =
    req.headers.get("x-api-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return headerKey === configuredKey;
}

async function getAllMatchLogs(): Promise<MatchLogEntry[]> {
  ensureLoadedFromFile();
  const kv = getKvConfig();
  if (kv) {
    const raw = await kvCommand<string[]>(["HGETALL", KV_MATCH_LOGS_KEY]);
    if (Array.isArray(raw)) {
      memoryMatchLogs.clear();
      for (let i = 0; i < raw.length; i += 2) {
        try {
          const parsed = JSON.parse(raw[i + 1]) as MatchLogEntry;
          if (parsed && parsed.id) {
            memoryMatchLogs.set(parsed.id, parsed);
          }
        } catch {
          // ignore malformed entry
        }
      }
      scheduleFileSave();
    }
  }
  return Array.from(memoryMatchLogs.values()).sort(
    (a, b) => (b.logged_at || 0) - (a.logged_at || 0)
  );
}

async function saveMatchLog(entry: MatchLogEntry): Promise<void> {
  memoryMatchLogs.set(entry.id, entry);
  const all = Array.from(memoryMatchLogs.values()).sort(
    (a, b) => (b.logged_at || 0) - (a.logged_at || 0)
  );

  const idsToPrune: string[] = [];
  if (all.length > MAX_MATCH_LOGS) {
    for (const old of all.slice(MAX_MATCH_LOGS)) {
      memoryMatchLogs.delete(old.id);
      idsToPrune.push(old.id);
    }
  }

  scheduleFileSave();
  const kv = getKvConfig();
  if (kv) {
    await kvCommand(["HSET", KV_MATCH_LOGS_KEY, entry.id, JSON.stringify(entry)]);
    if (idsToPrune.length > 0) {
      await kvCommand(["HDEL", KV_MATCH_LOGS_KEY, ...idsToPrune]);
    }
  }
}

async function deleteMatchLogIds(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  let removed = 0;
  for (const id of ids) {
    if (memoryMatchLogs.delete(id)) removed++;
  }
  scheduleFileSave();
  const kv = getKvConfig();
  if (kv) {
    await kvCommand(["HDEL", KV_MATCH_LOGS_KEY, ...ids]);
  }
  return removed;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const usernameFilter = (searchParams.get("username") || "")
      .trim()
      .toLowerCase();
    const userIdFilter = searchParams.get("user_id");

    const all = await getAllMatchLogs();
    const countsByUser: Record<string, number> = {};
    for (const item of all) {
      const uKey = (item.username || "").toLowerCase();
      if (uKey) {
        countsByUser[uKey] = (countsByUser[uKey] || 0) + 1;
      }
    }

    const filtered = all.filter((item) => {
      if (usernameFilter && (item.username || "").toLowerCase() !== usernameFilter) {
        return false;
      }
      if (userIdFilter && String(item.user_id) !== userIdFilter) {
        return false;
      }
      return true;
    });

    return NextResponse.json(
      {
        ok: true,
        storage_mode: getKvConfig() ? "vercel-kv" : "in-memory",
        total_count: all.length,
        counts_by_user: countsByUser,
        logs: filtered,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load match logs",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  try {
    const body = (await req.json()) as Partial<MatchLogEntry>;
    const userId = Number(body.user_id || 0);
    const username = String(body.username || "").trim();
    if (!userId && !username) {
      return NextResponse.json(
        { ok: false, error: "Missing user_id or username" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const loggedAt = Number(body.logged_at) > 0 ? Number(body.logged_at) : nowSec;
    const normLoggedAt = loggedAt > 1e11 ? Math.floor(loggedAt / 1000) : Math.floor(loggedAt);

    const existingAll = await getAllMatchLogs();
    const wave = Number(body.wave || 0);
    const duration = String(body.duration || "00:00");
    const resultStr =
      String(body.result || "VICTORY").toUpperCase() === "DEFEAT"
        ? "DEFEAT"
        : "VICTORY";

    // Deduplicate identical end-of-match report sent twice within 25s
    const duplicate = existingAll.find(
      (x) =>
        ((userId > 0 && x.user_id === userId) ||
          (username && x.username.toLowerCase() === username.toLowerCase())) &&
        Math.abs((x.logged_at || 0) - normLoggedAt) <= 25 &&
        x.wave === wave &&
        x.duration === duration &&
        x.result === resultStr
    );
    if (duplicate) {
      return NextResponse.json(
        { ok: true, deduplicated: true, entry: duplicate },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    const entryId =
      String(body.id || "").trim() ||
      `${userId || username}_${normLoggedAt}_${Math.random().toString(36).slice(2, 7)}`;

    const entry: MatchLogEntry = {
      id: entryId,
      user_id: userId,
      username: username || `User_${userId}`,
      display_name: String(body.display_name || username || `Farmer_${userId}`),
      avatar_url:
        String(body.avatar_url || "").trim() ||
        (userId > 0
          ? `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`
          : ""),
      device_name: body.device_name ? String(body.device_name) : undefined,
      level: Number(body.level || 1),
      player_xp:
        body.player_xp !== undefined ? Number(body.player_xp) : undefined,
      gems: Number(body.gems || 0),
      gold: Number(body.gold || 0),
      summer_pearls: Number(body.summer_pearls || 0),
      rerolls: Number(body.rerolls || 0),
      rewards: Array.isArray(body.rewards)
        ? body.rewards.map((r) => String(r)).filter(Boolean)
        : [],
      portals: Array.isArray(body.portals)
        ? (body.portals as PortalSummary[])
        : [],
      units: Array.isArray(body.units)
        ? (body.units as PlacedUnitSummary[])
        : [],
      team: Array.isArray(body.team) ? (body.team as TeamUnitInfo[]) : undefined,
      result: resultStr,
      duration,
      wave,
      map_name: String(body.map_name || "Anime Adventures"),
      difficulty: body.difficulty ? String(body.difficulty) : undefined,
      kills: Number(body.kills || 0),
      damage: Number(body.damage || 0),
      logged_at: normLoggedAt,
    };

    await saveMatchLog(entry);

    return NextResponse.json(
      { ok: true, entry },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to save match log",
      },
      { status: 400, headers: CORS_HEADERS }
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const username = (searchParams.get("username") || "").trim().toLowerCase();
    const userId = searchParams.get("user_id");
    const mode = searchParams.get("mode");

    const all = await getAllMatchLogs();

    if (mode === "all") {
      memoryMatchLogs.clear();
      scheduleFileSave();
      const kv = getKvConfig();
      if (kv) {
        await kvCommand(["DEL", KV_MATCH_LOGS_KEY]);
      }
      return NextResponse.json(
        { ok: true, removed_count: all.length, logs: [] },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    let toDelete: string[] = [];
    if (id) {
      toDelete = [id];
    } else if (username) {
      toDelete = all
        .filter((x) => (x.username || "").toLowerCase() === username)
        .map((x) => x.id);
    } else if (userId) {
      toDelete = all
        .filter((x) => String(x.user_id) === userId)
        .map((x) => x.id);
    } else {
      return NextResponse.json(
        { ok: false, error: "Specify ?id=..., ?username=..., ?user_id=..., or ?mode=all" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const removed = await deleteMatchLogIds(toDelete);
    const remaining = await getAllMatchLogs();
    return NextResponse.json(
      { ok: true, removed_count: removed, logs: remaining },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to delete match log",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
