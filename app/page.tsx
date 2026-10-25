"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface AccountTelemetry {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  account_age: number;
  game_name: string;
  place_id: number;
  job_id: string;
  status: string;
  effective_status?: "ONLINE" | "OFFLINE";
  level: number;
  gems: number;
  gold: number;
  extra_stats: Record<string, number | string | boolean>;
  ping: number;
  fps: number;
  uptime_seconds: number;
  updated_at: number;
  server_updated_at?: number;
  seconds_since_update?: number;
  previous_gems?: number;
  gems_delta?: number;
  last_gem_gain_at?: number;
}

interface TelemetryResponse {
  ok: boolean;
  server_time: number;
  offline_timeout_seconds: number;
  storage_mode: string;
  summary: {
    total_accounts: number;
    online_count: number;
    offline_count: number;
    total_gems: number;
    total_gold: number;
    total_uptime_seconds: number;
  };
  accounts: AccountTelemetry[];
}

interface ToastAlert {
  id: string;
  type: "gem_gain" | "offline" | "online" | "info";
  title: string;
  message: string;
  timestamp: number;
}

type SortOption = "gems_desc" | "level_desc" | "online_first" | "gold_desc";
type StatusFilter = "ALL" | "ONLINE" | "OFFLINE";

// ============================================================================
// WEB AUDIO API SOUND SYNTHESIZER (No external MP3 required)
// ============================================================================

class CyberAudioEngine {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // Play Crystal Chime when Gems increase
  public playGemChime() {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const notes = [1046.5, 1318.5, 1567.98, 2093.0]; // C6, E6, G6, C7
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now + idx * 0.065);

      gain.gain.setValueAtTime(0.001, now + idx * 0.065);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.065 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.065 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + idx * 0.065);
      osc.stop(now + idx * 0.065 + 0.36);
    });
  }

  // Play Cyberpunk Warning Siren when an Account goes OFFLINE
  public playOfflineAlert() {
    const ctx = this.getContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const pulses = [0, 0.22];
    pulses.forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(440, now + offset);
      osc.frequency.linearRampToValueAtTime(260, now + offset + 0.18);

      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + offset);
      osc.stop(now + offset + 0.21);
    });
  }
}

// ============================================================================
// FORMATTING UTILITIES
// ============================================================================

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n || 0));
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return formatNumber(n);
}

function formatUptime(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds || 0));
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = sec % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatRelativeThaiTime(secondsAgo: number): string {
  if (secondsAgo <= 10) return "เมื่อสักครู่";
  if (secondsAgo < 60) return `${secondsAgo} วินาทีที่แล้ว`;
  const minutes = Math.floor(secondsAgo / 60);
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `${days} วันที่แล้ว`;
}

