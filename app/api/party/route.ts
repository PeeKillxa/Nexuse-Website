import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ============================================================================
// TYPES & INTERFACES FOR CLOUD PARTY SYNC SYSTEM
// ============================================================================

export interface PartyMember {
  id: string;
  name: string; // ชื่อหลักที่แสดง (ใส่ได้ทั้ง Username หรือ DisplayName)
  aliases: string[]; // ชื่อทั้งหมดที่ใช้เทียบในเกม (ตัวพิมพ์เล็ก)
  enabled: boolean; // เปิด/ปิดการเช็คไอดีนี้ชั่วคราวได้โดยไม่ต้องลบ
  note?: string;
  added_at: number;
}

export interface PartySyncState {
  enabled: boolean; // เปิด/ปิดระบบรอเพื่อนครบตี้ก่อนรันสคริปต์หลัก
  lobby_only: boolean; // เช็คเฉพาะใน Lobby เท่านั้น (แมพต่อสู้รันสคริปต์หลักทันที)
  lobby_place_id: number; // PlaceId ของ Lobby (Default: 8304191830)
  wait_for_character: boolean; // รอให้ตัวละคร (HumanoidRootPart) โหลดเกิดในแมพครบทุกคนก่อนรัน
  settle_delay_seconds: number; // หน่วงเวลาหลังครบตี้ก่อนรันสคริปต์ (วินาที)
  main_script_url: string; // ลิงก์สคริปต์หลักที่จะรันเมื่อเพื่อนครบ
  members: PartyMember[];
  updated_at: number; // Unix epoch seconds (0 = initial default)
}

const KV_PARTY_KEY = "roblox:farm:party_sync:v1";

declare global {
  // eslint-disable-next-line no-var
  var __ROBLOX_PARTY_SYNC_STATE__: PartySyncState | undefined;
}

function createDefaultPartyState(): PartySyncState {
  return {
    enabled: true,
    lobby_only: true,
    lobby_place_id: 8304191830,
    wait_for_character: true,
    settle_delay_seconds: 2,
    main_script_url:
      "https://raw.githubusercontent.com/weziiotez-dev/xt-hub/main/crazy.lua",
    members: [
      {
        id: "member_johnwick",
        name: "JohnwickInwza7",
        aliases: ["johnwickinwza7", "johnwicklnwza7"],
        enabled: true,
        note: "ไอดีหลัก / PC",
        added_at: 1730000001,
      },
      {
        id: "member_kenqu",
        name: "Kenqu",
        aliases: ["kenqu"],
        enabled: true,
        note: "สมาชิกตี้",
        added_at: 1730000002,
      },
      {
        id: "member_obcxdi",
        name: "OBCXDI",
        aliases: ["obcxdi"],
        enabled: true,
        note: "Emu (Android Device)",
        added_at: 1730000003,
      },
      {
        id: "member_albatross",
        name: "Albatross",
        aliases: ["albatross", "opxdmmd"],
        enabled: true,
        note: "Emu (Android Device-4 / @OPXDMMD)",
        added_at: 1730000004,
      },
    ],
    updated_at: 0,
  };
}

if (!globalThis.__ROBLOX_PARTY_SYNC_STATE__) {
  globalThis.__ROBLOX_PARTY_SYNC_STATE__ = createDefaultPartyState();
}

function hasVercelKV(): boolean {
  return Boolean(
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  );
}

