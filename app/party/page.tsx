"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface PartyMember {
  id: string;
  name: string;
  aliases: string[];
  enabled: boolean;
  note?: string;
  added_at: number;
}

interface PartySyncState {
  enabled: boolean;
  lobby_only: boolean;
  lobby_place_id: number;
  wait_for_character: boolean;
  settle_delay_seconds: number;
  main_script_url: string;
  members: PartyMember[];
  updated_at: number;
}

interface OnlineAccountBrief {
  user_id: number;
  username: string;
  display_name: string;
}

const LOCAL_PARTY_STATE_KEY = "nexus_party_sync_state_v1";

const DEFAULT_PARTY_STATE: PartySyncState = {
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

// ============================================================================
// MAIN PARTY SYNC PAGE COMPONENT
// ============================================================================

export default function PartySyncPage() {
  const [partyState, setPartyState] =
    useState<PartySyncState>(DEFAULT_PARTY_STATE);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // Add Member Form State
  const [newName, setNewName] = useState<string>("");
  const [newExtraAlias, setNewExtraAlias] = useState<string>("");
  const [newNote, setNewNote] = useState<string>("");

  // Editable Script URL State
  const [scriptUrlInput, setScriptUrlInput] = useState<string>(
    DEFAULT_PARTY_STATE.main_script_url
  );

  // Online Accounts from Telemetry Dashboard (for 1-click quick add)
  const [onlineAccounts, setOnlineAccounts] = useState<OnlineAccountBrief[]>(
    []
  );

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 3500);
  }, []);

  const persistLocal = useCallback((st: PartySyncState) => {
    try {
      localStorage.setItem(LOCAL_PARTY_STATE_KEY, JSON.stringify(st));
    } catch {
      // ignore
    }
  }, []);

  const loadData = useCallback(async () => {
    let localState: PartySyncState | null = null;
    try {
      const raw = localStorage.getItem(LOCAL_PARTY_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PartySyncState;
        if (parsed && Array.isArray(parsed.members)) {
          localState = parsed;
          setPartyState(parsed);
          setScriptUrlInput(parsed.main_script_url);
        }
      }
    } catch {
      // ignore
    }

    try {
      const res = await fetch("/api/party", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          ok: boolean;
          state?: PartySyncState;
        };
        if (data.ok && data.state) {
          const srvState = data.state;

          // If local state is newer (e.g. serverless cold start reset server to updated_at = 0), push local to server
          if (
            localState &&
            (localState.updated_at || 0) > (srvState.updated_at || 0)
          ) {
            setPartyState(localState);
            setScriptUrlInput(localState.main_script_url);
            await fetch("/api/party", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "sync_client_state",
                state: localState,
              }),
            });
          } else {
            setPartyState(srvState);
            setScriptUrlInput(srvState.main_script_url);
            persistLocal(srvState);
          }
        }
      }
    } catch {
      // fallback to local
    } finally {
      setLoading(false);
    }

    // Fetch active telemetry accounts for 1-click quick add
    try {
      const telRes = await fetch("/api/telemetry", { cache: "no-store" });
      if (telRes.ok) {
        const telData = (await telRes.json()) as {
          ok: boolean;
          accounts?: OnlineAccountBrief[];
        };
        if (telData.ok && Array.isArray(telData.accounts)) {
          setOnlineAccounts(telData.accounts);
        }
      }
    } catch {
      // ignore
    }
  }, [persistLocal]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeMembers = useMemo(
    () => partyState.members.filter((m) => m.enabled),
    [partyState.members]
  );

  // Accounts from Dashboard not yet in Party
  const unaddedDashboardAccounts = useMemo(() => {
    const existingSet = new Set<string>();
    partyState.members.forEach((m) => {
      existingSet.add(m.name.toLowerCase());
      m.aliases.forEach((a) => existingSet.add(a.toLowerCase()));
    });

    return onlineAccounts.filter(
      (acc) =>
        !existingSet.has(acc.username.toLowerCase()) &&
        !existingSet.has((acc.display_name || "").toLowerCase())
    );
  }, [onlineAccounts, partyState.members]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newName.trim().replace(/^@/, "");
    if (!cleanName) {
      showToast("⚠️ กรุณากรอกชื่อผู้เล่น");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_member",
          name: cleanName,
          extra_alias: newExtraAlias.trim(),
          note: newNote.trim(),
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        state?: PartySyncState;
      };
      if (data.ok && data.state) {
        setPartyState(data.state);
        persistLocal(data.state);
        setNewName("");
        setNewExtraAlias("");
        setNewNote("");
        showToast(`✅ เพิ่ม "${cleanName}" เข้าตี้เรียบร้อย!`);
      }
    } catch {
      showToast("❌ ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
    } finally {
      setSaving(false);
    }
  };

  const handleQuickAddFromDashboard = async (acc: OnlineAccountBrief) => {
    setSaving(true);
    try {
      const primary = acc.display_name || acc.username;
      const extra =
        acc.username.toLowerCase() !== primary.toLowerCase()
          ? acc.username
          : "";
      const res = await fetch("/api/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_member",
          name: primary,
          extra_alias: extra,
          note: `@${acc.username}`,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        state?: PartySyncState;
      };
      if (data.ok && data.state) {
        setPartyState(data.state);
        persistLocal(data.state);
        showToast(`✅ เพิ่ม ${primary} (@${acc.username}) เข้าตี้แล้ว!`);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleToggleMember = async (member: PartyMember) => {
    const nextEnabled = !member.enabled;
    const optimistic: PartySyncState = {
      ...partyState,
      updated_at: Math.floor(Date.now() / 1000),
      members: partyState.members.map((m) =>
        m.id === member.id ? { ...m, enabled: nextEnabled } : m
      ),
    };
    setPartyState(optimistic);
    persistLocal(optimistic);

    try {
      const res = await fetch("/api/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_member",
          id: member.id,
          enabled: nextEnabled,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        state?: PartySyncState;
      };
      if (data.ok && data.state) {
        setPartyState(data.state);
        persistLocal(data.state);
      }
    } catch {
      // ignore
    }
    showToast(
      nextEnabled
        ? `🟢 เปิดเช็คชื่อ ${member.name} ในตี้แล้ว`
        : `⚪ ข้ามการเช็คชื่อ ${member.name} ชั่วคราว`
    );
  };

  const handleRemoveMember = async (member: PartyMember) => {
    const optimistic: PartySyncState = {
      ...partyState,
      updated_at: Math.floor(Date.now() / 1000),
      members: partyState.members.filter((m) => m.id !== member.id),
    };
    setPartyState(optimistic);
    persistLocal(optimistic);

    try {
      const res = await fetch("/api/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_member",
          id: member.id,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        state?: PartySyncState;
      };
      if (data.ok && data.state) {
        setPartyState(data.state);
        persistLocal(data.state);
      }
    } catch {
      // ignore
    }
    showToast(`🗑️ ลบ ${member.name} ออกจากตี้แล้ว`);
  };

  const handleUpdateSettings = async (patch: Partial<PartySyncState>) => {
    const optimistic: PartySyncState = {
      ...partyState,
      ...patch,
      updated_at: Math.floor(Date.now() / 1000),
    };
    setPartyState(optimistic);
    persistLocal(optimistic);

    try {
      const res = await fetch("/api/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_settings",
          ...patch,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        state?: PartySyncState;
      };
      if (data.ok && data.state) {
        setPartyState(data.state);
        persistLocal(data.state);
      }
    } catch {
      // ignore
    }
    showToast("✅ บันทึกการตั้งค่าตี้เรียบร้อย");
  };

  const partyApiUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/party`
      : "https://nexuse-website.vercel.app/api/party";

  const cloudPartyLuaScript = `-- ==============================================================================
-- 🛡️ NEXUS CLOUD PARTY SYNC & AUTOEXEC LOADER (LIVE WEB SYNC v2.0)
-- • ดึงรายชื่อเพื่อนในตี้สดๆ จากเว็บ: ${partyApiUrl}
-- • เพิ่ม/ลบ/เปิด/ปิดชื่อเพื่อนบนหน้าเว็บได้ทันที ไม่ต้องแก้โค้ดในสคริปต์อีกต่อไป!
-- • รัน Tracker ส่งข้อมูลขึ้นเว็บทันทีตามปกติ 100%
-- ==============================================================================

if not game:IsLoaded() then
    game.Loaded:Wait()
end

local Players     = game:GetService("Players")
local HttpService = game:GetService("HttpService")
local GuiService  = game:GetService("GuiService")
local LocalPlayer = Players.LocalPlayer or Players.PlayerAdded:Wait()

local PARTY_API_URL = "${partyApiUrl}"
local CACHE_FILE    = "nexus_party_sync_cache.json"

-- ── 1. รันสคริปต์ Tracker ทันทีตามปกติ (ไม่รอเพื่อน) ─────────────────────────────
task.spawn(function()
    pcall(function()
        loadstring(game:HttpGet("https://cdn.jsdelivr.net/gh/PeeKillxa/AA_Macro@main/tracker.lua"))()
    end)
end)

-- ── 2. ระบบ Watchdog Heartbeat Bridge (สำหรับ Emu / ไม่กระทบ PC) ───────────────
task.spawn(function()
    pcall(function()
        local hbFile = "watchdog_heartbeat.txt"
        local rkFile = "executor_check_" .. tostring(LocalPlayer.Name) .. ".txt"
        local dcFile = "watchdog_disconnected.txt"
        local isDisc = false

        if delfile and isfile and isfile(dcFile) then
            pcall(delfile, dcFile)
        end

        local function pulse()
            if isDisc or not writefile then return end
            local now = tostring(os.time())
            pcall(writefile, hbFile, now .. "\\n")
            pcall(writefile, rkFile, "working:" .. now .. "\\n")
        end
        pulse()

        LocalPlayer.OnTeleport:Connect(function()
            isDisc = false
            if delfile and isfile and isfile(dcFile) then pcall(delfile, dcFile) end
            pulse()
        end)

        GuiService.ErrorMessageChanged:Connect(function(msg)
            pcall(function()
                local code = GuiService:GetErrorCode().Value
                local m = tostring(msg or ""):lower()
                if code == 285 or m:find("disconnectclientinitiated") or m:find("teleport") or m:find("joining") then
                    return
                end
                if code >= Enum.ConnectionError.DisconnectErrors.Value then
                    isDisc = true
                    if delfile and isfile and isfile(hbFile) then pcall(delfile, hbFile) end
                    if writefile then
                        pcall(writefile, dcFile, string.format("GuiService Error [Code %d]: %s\\n", code, tostring(msg)))
                    end
                end
            end)
        end)

        while task.wait(5) do
            if not isDisc then pulse() end
        end
    end)
end)

-- ── 3. ดึงรายชื่อตี้ล่าสุดจากหน้าเว็บ (พร้อมระบบ Auto-Restore & Fallback) ────────
local httpRequest = (syn and syn.request) or (http and http.request) or http_request or (fluxus and fluxus.request) or request

local FALLBACK_CONFIG = {
    enabled = true,
    lobby_only = true,
    lobby_place_id = 8304191830,
    wait_for_character = true,
    settle_delay_seconds = 2,
    main_script_url = "https://raw.githubusercontent.com/weziiotez-dev/xt-hub/main/crazy.lua",
    members = {
        { name = "JohnwickInwza7", aliases = { "johnwickinwza7", "johnwicklnwza7" }, enabled = true },
        { name = "Kenqu",          aliases = { "kenqu" },                            enabled = true },
        { name = "OBCXDI",         aliases = { "obcxdi" },                           enabled = true },
        { name = "Albatross",      aliases = { "albatross", "opxdmmd" },             enabled = true },
    },
    updated_at = 0
}

local function loadCachedConfig()
    if isfile and readfile and isfile(CACHE_FILE) then
        local ok, data = pcall(function()
            return HttpService:JSONDecode(readfile(CACHE_FILE))
        end)
        if ok and type(data) == "table" and type(data.members) == "table" then
            return data
        end
    end
    return nil
end

local function saveCachedConfig(cfg)
    if writefile then
        pcall(function()
            writefile(CACHE_FILE, HttpService:JSONEncode(cfg))
        end)
    end
end

local function fetchLivePartyConfig()
    local cached = loadCachedConfig()
    local ok, raw = pcall(function()
        return game:HttpGet(PARTY_API_URL .. "?t=" .. tostring(os.time()))
    end)

    if ok and raw and #raw > 10 then
        local decOk, res = pcall(function()
            return HttpService:JSONDecode(raw)
        end)
        if decOk and res and res.ok and type(res.state) == "table" then
            local srv = res.state
            -- ถ้าเซิร์ฟเวอร์เพิ่ง Cold-Start (updated_at == 0) แต่ในเครื่องมี Cache ที่ใหม่กว่า ให้ซิงค์กลับขึ้นเซิร์ฟเวอร์อัตโนมัติ
            if cached and (tonumber(cached.updated_at) or 0) > (tonumber(srv.updated_at) or 0) then
                if httpRequest then
                    pcall(function()
                        httpRequest({
                            Url = PARTY_API_URL,
                            Method = "POST",
                            Headers = { ["Content-Type"] = "application/json" },
                            Body = HttpService:JSONEncode({
                                action = "sync_client_state",
                                state = cached
                            })
                        })
                    end)
                end
                return cached
            end
            saveCachedConfig(srv)
            return srv
        end
    end

    return cached or FALLBACK_CONFIG
end

local function isPlayerLoaded(plr, requireChar)
    if not plr or not plr.Parent then return false end
    if not requireChar then return true end
    local char = plr.Character
    return (char and char:FindFirstChild("HumanoidRootPart")) ~= nil
end

local function verifyPartyInMap(cfg)
    if cfg.enabled == false then
        return true, 0, 0, {}
    end

    local activeMembers = {}
    for _, m in ipairs(cfg.members or {}) do
        if m.enabled ~= false then
            table.insert(activeMembers, m)
        end
    end

    if #activeMembers == 0 then
        return true, 0, 0, {}
    end

    local currentPlayers = Players:GetPlayers()
    local presentCount = 0
    local missingNames = {}
    local requireChar = (cfg.wait_for_character ~= false)

    for _, member in ipairs(activeMembers) do
        local matchedPlayer = nil
        local aliases = type(member.aliases) == "table" and member.aliases or {}
        local primaryLower = tostring(member.name or ""):lower()

        for _, p in ipairs(currentPlayers) do
            local uName = tostring(p.Name or ""):lower()
            local dName = tostring(p.DisplayName or ""):lower()

            if uName == primaryLower or dName == primaryLower then
                matchedPlayer = p
                break
            end

            for _, alias in ipairs(aliases) do
                local aLower = tostring(alias):lower()
                if uName == aLower or dName == aLower then
                    matchedPlayer = p
                    break
                end
            end
            if matchedPlayer then break end
        end

        if matchedPlayer and isPlayerLoaded(matchedPlayer, requireChar) then
            presentCount = presentCount + 1
        else
            table.insert(missingNames, tostring(member.name or "?"))
        end
    end

    return (presentCount == #activeMembers), presentCount, #activeMembers, missingNames
end

-- ── 4. ลูปตรวจสอบตี้ (ซิงค์รายชื่อจากเว็บอัตโนมัติทุกๆ 9 วินาทีระหว่างรอ) ──────────
task.spawn(function()
    local currentConfig = fetchLivePartyConfig()

    -- ตรวจสอบว่าอยู่ใน Lobby หรือไม่ (ถ้าเปิดโหมด lobby_only)
    local isLobbyOnly = (currentConfig.lobby_only ~= false)
    local targetLobbyId = tonumber(currentConfig.lobby_place_id) or 8304191830

    if isLobbyOnly and game.PlaceId ~= targetLobbyId then
        print(string.format("[PartySync] ⚔️ ไม่อยู่ใน Lobby (PlaceId: %s ~= %s) -> ข้ามการเช็คตี้ รันสคริปต์หลักทันที!", tostring(game.PlaceId), tostring(targetLobbyId)))
        local scriptUrl = tostring(currentConfig.main_script_url or "https://raw.githubusercontent.com/weziiotez-dev/xt-hub/main/crazy.lua")
        pcall(function()
            loadstring(game:HttpGet(scriptUrl))()
        end)
        return
    end

    local lastWebSync = tick()
    print("[PartySync] 🏠 ตรวจพบว่าอยู่ใน Lobby! ซิงค์รายชื่อตี้จากเว็บสำเร็จ... กำลังตรวจสอบเพื่อนในห้อง")

    while true do
        -- เผื่อมีการวาร์ปออกจาก Lobby ระหว่างรอ
        if isLobbyOnly and game.PlaceId ~= targetLobbyId then
            print("[PartySync] ⚔️ วาร์ปออกจาก Lobby แล้ว -> รันสคริปต์หลักทันที!")
            local scriptUrl = tostring(currentConfig.main_script_url or "https://raw.githubusercontent.com/weziiotez-dev/xt-hub/main/crazy.lua")
            pcall(function()
                loadstring(game:HttpGet(scriptUrl))()
            end)
            break
        end

        -- ดึงข้อมูลใหม่จากเว็บทุก 9 วินาที (เผื่อแก้ไขเพิ่ม/ลบคนบนหน้าเว็บกลางคัน)
        if tick() - lastWebSync >= 9 then
            lastWebSync = tick()
            currentConfig = fetchLivePartyConfig()
            isLobbyOnly = (currentConfig.lobby_only ~= false)
            targetLobbyId = tonumber(currentConfig.lobby_place_id) or 8304191830
        end

        local allReady, count, total, missing = verifyPartyInMap(currentConfig)
        if allReady then
            local delaySec = tonumber(currentConfig.settle_delay_seconds) or 2
            print(string.format("[PartySync] ✅ สมาชิกครบ %d/%d คนแล้ว! รอ %.1f วินาทีก่อนรันสคริปต์หลัก...", count, total, delaySec))
            if delaySec > 0 then
                task.wait(delaySec)
            end

            local stillReady = verifyPartyInMap(currentConfig)
            if stillReady then
                local scriptUrl = tostring(currentConfig.main_script_url or "https://raw.githubusercontent.com/weziiotez-dev/xt-hub/main/crazy.lua")
                print("[PartySync] 🚀 รันสคริปต์หลัก: " .. scriptUrl)
                pcall(function()
                    loadstring(game:HttpGet(scriptUrl))()
                end)
                break
            end
        else
            print(string.format("[PartySync] ⏸️ ยังไม่ครบตี้ (%d/%d) — รอ: %s", count, total, table.concat(missing, ", ")))
        end

        task.wait(1.5)
    end
end)`;

  const handleCopyScript = () => {
    navigator.clipboard.writeText(cloudPartyLuaScript);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
    showToast("📋 คัดลอกโค้ด Autoexec ที่เชื่อมกับเว็บเรียบร้อย!");
  };

  return (
    <div className="min-h-screen bg-[#070913] text-slate-100 selection:bg-purple-500/30 selection:text-purple-200">
      {/* Subtle Ambient Glow */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-gradient-to-b from-purple-500/[0.07] via-cyan-500/[0.03] to-transparent" />

      {/* Toast Notification */}
      {toastMsg && (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl border border-purple-400/40 bg-slate-900/95 px-4 py-3 text-sm font-semibold text-purple-200 shadow-2xl backdrop-blur-xl">
          {toastMsg}
        </div>
      )}

      <main className="relative z-10 mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* ===================================================================
            HERO BANNER: MASTER PARTY GUARD STATUS
        =================================================================== */}
        <section
          className={`rounded-2xl border p-5 sm:p-6 transition-all ${
            partyState.enabled
              ? "border-purple-500/40 bg-gradient-to-r from-purple-950/45 via-slate-900/85 to-cyan-950/30 shadow-lg shadow-purple-500/10"
              : "border-amber-500/35 bg-gradient-to-r from-amber-950/35 via-slate-900/85 to-slate-900/80"
          }`}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-0.5 text-xs font-bold text-purple-300">
                <span>🛡️ CLOUD PARTY SYNC GUARD</span>
              </div>

              <h1 className="text-xl sm:text-2xl font-extrabold text-white">
                {partyState.enabled
                  ? `🟢 เปิดระบบเช็คตี้: ต้องอยู่ในแมพครบ ${activeMembers.length} คนถึงจะรันสคริปต์`
                  : "🟠 ปิดการเช็คตี้ชั่วคราว (รันสคริปต์ทันทีเมื่อเข้าแมพ)"}
              </h1>

              <p className="text-xs sm:text-sm text-slate-400">
                {partyState.enabled ? (
                  <>
                    รายชื่อที่ต้องอยู่ครบในแมพตอนนี้:{" "}
                    <span className="font-bold text-cyan-300">
                      {activeMembers.length > 0
                        ? activeMembers.map((m) => m.name).join(", ")
                        : "ยังไม่มีรายชื่อที่เปิดใช้งาน"}
                    </span>
                  </>
                ) : (
                  "ขณะนี้สคริปต์ในเกมจะไม่รอเพื่อนและจะรันสคริปต์หลักทันทีที่โหลดเข้าแมพ"
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                onClick={() =>
                  handleUpdateSettings({ enabled: !partyState.enabled })
                }
                className={`rounded-xl px-4 py-3 text-xs sm:text-sm font-extrabold transition shadow-lg ${
                  partyState.enabled
                    ? "bg-amber-500/20 border border-amber-400/40 text-amber-200 hover:bg-amber-500/30"
                    : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                }`}
              >
                {partyState.enabled
                  ? "⏸️ ปิดการเช็คตี้ชั่วคราว"
                  : "🟢 เปิดใช้งานระบบเช็คตี้"}
              </button>
            </div>
          </div>
        </section>

        {/* ===================================================================
            MAIN GRID: LEFT (ADD & SETTINGS) + RIGHT (PARTY MEMBER LIST)
        =================================================================== */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* LEFT COLUMN: ADD MEMBER FORM + QUICK ADD (5 Cols) */}
          <div className="lg:col-span-5 space-y-5">
            {/* Add New Member Form */}
            <form
              onSubmit={handleAddMember}
              className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 sm:p-6 space-y-4"
            >
              <div>
                <h2 className="text-base sm:text-lg font-extrabold text-white">
                  ➕ เพิ่มชื่อไอดีเข้าตี้
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  ใส่ได้ทั้งชื่อเล่น (DisplayName) หรือชื่อไอดี (@Username) ระบบดึงไปเช็คในเกมให้อัตโนมัติทันที
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                  ชื่อผู้เล่น (Username หรือ DisplayName) *
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="เช่น JohnwickInwza7, Kenqu, Albatross..."
                  className="w-full rounded-xl border border-white/15 bg-slate-950 px-3.5 py-2.5 text-sm font-bold text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                  ชื่อ @Username สำรอง (ไม่บังคับ)
                </label>
                <input
                  type="text"
                  value={newExtraAlias}
                  onChange={(e) => setNewExtraAlias(e.target.value)}
                  placeholder="เช่น OPXDMMD (กรณีตั้งชื่อเล่นคนละชื่อ)"
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3.5 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                  หมายเหตุเครื่อง / จอ (ไม่บังคับ)
                </label>
                <input
                  type="text"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="เช่น บนคอม PC, จอ Android Device-4..."
                  className="w-full rounded-xl border border-white/10 bg-slate-950 px-3.5 py-2 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-purple-400 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-xl bg-gradient-to-r from-purple-500 to-cyan-500 py-3 text-sm font-extrabold text-white shadow-lg shadow-purple-500/20 hover:opacity-95 transition disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "➕ เพิ่มรายชื่อเข้าตี้"}
              </button>
            </form>

            {/* Quick Add from Live Telemetry Dashboard */}
            {unaddedDashboardAccounts.length > 0 && (
              <div className="rounded-2xl border border-cyan-500/25 bg-slate-900/75 p-5 space-y-3">
                <div>
                  <h3 className="text-sm font-extrabold text-cyan-300 flex items-center gap-1.5">
                    <span>⚡</span>
                    <span>ดึงชื่อจากบอทบนหน้า Dashboard (คลิกเดียวเพิ่มเลย)</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    พบไอดีบนหน้าเว็บที่ยังไม่ได้อยู่ในรายชื่อตี้ กดเพื่อเพิ่มเข้าตี้ได้ทันที:
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {unaddedDashboardAccounts.map((acc) => (
                    <button
                      key={acc.user_id}
                      type="button"
                      onClick={() => handleQuickAddFromDashboard(acc)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20 transition"
                    >
                      <span>＋</span>
                      <span>
                        {acc.display_name || acc.username} (@{acc.username})
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Advanced Party Settings */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 space-y-4">
              <h3 className="text-sm font-extrabold text-white">
                ⚙️ ตั้งค่าการทำงานของสคริปต์เมื่อครบตี้
              </h3>

              {/* Lobby Only Mode */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <div>
                  <p className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>🏠</span>
                    <span>เช็คเฉพาะใน Lobby เท่านั้น (Lobby Only)</span>
                  </p>
                  <p className="text-[11px] text-slate-400">
                    แมพต่อสู้ (Combat/Dungeon) จะรันสคริปต์หลักทันทีโดยไม่ต้องรอเช็คตี้ (Lobby PlaceId: {partyState.lobby_place_id || 8304191830})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSettings({
                      lobby_only: partyState.lobby_only === false ? true : false,
                    })
                  }
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${
                    partyState.lobby_only !== false
                      ? "bg-purple-500/20 border border-purple-400/40 text-purple-300"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {partyState.lobby_only !== false ? "ON" : "OFF"}
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/70 p-3">
                <div>
                  <p className="text-xs font-bold text-white">
                    รอตัวละคร (Character) โหลดเกิดในแมพครบทุกคน
                  </p>
                  <p className="text-[11px] text-slate-400">
                    ป้องกันคอมโหลดไวกว่า Emu แล้วรันสคริปต์ก่อนที่จอ Emu จะหลุดหน้าโหลดเทา
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleUpdateSettings({
                      wait_for_character: !partyState.wait_for_character,
                    })
                  }
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-extrabold transition ${
                    partyState.wait_for_character
                      ? "bg-emerald-500/20 border border-emerald-400/40 text-emerald-300"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {partyState.wait_for_character ? "ON" : "OFF"}
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-300">
                  ลิงก์สคริปต์หลักที่จะรันเมื่อเพื่อนครบตี้:
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={scriptUrlInput}
                    onChange={(e) => setScriptUrlInput(e.target.value)}
                    className="flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-xs font-mono text-cyan-200 focus:border-cyan-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateSettings({
                        main_script_url: scriptUrlInput.trim(),
                      })
                    }
                    className="rounded-xl border border-cyan-400/40 bg-cyan-500/20 px-3.5 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/30 transition"
                  >
                    บันทึก
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: PARTY MEMBER LIST + SCRIPT COPY BOX (7 Cols) */}
          <div className="lg:col-span-7 space-y-5">
            {/* Party Members List */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base sm:text-lg font-extrabold text-white">
                    👥 รายชื่อสมาชิกในตี้ ({activeMembers.length} /{" "}
                    {partyState.members.length} คนที่เปิดเช็ค)
                  </h2>
                  <p className="text-xs text-slate-400">
                    ถ้าวันไหนใครไม่ได้ลงด้วย กดปุ่ม &ldquo;ข้ามชั่วคราว&rdquo; หรือกดลบออกได้เลย สคริปต์ในเกมจะอัปเดตตามทันที
                  </p>
                </div>
              </div>

              {loading ? (
                <div className="py-10 text-center text-sm text-slate-400">
                  กำลังโหลดรายชื่อตี้...
                </div>
              ) : partyState.members.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/15 bg-slate-950/40 p-10 text-center space-y-2">
                  <div className="text-3xl">👥</div>
                  <p className="text-sm font-bold text-white">
                    ยังไม่มีรายชื่อในตี้
                  </p>
                  <p className="text-xs text-slate-400">
                    เพิ่มชื่อเพื่อนจากฟอร์มด้านซ้ายเพื่อให้สคริปต์เช็คก่อนรัน
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {partyState.members.map((member, index) => (
                    <div
                      key={member.id}
                      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-4 transition ${
                        member.enabled
                          ? "border-purple-500/30 bg-slate-950/80"
                          : "border-white/5 bg-slate-950/35 opacity-60"
                      }`}
                    >
                      <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black text-sm ${
                            member.enabled
                              ? "bg-purple-500/20 border border-purple-400/40 text-purple-200"
                              : "bg-slate-800 text-slate-500"
                          }`}
                        >
                          #{index + 1}
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-extrabold text-white">
                              {member.name}
                            </span>
                            {member.enabled ? (
                              <span className="rounded-md border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                                🟢 ต้องอยู่ในแมพ
                              </span>
                            ) : (
                              <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                                ⚪ ข้ามชั่วคราว
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span className="font-mono text-[11px] text-cyan-300/90">
                              ตรงกับชื่อ: {member.aliases.join(", ")}
                            </span>
                            {member.note && (
                              <span className="text-slate-500">
                                • {member.note}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => handleToggleMember(member)}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                            member.enabled
                              ? "border-amber-400/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                              : "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
                          }`}
                        >
                          {member.enabled ? "ข้ามชั่วคราว" : "เปิดเช็คชื่อนี้"}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member)}
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/25 transition"
                        >
                          ลบ
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Autoexec Lua Code Box */}
            <div className="rounded-2xl border border-cyan-500/30 bg-slate-900/80 p-5 sm:p-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-white">
                    📜 โค้ด Autoexec เชื่อมต่อหน้าเว็บอัตโนมัติ (ใส่ครั้งเดียวจบ!)
                  </h3>
                  <p className="text-xs text-slate-400">
                    ใส่โค้ดนี้ไว้ใน Autoexec บนคอมและใน Emu ได้เลย เวลาเพิ่มหรือลบชื่อเพื่อนในหน้าเว็บนี้ สคริปต์จะดึงรายชื่อใหม่ไปใช้เองโดยไม่ต้องแก้ไฟล์ในเครื่องอีก
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleCopyScript}
                  className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-xs font-extrabold text-emerald-200 hover:bg-emerald-500/30 transition"
                >
                  {copiedCode ? "✓ คัดลอกโค้ดแล้ว!" : "📋 คัดลอกโค้ด Autoexec"}
                </button>
              </div>

              <pre className="max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-slate-950 p-3.5 text-[11px] font-mono text-cyan-200 leading-relaxed">
                <code>{cloudPartyLuaScript}</code>
              </pre>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