function generateFallbackAvatarSvg(username: string): string {
  const initials = (username || "RB").slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#06b6d4" />
        <stop offset="50%" stop-color="#8b5cf6" />
        <stop offset="100%" stop-color="#10b981" />
      </linearGradient>
    </defs>
    <rect width="150" height="150" rx="32" fill="#0f172a" />
    <circle cx="75" cy="75" r="68" fill="none" stroke="url(#g)" stroke-width="4" opacity="0.7" />
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#e2e8f0" font-family="sans-serif" font-weight="800" font-size="48">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ============================================================================
// MAIN DASHBOARD PAGE COMPONENT
// ============================================================================

export default function RobloxFarmDashboardPage() {
  const [accounts, setAccounts] = useState<AccountTelemetry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<string>("in-memory");

  // Controls State
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortOption>("gems_desc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(5);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [countdown, setCountdown] = useState<number>(5);

  // Visual Flash & Delta State (user_id -> delta amount)
  const [gemFlashMap, setGemFlashMap] = useState<Record<number, number>>({});
  const [sessionGemGain, setSessionGemGain] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastAlert[]>([]);
  const [showLuauModal, setShowLuauModal] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(() =>
    Math.floor(Date.now() / 1000)
  );

  // Refs for comparing previous poll state without re-triggering effects
  const prevAccountsRef = useRef<Map<number, { gems: number; isOnline: boolean }>>(
    new Map()
  );
  const isFirstFetchRef = useRef<boolean>(true);
  const audioEngineRef = useRef<CyberAudioEngine | null>(null);

  useEffect(() => {
    audioEngineRef.current = new CyberAudioEngine();
  }, []);

  // Tick every 1s to keep relative timestamps and 60s heartbeat timeout live
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTick(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const pushToast = useCallback(
    (type: ToastAlert["type"], title: string, message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [
        { id, type, title, message, timestamp: Date.now() },
        ...prev.slice(0, 4),
      ]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5500);
    },
    []
  );

  // Determine real-time online status on client as well (60 seconds threshold)
  const computeIsOnline = useCallback(
    (acc: AccountTelemetry, currentSec: number): boolean => {
      if (acc.status?.toUpperCase() === "OFFLINE") return false;
      const refTime = acc.server_updated_at || acc.updated_at || currentSec;
      const age = Math.max(0, currentSec - refTime);
      return age <= 60;
    },
    []
  );

  // Fetch Telemetry from /api/telemetry
  const fetchTelemetry = useCallback(
    async (silent = false) => {
      if (!silent) setIsRefreshing(true);
      try {
        const res = await fetch("/api/telemetry", {
          method: "GET",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as TelemetryResponse;
        if (!data.ok) {
          throw new Error("Telemetry response not OK");
        }

        const currentSec = data.server_time || Math.floor(Date.now() / 1000);
        setNowTick(currentSec);
        setStorageMode(data.storage_mode || "in-memory");

        const incoming = data.accounts || [];
        const newFlashEntries: Record<number, number> = {};
        let totalNewGemsThisPoll = 0;
        let shouldPlayGemSound = false;
        let shouldPlayOfflineSound = false;

        incoming.forEach((acc) => {
          const isNowOnline =
            acc.effective_status === "ONLINE" &&
            computeIsOnline(acc, currentSec);
          const prev = prevAccountsRef.current.get(acc.user_id);

          if (prev && !isFirstFetchRef.current) {
            // Check if Gems increased
            if (acc.gems > prev.gems) {
              const diff = acc.gems - prev.gems;
              newFlashEntries[acc.user_id] = diff;
              totalNewGemsThisPoll += diff;
              shouldPlayGemSound = true;
              pushToast(
                "gem_gain",
                `💎 +${formatNumber(diff)} Gems!`,
                `@${acc.username} (${acc.display_name}) ได้รับเพชรเพิ่ม!`
              );
            }

            // Check if Account dropped from ONLINE -> OFFLINE
            if (prev.isOnline && !isNowOnline) {
              shouldPlayOfflineSound = true;
              pushToast(
                "offline",
                `🔴 ไอดีหลุด (OFFLINE)!`,
                `@${acc.username} ไม่ส่ง Heartbeat เกิน 60 วินาที`
              );
            } else if (!prev.isOnline && isNowOnline) {
              pushToast(
                "online",
                `🟢 กลับเข้าเกมแล้ว (ONLINE)`,
                `@${acc.username} เชื่อมต่อสำเร็จ`
              );
            }
          }

          prevAccountsRef.current.set(acc.user_id, {
            gems: acc.gems,
            isOnline: isNowOnline,
          });
        });

        isFirstFetchRef.current = false;

        if (Object.keys(newFlashEntries).length > 0) {
          setGemFlashMap((prev) => ({ ...prev, ...newFlashEntries }));
          setSessionGemGain((prev) => prev + totalNewGemsThisPoll);
          setTimeout(() => {
            setGemFlashMap((prev) => {
              const next = { ...prev };
              Object.keys(newFlashEntries).forEach((k) => {
                delete next[Number(k)];
              });
              return next;
            });
          }, 4200);
        }

        if (audioEnabled) {
          if (shouldPlayOfflineSound) {
            audioEngineRef.current?.playOfflineAlert();
          } else if (shouldPlayGemSound) {
            audioEngineRef.current?.playGemChime();
          }
        }

        setAccounts(incoming);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "ไม่สามารถเชื่อมต่อ API ได้"
        );
      } finally {
        setLoading(false);
        setIsRefreshing(false);
        setCountdown(refreshIntervalSec);
      }
    },
    [audioEnabled, computeIsOnline, pushToast, refreshIntervalSec]
  );

  // Initial Fetch
  useEffect(() => {
    fetchTelemetry(false);
  }, [fetchTelemetry]);

  // Auto-Refresh Polling Loop
  useEffect(() => {
    if (!autoRefresh) return;
    setCountdown(refreshIntervalSec);

    const countdownInterval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchTelemetry(true);
          return refreshIntervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdownInterval);
  }, [autoRefresh, refreshIntervalSec, fetchTelemetry]);

  // Simulator / Management Actions
  const handleSimulatorAction = async (
    action: "seed_demo" | "simulate_gem_gain" | "simulate_disconnect"
  ) => {
    setIsRefreshing(true);
    try {
      await fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await fetchTelemetry(true);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDeleteAccount = async (userId: number, username: string) => {
    await fetch(`/api/telemetry?user_id=${userId}`, { method: "DELETE" });
    prevAccountsRef.current.delete(userId);
    pushToast("info", "ลบรายการสำเร็จ", `ลบ @${username} ออกจากแดชบอร์ดแล้ว`);
    await fetchTelemetry(true);
  };

  const handleClearOffline = async () => {
    await fetch(`/api/telemetry?mode=offline`, { method: "DELETE" });
    pushToast("info", "ล้างไอดี Offline แล้ว", "ลบรายการไอดีที่หลุดออกทั้งหมด");
    await fetchTelemetry(true);
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Enrich accounts with live 1-second accuracy for 60s timeout
  const enrichedAccounts = useMemo(() => {
    return accounts.map((acc) => {
      const refTime = acc.server_updated_at || acc.updated_at || nowTick;
      const secondsSinceUpdate = Math.max(0, nowTick - refTime);
      const isOnline =
        acc.status?.toUpperCase() !== "OFFLINE" && secondsSinceUpdate <= 60;
      return {
        ...acc,
        effective_status: (isOnline ? "ONLINE" : "OFFLINE") as
          | "ONLINE"
          | "OFFLINE",
        seconds_since_update: secondsSinceUpdate,
      };
    });
  }, [accounts, nowTick]);

  // Compute Live Summary Metrics
  const liveSummary = useMemo(() => {
    return enrichedAccounts.reduce(
      (acc, item) => {
        acc.total_gems += item.gems || 0;
        acc.total_gold += item.gold || 0;
        acc.total_uptime_seconds += item.uptime_seconds || 0;
        if (item.effective_status === "ONLINE") {
          acc.online_count += 1;
        } else {
          acc.offline_count += 1;
        }
        return acc;
      },
      {
        total_accounts: enrichedAccounts.length,
        online_count: 0,
        offline_count: 0,
        total_gems: 0,
        total_gold: 0,
        total_uptime_seconds: 0,
      }
    );
  }, [enrichedAccounts]);

  // Filter & Sort Accounts
  const filteredAndSortedAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const filtered = enrichedAccounts.filter((acc) => {
      if (statusFilter === "ONLINE" && acc.effective_status !== "ONLINE")
        return false;
      if (statusFilter === "OFFLINE" && acc.effective_status !== "OFFLINE")
        return false;

      if (!q) return true;
      return (
        acc.username?.toLowerCase().includes(q) ||
        acc.display_name?.toLowerCase().includes(q) ||
        acc.game_name?.toLowerCase().includes(q) ||
        String(acc.user_id).includes(q)
      );
    });

    return filtered.sort((a, b) => {
      if (sortBy === "gems_desc") return (b.gems || 0) - (a.gems || 0);
      if (sortBy === "level_desc") return (b.level || 0) - (a.level || 0);
      if (sortBy === "gold_desc") return (b.gold || 0) - (a.gold || 0);
      if (sortBy === "online_first") {
        if (a.effective_status !== b.effective_status) {
          return a.effective_status === "ONLINE" ? -1 : 1;
        }
        return (b.gems || 0) - (a.gems || 0);
      }
      return 0;
    });
  }, [enrichedAccounts, searchQuery, statusFilter, sortBy]);

  const endpointUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/telemetry`
      : "https://your-project.vercel.app/api/telemetry";

  const sampleLuauScript = `-- ============================================================
-- ROBLOX MULTI-ACCOUNT FARM TELEMETRY SENDER (Executor Luau)
-- วางสคริปต์นี้ใน Auto-Execute ของ Executor ทุกจอ
-- ============================================================
local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local Stats = game:GetService("Stats")
local MarketplaceService = game:GetService("MarketplaceService")

local API_URL = "${endpointUrl}"
local SEND_INTERVAL = 15 -- ส่งข้อมูลทุกๆ 15 วินาที (ถ้าเกิน 60 วินาทีเว็บจะขึ้น OFFLINE)
local startTime = os.time()

local httpRequest = (syn and syn.request) or (http and http.request) or http_request or (fluxus and fluxus.request) or request
if not httpRequest then
    warn("[FarmDashboard] Executor ของคุณไม่รองรับฟังก์ชัน http_request")
    return
end

local player = Players.LocalPlayer or Players.PlayerAdded:Wait()

-- ดึงชื่อแมพเกมอัตโนมัติ
local gameName = "Roblox Game"
pcall(function()
    local info = MarketplaceService:GetProductInfo(game.PlaceId)
    if info and info.Name then gameName = info.Name end
end)

-- ฟังก์ชันคำนวณ FPS ปัจจุบัน
local currentFps = 60
game:GetService("RunService").RenderStepped:Connect(function(dt)
    if dt > 0 then
        currentFps = math.clamp(math.floor(1 / dt), 1, 240)
    end
end)

-- ฟังก์ชันอ่านค่า Gems / Gold / Level จาก leaderstats หรือ Attribute
local function getStatValue(names, fallback)
    for _, folderName in ipairs({"leaderstats", "Stats", "Data", "PlayerData"}) do
        local folder = player:FindFirstChild(folderName)
        if folder then
            for _, name in ipairs(names) do
                local obj = folder:FindFirstChild(name)
                if obj and obj.Value ~= nil then
                    return tonumber(obj.Value) or fallback
                end
            end
        end
    end
    for _, name in ipairs(names) do
        local attr = player:GetAttribute(name)
        if attr ~= nil then return tonumber(attr) or fallback end
    end
    return fallback
end

local function sendTelemetry()
    local pingMs = 50
    pcall(function()
        pingMs = math.floor(Stats.Network.ServerStatsItem["Data Ping"]:GetValue())
    end)

    local payload = {
        user_id = player.UserId,
        username = player.Name,
        display_name = player.DisplayName,
        avatar_url = string.format(
            "https://www.roblox.com/headshot-thumbnail/image?userId=%d&width=150&height=150&format=png",
            player.UserId
        ),
        account_age = player.AccountAge,
        game_name = gameName,
        place_id = game.PlaceId,
        job_id = game.JobId ~= "" and game.JobId or "private-server",
        status = "ONLINE",
        level = getStatValue({"Level", "Lvl", "lv"}, 1),
        gems = getStatValue({"Gems", "Gem", "Jewels", "Emeralds"}, 0),
        gold = getStatValue({"Gold", "Coins", "Cash", "Yen", "Beli"}, 0),
        extra_stats = {
            rerolls = getStatValue({"Rerolls", "TraitRerolls", "Spins"}, 0)
        },
        ping = pingMs,
        fps = currentFps,
        uptime_seconds = os.time() - startTime,
        updated_at = os.time()
    }

    pcall(function()
        httpRequest({
            Url = API_URL,
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json"
            },
            Body = HttpService:JSONEncode(payload)
        })
    end)
end

-- ส่งครั้งแรกทันทีและวนลูปส่งต่อเนื่อง
task.spawn(function()
    while task.wait(SEND_INTERVAL) do
        sendTelemetry()
    end
end)
sendTelemetry()
print("[FarmDashboard] Telemetry Connected -> " .. API_URL)`;

  return (
    <div className="relative min-h-screen bg-[#06060f] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200 overflow-x-hidden">
      {/* ===================================================================
          CYBERPUNK AMBIENT BACKGROUND GLOWS & GRID
      =================================================================== */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-purple-700/20 blur-[140px]" />
        <div className="absolute top-1/4 -right-40 h-[480px] w-[480px] rounded-full bg-cyan-500/15 blur-[140px]" />
        <div className="absolute -bottom-48 left-1/3 h-[500px] w-[500px] rounded-full bg-emerald-500/10 blur-[150px]" />
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #38bdf8 1px, transparent 1px), linear-gradient(to bottom, #38bdf8 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      {/* ===================================================================
          FLOATING TOAST NOTIFICATIONS (Gem Gain & Offline Alerts)
      =================================================================== */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2rem)] pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 backdrop-blur-xl shadow-2xl transition-all duration-300 ${
              t.type === "gem_gain"
                ? "bg-emerald-950/85 border-emerald-400/50 text-emerald-100 shadow-emerald-500/20"
                : t.type === "offline"
                ? "bg-rose-950/90 border-rose-500/60 text-rose-100 shadow-rose-500/25"
                : t.type === "online"
                ? "bg-cyan-950/85 border-cyan-400/50 text-cyan-100 shadow-cyan-500/20"
                : "bg-slate-900/90 border-purple-500/40 text-slate-100"
            }`}
          >
            <div className="text-lg leading-none mt-0.5">
              {t.type === "gem_gain"
                ? "💎"
                : t.type === "offline"
                ? "🚨"
                : t.type === "online"
                ? "🟢"
                : "⚡"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold tracking-wide">{t.title}</p>
              <p className="text-xs opacity-85 truncate mt-0.5">{t.message}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ===================================================================
          MAIN CONTAINER
      =================================================================== */}
      <main className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* TOP BRANDING & QUICK SIMULATION BAR */}
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between rounded-3xl border border-white/10 bg-slate-950/60 p-5 sm:p-6 backdrop-blur-2xl shadow-[0_0_50px_-12px_rgba(139,92,246,0.25)]">
          <div className="flex items-start sm:items-center gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 via-purple-600 to-emerald-500 p-[1.5px] shadow-lg shadow-cyan-500/20">
              <div className="flex h-full w-full items-center justify-center rounded-[14px] bg-[#090919]">
                <span className="text-2xl">🤖</span>
              </div>
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-[#090919]" />
              </span>
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-300">
                  NEXUS TELEMETRY v2.4
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-purple-400/30 bg-purple-500/10 px-2.5 py-0.5 text-[11px] font-medium text-purple-300">
                  Storage: {storageMode === "vercel-kv" ? "Vercel KV Redis" : "In-Memory Cache"}
                </span>
              </div>
              <h1 className="mt-1 text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-cyan-200 to-purple-300 bg-clip-text text-transparent">
                Roblox Multi-Account Farm Dashboard
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                ระบบมอนิเตอร์บอทฟาร์มเรียลไทม์ เช็คเพชร ทอง เลเวล และสถานะออนไลน์จากทุกที่ทั่วโลก
              </p>
            </div>
          </div>

          {/* Action / Simulator Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowLuauModal(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-3.5 py-2 text-xs sm:text-sm font-semibold text-cyan-200 hover:bg-cyan-500/25 hover:border-cyan-300 transition shadow-lg shadow-cyan-500/10"
            >
              <span>📜</span>
              <span>รับสคริปต์ Luau</span>
            </button>

            <button
              onClick={() => handleSimulatorAction("seed_demo")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-purple-400/30 bg-purple-500/15 px-3 py-2 text-xs sm:text-sm font-semibold text-purple-200 hover:bg-purple-500/25 transition"
              title="สร้างข้อมูลจำลอง 4 ไอดีเพื่อทดสอบระบบ"
            >
              <span>⚡</span>
              <span>โหลดไอดีตัวอย่าง</span>
            </button>

            <button
              onClick={() => handleSimulatorAction("simulate_gem_gain")}
              disabled={enrichedAccounts.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-xs sm:text-sm font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40 transition"
              title="จำลองเหตุการณ์เพชรเพิ่มขึ้นเพื่อดูเอฟเฟกต์สีเขียวและเสียงแจ้งเตือน"
            >
              <span>+💎</span>
              <span className="hidden sm:inline">จำลองเพชรเข้า</span>
            </button>

            <button
              onClick={() => handleSimulatorAction("simulate_disconnect")}
              disabled={liveSummary.online_count === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/30 bg-rose-500/15 px-3 py-2 text-xs sm:text-sm font-semibold text-rose-200 hover:bg-rose-500/25 disabled:opacity-40 transition"
              title="จำลองเหตุการณ์ไอดีหลุด (Offline) เพื่อทดสอบเสียงเตือน"
            >
              <span>🔴</span>
              <span className="hidden sm:inline">จำลองจอหลุด</span>
            </button>
          </div>
        </header>

        {/* ===================================================================
            TOP SUMMARY HEADER BAR (4 Neon Glass Cards)
        =================================================================== */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* 1. TOTAL COMBINED GEMS */}
          <div className="group relative overflow-hidden rounded-3xl border border-cyan-500/30 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-cyan-950/40 p-5 backdrop-blur-xl shadow-[0_0_35px_-10px_rgba(6,182,212,0.3)]">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-cyan-500/15 blur-2xl group-hover:bg-cyan-400/25 transition" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-300/90">
                Total Combined Gems
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-500/15 text-xl shadow-inner">
                💎
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2.5">
              <p className="text-2xl sm:text-3xl font-black tracking-tight text-white tabular-nums drop-shadow-[0_0_12px_rgba(34,211,238,0.35)]">
                {formatNumber(liveSummary.total_gems)}
              </p>
              {sessionGemGain > 0 && (
                <span className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300 animate-pulse">
                  +{formatCompact(sessionGemGain)}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-400 flex items-center justify-between">
              <span>ยอดเพชรรวมทุกไอดี</span>
              <span className="font-mono text-cyan-300">
                {formatCompact(liveSummary.total_gems)}
              </span>
            </p>
          </div>

          {/* 2. ONLINE ACCOUNTS STATUS */}
          <div className="group relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-emerald-950/40 p-5 backdrop-blur-xl shadow-[0_0_35px_-10px_rgba(16,185,129,0.3)]">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-emerald-500/15 blur-2xl group-hover:bg-emerald-400/25 transition" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-300/90">
                Active Farm Nodes
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-500/15 text-lg">
                🟢
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <p className="text-2xl sm:text-3xl font-black tracking-tight text-white tabular-nums">
                Online: {liveSummary.online_count}{" "}
                <span className="text-lg font-semibold text-slate-400">
                  / {liveSummary.total_accounts} Accounts
                </span>
              </p>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-500"
                  style={{
                    width:
                      liveSummary.total_accounts > 0
                        ? `${Math.round(
                            (liveSummary.online_count /
                              liveSummary.total_accounts) *
                              100
                          )}%`
                        : "0%",
                  }}
                />
              </div>
              <span className="text-xs font-semibold text-rose-300">
                {liveSummary.offline_count > 0
                  ? `🔴 หลุด ${liveSummary.offline_count}`
                  : "ปกติ 100%"}
              </span>
            </div>
          </div>

          {/* 3. TOTAL COMBINED GOLD */}
          <div className="group relative overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-amber-950/35 p-5 backdrop-blur-xl shadow-[0_0_35px_-10px_rgba(245,158,11,0.25)]">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-amber-500/15 blur-2xl group-hover:bg-amber-400/25 transition" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-300/90">
                Total Combined Gold
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-500/15 text-xl">
                🪙
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <p className="text-2xl sm:text-3xl font-black tracking-tight text-white tabular-nums drop-shadow-[0_0_12px_rgba(251,191,36,0.3)]">
                {formatNumber(liveSummary.total_gold)}
              </p>
            </div>
            <p className="mt-2 text-xs text-slate-400 flex items-center justify-between">
              <span>ยอดเงินทองรวมทุกจอ</span>
              <span className="font-mono text-amber-300">
                {formatCompact(liveSummary.total_gold)} Gold
              </span>
            </p>
          </div>

          {/* 4. TOTAL FARM TIME (UPTIME) */}
          <div className="group relative overflow-hidden rounded-3xl border border-purple-500/30 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-purple-950/40 p-5 backdrop-blur-xl shadow-[0_0_35px_-10px_rgba(168,85,247,0.3)]">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-purple-500/15 blur-2xl group-hover:bg-purple-400/25 transition" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-300/90">
                Total Farm Uptime
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-purple-400/30 bg-purple-500/15 text-xl">
                ⏱️
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <p className="text-2xl sm:text-3xl font-black tracking-tight text-white tabular-nums">
                {formatUptime(liveSummary.total_uptime_seconds)}
              </p>
            </div>
            <p className="mt-2 text-xs text-slate-400 flex items-center justify-between">
              <span>เวลารวมที่บอททำงานทั้งหมด</span>
              <span className="font-mono text-purple-300">
                {(liveSummary.total_uptime_seconds / 3600).toFixed(1)} hrs
              </span>
            </p>
          </div>
        </section>

        {/* ===================================================================
            CONTROL BAR (Search, Sort, Status Filter, Auto-Refresh, Audio Alert)
        =================================================================== */}
        <section className="rounded-3xl border border-white/10 bg-slate-900/65 p-4 sm:p-5 backdrop-blur-2xl shadow-xl space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {/* Search Box & Status Pills */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
              <div className="relative flex-1 min-w-[220px]">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                  🔍
                </span>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ค้นหาชื่อไอดี @Username, Display Name, หรือชื่อแมพ..."
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 pl-10 pr-9 py-2.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-white"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Status Filter Pills */}
              <div className="inline-flex rounded-2xl border border-white/10 bg-slate-950/80 p-1 self-start sm:self-auto">
                {(["ALL", "ONLINE", "OFFLINE"] as StatusFilter[]).map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                      statusFilter === st
                        ? st === "ONLINE"
                          ? "bg-emerald-500/25 text-emerald-300 border border-emerald-400/40"
                          : st === "OFFLINE"
                          ? "bg-rose-500/25 text-rose-300 border border-rose-400/40"
                          : "bg-cyan-500/25 text-cyan-200 border border-cyan-400/40"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {st === "ALL"
                      ? `ทั้งหมด (${liveSummary.total_accounts})`
                      : st === "ONLINE"
                      ? `🟢 Online (${liveSummary.online_count})`
                      : `🔴 Offline (${liveSummary.offline_count})`}
                  </button>
                ))}
              </div>
            </div>

            {/* Sort, Auto-Refresh, Audio Alert Controls */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Sort Selector */}
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2">
                <span className="text-xs text-slate-400">เรียงตาม:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="bg-transparent text-xs sm:text-sm font-semibold text-cyan-200 focus:outline-none cursor-pointer"
                >
                  <option value="gems_desc" className="bg-slate-900 text-white">
                    💎 เพชรมากสุด (Gems)
                  </option>
                  <option value="level_desc" className="bg-slate-900 text-white">
                    ⭐ เลเวลมากสุด (Level)
                  </option>
                  <option
                    value="online_first"
                    className="bg-slate-900 text-white"
                  >
                    🟢 สถานะออนไลน์ (Online)
                  </option>
                  <option value="gold_desc" className="bg-slate-900 text-white">
                    🪙 ทองมากสุด (Gold)
                  </option>
                </select>
              </div>

              {/* Auto-Refresh Toggle + Interval Selector */}
              <div className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-slate-950/80 p-1.5">
                <button
                  onClick={() => setAutoRefresh((prev) => !prev)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                    autoRefresh
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      autoRefresh
                        ? "bg-emerald-400 animate-ping"
                        : "bg-slate-500"
                    }`}
                  />
                  <span>Auto-Refresh: {autoRefresh ? `${countdown}s` : "OFF"}</span>
                </button>

                <select
                  value={refreshIntervalSec}
                  onChange={(e) => setRefreshIntervalSec(Number(e.target.value))}
                  className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-300 focus:outline-none cursor-pointer"
                  title="ตั้งเวลาดึงข้อมูลอัตโนมัติ"
                >
                  <option value={5}>5 วินาที</option>
                  <option value={10}>10 วินาที</option>
                </select>

                <button
                  onClick={() => fetchTelemetry(false)}
                  disabled={isRefreshing}
                  className="rounded-xl bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition"
                  title="รีเฟรชข้อมูลเดี๋ยวนี้"
                >
                  <span className={isRefreshing ? "inline-block animate-spin" : ""}>
                    🔄
                  </span>
                </button>
              </div>

              {/* Audio Alert Toggle */}
              <button
                onClick={() => {
                  const next = !audioEnabled;
                  setAudioEnabled(next);
                  if (next) {
                    audioEngineRef.current?.playGemChime();
                    pushToast(
                      "info",
                      "🔊 เปิดเสียงแจ้งเตือนแล้ว",
                      "ระบบจะส่งเสียงเมื่อเพชรเพิ่มหรือไอดีหลุด Offline"
                    );
                  }
                }}
                className={`inline-flex items-center gap-2 rounded-2xl border px-3.5 py-2 text-xs font-bold transition ${
                  audioEnabled
                    ? "border-purple-400/40 bg-purple-500/20 text-purple-200 shadow-lg shadow-purple-500/10"
                    : "border-white/10 bg-slate-950/80 text-slate-400 hover:text-slate-200"
                }`}
                title="เปิด/ปิดเสียงแจ้งเตือนเมื่อไอดีหลุดหรือเพชรเพิ่มขึ้น"
              >
                <span>{audioEnabled ? "🔊 เสียงเตือน: ON" : "🔇 เสียงเตือน: OFF"}</span>
              </button>

              {liveSummary.offline_count > 0 && (
                <button
                  onClick={handleClearOffline}
                  className="inline-flex items-center gap-1.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition"
                >
                  <span>🗑️ ล้างจอ Offline</span>
                </button>
              )}
            </div>
          </div>
        </section>

        {/* ERROR BANNER */}
        {error && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-950/50 p-4 text-sm text-rose-200 flex items-center justify-between">
            <span>⚠️ เกิดข้อผิดพลาดในการดึงข้อมูล: {error}</span>
            <button
              onClick={() => fetchTelemetry(false)}
              className="rounded-xl bg-rose-500/20 px-3 py-1 text-xs font-bold hover:bg-rose-500/30"
            >
              ลองใหม่
            </button>
          </div>
        )}

        {/* ===================================================================
            ACCOUNT CARDS GRID (Responsive 1 col mobile / 2 col tablet / 3 col desktop)
        =================================================================== */}
        {loading ? (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-72 rounded-3xl border border-white/10 bg-slate-900/50 p-6 animate-pulse flex flex-col justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl bg-slate-800" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-1/2 rounded bg-slate-800" />
                    <div className="h-3 w-1/3 rounded bg-slate-800" />
                  </div>
                </div>
                <div className="h-20 rounded-2xl bg-slate-800/70" />
                <div className="h-10 rounded-xl bg-slate-800/50" />
              </div>
            ))}
          </div>
        ) : filteredAndSortedAccounts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/15 bg-slate-900/40 p-10 sm:p-14 text-center backdrop-blur-xl space-y-4">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-cyan-400/30 bg-cyan-500/10 text-4xl shadow-inner">
              📡
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white">
              {accounts.length === 0
                ? "ยังไม่มีไอดีส่งข้อมูลเข้ามาที่ Dashboard"
                : "ไม่พบไอดีที่ตรงกับการค้นหา"}
            </h2>
            <p className="mx-auto max-w-xl text-sm text-slate-400">
              {accounts.length === 0
                ? "คุณสามารถกดปุ่ม 'โหลดไอดีตัวอย่าง' เพื่อดูตัวอย่างการทำงานของแดชบอร์ด หรือคัดลอกสคริปต์ Luau ไปวางใน Roblox Executor เพื่อส่งข้อมูลเข้ามายัง /api/telemetry ได้ทันที"
                : "ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ Online / Offline ด้านบน"}
            </p>
            {accounts.length === 0 && (
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => handleSimulatorAction("seed_demo")}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 hover:opacity-95 transition"
                >
                  <span>⚡ โหลดไอดีตัวอย่าง (4 จอ) ทันที</span>
                </button>
                <button
                  onClick={() => setShowLuauModal(true)}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/15 bg-slate-900/80 px-5 py-3 text-sm font-bold text-slate-200 hover:bg-slate-800 transition"
                >
                  <span>📜 ดูโค้ดสคริปต์ Luau สำหรับ Executor</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filteredAndSortedAccounts.map((acc) => {
              const isOnline = acc.effective_status === "ONLINE";
              const secondsAgo = acc.seconds_since_update ?? 0;
              const activeGemGain = gemFlashMap[acc.user_id] || 0;
              const recentServerDelta =
                nowTick - (acc.last_gem_gain_at || 0) <= 15
                  ? acc.gems_delta || 0
                  : 0;
              const displayedGemDelta = activeGemGain || recentServerDelta;
              const isGemFlashing = displayedGemDelta > 0;

              const pingColor =
                acc.ping < 80
                  ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                  : acc.ping < 150
                  ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
                  : "text-rose-400 border-rose-500/30 bg-rose-500/10";

              return (
                <article
                  key={acc.user_id}
                  className={`group relative flex flex-col justify-between overflow-hidden rounded-3xl border p-5 sm:p-6 backdrop-blur-2xl transition-all duration-300 ${
                    isGemFlashing
                      ? "border-emerald-400/80 bg-slate-900/85 shadow-[0_0_40px_-5px_rgba(16,185,129,0.5)] animate-gem-flash"
                      : isOnline
                      ? "border-white/10 bg-slate-900/65 hover:border-cyan-400/50 hover:shadow-[0_0_35px_-10px_rgba(6,182,212,0.3)]"
                      : "border-rose-500/35 bg-slate-950/75 opacity-90 shadow-[0_0_25px_-10px_rgba(244,63,94,0.25)]"
                  }`}
                >
                  {/* Top Neon Accent Line */}
                  <div
                    className={`absolute inset-x-0 top-0 h-1 ${
                      isGemFlashing
                        ? "bg-gradient-to-r from-emerald-400 via-cyan-300 to-emerald-400"
                        : isOnline
                        ? "bg-gradient-to-r from-cyan-500 via-purple-500 to-emerald-400"
                        : "bg-gradient-to-r from-rose-600 via-red-500 to-orange-500"
                    }`}
                  />

                  {/* CARD HEADER: Avatar Headshot + Status + Username + Level Badge */}
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Avatar Headshot with Online/Offline Ring */}
                        <div className="relative shrink-0">
                          <div
                            className={`h-16 w-16 rounded-2xl p-[2px] ${
                              isOnline
                                ? "bg-gradient-to-br from-emerald-400 via-cyan-400 to-purple-500 shadow-lg shadow-emerald-500/20"
                                : "bg-gradient-to-br from-rose-500 to-slate-700"
                            }`}
                          >
                            <img
                              src={
                                acc.avatar_url ||
                                generateFallbackAvatarSvg(acc.username)
                              }
                              alt={acc.username}
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).src =
                                  generateFallbackAvatarSvg(acc.username);
                              }}
                              className={`h-full w-full rounded-[14px] bg-slate-950 object-cover ${
                                !isOnline ? "grayscale contrast-75" : ""
                              }`}
                            />
                          </div>

                          {/* Pulse Status Dot on Avatar */}
                          <span
                            className="absolute -bottom-1 -right-1 flex h-4 w-4"
                            title={
                              isOnline
                                ? "ONLINE - กำลังฟาร์ม"
                                : "OFFLINE - ขาดการติดต่อเกิน 60 วินาที"
                            }
                          >
                            {isOnline && (
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80" />
                            )}
                            <span
                              className={`relative inline-flex h-4 w-4 rounded-full border-2 border-slate-950 ${
                                isOnline ? "bg-emerald-400" : "bg-rose-500"
                              }`}
                            />
                          </span>
                        </div>

                        {/* Display Name & @Username */}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-base sm:text-lg font-extrabold text-white group-hover:text-cyan-200 transition">
                              {acc.display_name || acc.username}
                            </h3>
                          </div>
                          <p className="truncate text-xs font-mono text-slate-400">
                            @{acc.username}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {/* Online / Offline Status Pill */}
                            {isOnline ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                ONLINE
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/50 bg-rose-500/20 px-2.5 py-0.5 text-[11px] font-bold text-rose-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                                OFFLINE
                              </span>
                            )}

                            {acc.account_age > 0 && (
                              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                                อายุ {acc.account_age} วัน
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Level Badge & Delete Button */}
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <div className="rounded-2xl border border-purple-400/40 bg-gradient-to-br from-purple-500/25 to-cyan-500/15 px-3 py-1.5 text-right shadow-inner">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-purple-300">
                            LEVEL
                          </span>
                          <span className="text-base sm:text-lg font-black text-white tabular-nums">
                            {acc.level}
                          </span>
                        </div>
                        <button
                          onClick={() =>
                            handleDeleteAccount(acc.user_id, acc.username)
                          }
                          className="text-[11px] text-slate-500 hover:text-rose-400 transition px-1"
                          title="ลบไอดีนี้ออกจากแดชบอร์ด"
                        >
                          ลบการ์ด
                        </button>
                      </div>
                    </div>

                    {/* GEMS HIGHLIGHT BOX (With Green Flash Effect on Increase) */}
                    <div
                      className={`mt-5 rounded-2xl border p-4 transition-all duration-500 ${
                        isGemFlashing
                          ? "border-emerald-400 bg-gradient-to-r from-emerald-950/90 via-emerald-900/60 to-cyan-950/80 shadow-[0_0_25px_rgba(16,185,129,0.4)]"
                          : "border-cyan-500/25 bg-slate-950/75"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                          <span>💎</span>
                          <span>GEMS BALANCE</span>
                        </span>
                        {displayedGemDelta > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-500/30 px-2.5 py-0.5 text-xs font-black text-emerald-200 shadow-lg shadow-emerald-500/30 animate-bounce">
                            ▲ +{formatNumber(displayedGemDelta)} Gems!
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 flex items-baseline justify-between gap-2">
                        <span
                          className={`text-2xl sm:text-3xl font-black tracking-tight tabular-nums transition-colors duration-300 ${
                            isGemFlashing
                              ? "text-emerald-300 drop-shadow-[0_0_14px_rgba(52,211,153,0.75)]"
                              : "text-white"
                          }`}
                        >
                          {formatNumber(acc.gems)}
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          ({formatCompact(acc.gems)})
                        </span>
                      </div>
                    </div>

                    {/* GOLD & EXTRA STATS ROW */}
                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5">
                        <span className="text-[11px] font-semibold text-amber-300/90 flex items-center gap-1">
                          <span>🪙</span> Gold
                        </span>
                        <p className="mt-0.5 text-sm sm:text-base font-extrabold text-amber-200 tabular-nums">
                          {formatCompact(acc.gold)}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5">
                        <span className="text-[11px] font-semibold text-purple-300/90 flex items-center gap-1">
                          <span>🎲</span> Extra Stats
                        </span>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-bold text-slate-200">
                          {acc.extra_stats &&
                          Object.keys(acc.extra_stats).length > 0 ? (
                            Object.entries(acc.extra_stats)
                              .slice(0, 2)
                              .map(([k, v]) => (
                                <span key={k} className="truncate">
                                  {k}:{" "}
                                  <span className="text-cyan-300">
                                    {String(v)}
                                  </span>
                                </span>
                              ))
                          ) : (
                            <span className="text-slate-500">ไม่มีข้อมูลเสริม</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* TELEMETRY METRICS FOOTER: Game Name, Ping, FPS, Uptime, Updated At */}
                  <div className="mt-4 pt-3.5 border-t border-white/10 space-y-2.5 text-xs">
                    {/* Game Name & Server Job ID */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-slate-400">🎮 แมพ:</span>
                        <span className="font-bold text-cyan-200 truncate">
                          {acc.game_name || "Unknown Game"}
                        </span>
                      </div>
                      {acc.job_id && (
                        <button
                          onClick={() =>
                            handleCopy(acc.job_id, `job-${acc.user_id}`)
                          }
                          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-slate-400 hover:text-white hover:border-cyan-400/40 transition"
                          title="คัดลอก Job ID เซิร์ฟเวอร์"
                        >
                          {copiedText === `job-${acc.user_id}`
                            ? "✓ Copied"
                            : `Job: ${acc.job_id.slice(0, 8)}...`}
                        </button>
                      )}
                    </div>

                    {/* Ping, FPS, Uptime Pills */}
                    <div className="grid grid-cols-3 gap-2">
                      <div
                        className={`rounded-xl border px-2.5 py-1.5 text-center font-mono font-bold ${pingColor}`}
                      >
                        📶 {acc.ping} ms
                      </div>
                      <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1.5 text-center font-mono font-bold text-cyan-300">
                        🎞️ {acc.fps} FPS
                      </div>
                      <div className="rounded-xl border border-purple-500/25 bg-purple-500/10 px-2.5 py-1.5 text-center font-mono font-bold text-purple-200">
                        ⏱️ {formatUptime(acc.uptime_seconds)}
                      </div>
                    </div>

                    {/* Last Heartbeat Timestamp */}
                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                      <span>ID: {acc.user_id}</span>
                      <span
                        className={
                          isOnline ? "text-emerald-300/90" : "text-rose-400 font-semibold"
                        }
                      >
                        อัปเดตล่าสุด: {formatRelativeThaiTime(secondsAgo)}
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </main>

      {/* ===================================================================
          MODAL: LUAU EXECUTOR SCRIPT & API PAYLOAD SPEC
      =================================================================== */}
      {showLuauModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-cyan-500/40 bg-[#080816] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <h3 className="text-lg font-extrabold text-white">
                  📜 สคริปต์ Luau สำหรับใส่ใน Roblox Executor
                </h3>
                <p className="text-xs text-slate-400">
                  ส่งข้อมูล JSON Telemetry เข้าสู่{" "}
                  <code className="text-cyan-300">{endpointUrl}</code> อัตโนมัติ
                </p>
              </div>
              <button
                onClick={() => setShowLuauModal(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"
              >
                ✕ ปิด
              </button>
            </div>

            <div className="overflow-y-auto p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                  TelemetrySender.luau (วางในโฟลเดอร์ autoexec)
                </span>
                <button
                  onClick={() => handleCopy(sampleLuauScript, "luau-script")}
                  className="rounded-xl bg-cyan-500/20 border border-cyan-400/40 px-3.5 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/30 transition"
                >
                  {copiedText === "luau-script"
                    ? "✓ คัดลอกโค้ดแล้ว!"
                    : "📋 คัดลอกสคริปต์ Luau"}
                </button>
              </div>

              <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950 p-4 text-xs font-mono text-emerald-300 leading-relaxed">
                <code>{sampleLuauScript}</code>
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