async function kvCommand<T = unknown>(command: unknown[]): Promise<T | null> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  try {
    const res = await fetch(url, {
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

async function loadPartyState(): Promise<PartySyncState> {
  if (hasVercelKV()) {
    const raw = await kvCommand<string>(["GET", KV_PARTY_KEY]);
    if (raw) {
      try {
        const parsed =
          typeof raw === "string"
            ? (JSON.parse(raw) as PartySyncState)
            : (raw as PartySyncState);
        if (parsed && Array.isArray(parsed.members)) {
          globalThis.__ROBLOX_PARTY_SYNC_STATE__ = parsed;
          return parsed;
        }
      } catch {
        // Fallback to memory
      }
    }
  }
  return globalThis.__ROBLOX_PARTY_SYNC_STATE__!;
}

async function savePartyState(state: PartySyncState): Promise<void> {
  state.updated_at = Math.floor(Date.now() / 1000);
  globalThis.__ROBLOX_PARTY_SYNC_STATE__ = state;
  if (hasVercelKV()) {
    await kvCommand(["SET", KV_PARTY_KEY, JSON.stringify(state)]);
  }
}

// Resolve Roblox Username & DisplayName automatically when possible
async function resolveRobloxAliases(inputName: string): Promise<string[]> {
  const clean = inputName.trim().replace(/^@/, "");
  const lowerSet = new Set<string>([clean.toLowerCase()]);

  try {
    const res = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [clean],
        excludeBannedUsers: false,
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: Array<{ name?: string; displayName?: string }>;
      };
      const first = json?.data?.[0];
      if (first?.name) lowerSet.add(first.name.toLowerCase());
      if (first?.displayName) lowerSet.add(first.displayName.toLowerCase());
    }
  } catch {
    // ignore network error
  }

  return Array.from(lowerSet);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  try {
    const state = await loadPartyState();
    const activeMembers = state.members.filter((m) => m.enabled);
    return NextResponse.json(
      {
        ok: true,
        storage_mode: hasVercelKV() ? "vercel-kv" : "in-memory",
        state,
        active_count: activeMembers.length,
        active_members: activeMembers,
      },
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load party state",
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action || "");
    const state = await loadPartyState();

    // 1. Add a new party member
    if (action === "add_member") {
      const rawName = String(body.name || "")
        .trim()
        .replace(/^@/, "");
      if (!rawName) {
        return NextResponse.json(
          { ok: false, error: "กรุณาระบุชื่อผู้เล่น" },
          { status: 400, headers: CORS_HEADERS }
        );
      }

      const extraAlias = String(body.extra_alias || "")
        .trim()
        .replace(/^@/, "")
        .toLowerCase();
      const note = String(body.note || "").trim();

      const resolvedAliases = await resolveRobloxAliases(rawName);
      if (extraAlias && !resolvedAliases.includes(extraAlias)) {
        resolvedAliases.push(extraAlias);
      }

      // Check if already exists
      const existing = state.members.find(
        (m) =>
          m.name.toLowerCase() === rawName.toLowerCase() ||
          m.aliases.includes(rawName.toLowerCase())
      );

      if (existing) {
        existing.enabled = true;
        existing.aliases = Array.from(
          new Set([...existing.aliases, ...resolvedAliases])
        );
        if (note) existing.note = note;
      } else {
        state.members.push({
          id: `member_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: rawName,
          aliases: resolvedAliases,
          enabled: true,
          note,
          added_at: Math.floor(Date.now() / 1000),
        });
      }

      await savePartyState(state);
      return NextResponse.json(
        { ok: true, state },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 2. Toggle member enabled/disabled
    if (action === "toggle_member") {
      const id = String(body.id || "");
      const target = state.members.find((m) => m.id === id);
      if (target) {
        target.enabled =
          typeof body.enabled === "boolean" ? body.enabled : !target.enabled;
        await savePartyState(state);
      }
      return NextResponse.json(
        { ok: true, state },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 3. Remove member
    if (action === "remove_member") {
      const id = String(body.id || "");
      state.members = state.members.filter((m) => m.id !== id);
      await savePartyState(state);
      return NextResponse.json(
        { ok: true, state },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 4. Update global settings (enabled, lobby_only, lobby_place_id, wait_for_character, settle_delay_seconds, main_script_url)
    if (action === "update_settings") {
      if (typeof body.enabled === "boolean") {
        state.enabled = body.enabled;
      }
      if (typeof body.lobby_only === "boolean") {
        state.lobby_only = body.lobby_only;
      }
      if (typeof body.lobby_place_id === "number") {
        state.lobby_place_id = Number(body.lobby_place_id);
      }
      if (typeof body.wait_for_character === "boolean") {
        state.wait_for_character = body.wait_for_character;
      }
      if (typeof body.settle_delay_seconds === "number") {
        state.settle_delay_seconds = Math.max(
          0,
          Math.min(30, Number(body.settle_delay_seconds))
        );
      }
      if (typeof body.main_script_url === "string" && body.main_script_url.trim()) {
        state.main_script_url = body.main_script_url.trim();
      }
      await savePartyState(state);
      return NextResponse.json(
        { ok: true, state },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 5. Sync client state (restores state if serverless instance cold-started)
    if (action === "sync_client_state") {
      const incomingState = body.state as PartySyncState | undefined;
      if (
        incomingState &&
        Array.isArray(incomingState.members) &&
        (incomingState.updated_at || 0) > (state.updated_at || 0)
      ) {
        state.enabled = Boolean(incomingState.enabled);
        state.lobby_only =
          typeof incomingState.lobby_only === "boolean"
            ? incomingState.lobby_only
            : true;
        state.lobby_place_id = Number(
          incomingState.lobby_place_id ?? 8304191830
        );
        state.wait_for_character = Boolean(incomingState.wait_for_character);
        state.settle_delay_seconds = Number(
          incomingState.settle_delay_seconds ?? 2
        );
        state.main_script_url =
          incomingState.main_script_url || state.main_script_url;
        state.members = incomingState.members;
        state.updated_at = incomingState.updated_at;
        globalThis.__ROBLOX_PARTY_SYNC_STATE__ = state;
        if (hasVercelKV()) {
          await kvCommand(["SET", KV_PARTY_KEY, JSON.stringify(state)]);
        }
      }
      return NextResponse.json(
        { ok: true, state },
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // 6. Reset to default 4 members
    if (action === "reset_defaults") {
      const def = createDefaultPartyState();
      def.updated_at = Math.floor(Date.now() / 1000);
      await savePartyState(def);
      return NextResponse.json(
        { ok: true, state: def },
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
