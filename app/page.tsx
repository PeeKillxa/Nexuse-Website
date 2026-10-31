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
  april_coins: number;
  wins: number;
  disconnects: number;
  device_name?: string;
  save_to_log?: boolean;
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

interface AccountLogEntry {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string;
  device_name?: string;
  level: number;
  gems: number;
  april_coins: number;
  gold: number;
  wins: number;
  disconnects: number;
  game_name: string;
  logged_at: number;
  reason?: string;
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
    total_april_coins: number;
    total_wins: number;
    total_disconnects: number;
    total_uptime_seconds: number;
  };
  accounts: AccountTelemetry[];
  logs?: AccountLogEntry[];
}

interface ToastAlert {
  id: string;
  type: "gem_gain" | "win_gain" | "offline" | "online" | "info";
  title: string;
  message: string;
  timestamp: number;
}

type SortOption =
  | "gems_desc"
  | "april_coins_desc"
  | "wins_desc"
  | "level_desc"
  | "online_first"
  | "gold_desc";
type StatusFilter = "ALL" | "ONLINE" | "OFFLINE";

const OFFLINE_TIMEOUT_SECONDS = 120; // 120s (2 minutes) timeout to prevent false offline during teleports/replays

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

  // Play Crystal Chime when Gems or Wins increase
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
  const [winFlashMap, setWinFlashMap] = useState<Record<number, number>>({});
  const [sessionGemGain, setSessionGemGain] = useState<number>(0);
  const [toasts, setToasts] = useState<ToastAlert[]>([]);
  const [showLuauModal, setShowLuauModal] = useState<boolean>(false);
  const [showLogModal, setShowLogModal] = useState<boolean>(false);
  const [logEntries, setLogEntries] = useState<AccountLogEntry[]>([]);
  const [saveToLogPrefs, setSaveToLogPrefs] = useState<Record<number, boolean>>(
    {}
  );
  const [logSearchQuery, setLogSearchQuery] = useState<string>("");
  const [logSortBy, setLogSortBy] = useState<
    | "logged_at_desc"
    | "gems_desc"
    | "april_coins_desc"
    | "level_desc"
    | "gold_desc"
  >("logged_at_desc");
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState<number>(() =>
    Math.floor(Date.now() / 1000)
  );

  // Refs for comparing previous poll state without re-triggering effects
  const prevAccountsRef = useRef<
    Map<number, { gems: number; wins: number; isOnline: boolean }>
  >(new Map());
  const prevAccountObjectsRef = useRef<Map<number, AccountTelemetry>>(
    new Map()
  );
  const saveToLogPrefsRef = useRef<Record<number, boolean>>({});
  const isFirstFetchRef = useRef<boolean>(true);
  const audioEngineRef = useRef<CyberAudioEngine | null>(null);

  useEffect(() => {
    audioEngineRef.current = new CyberAudioEngine();
    // Load saved logs & preferences from browser localStorage
    try {
      const rawLogs = localStorage.getItem("nexus_account_logs_v1");
      if (rawLogs) {
        const parsed = JSON.parse(rawLogs) as AccountLogEntry[];
        if (Array.isArray(parsed)) {
          setLogEntries(parsed);
        }
      }
      const rawPrefs = localStorage.getItem("nexus_save_to_log_prefs_v1");
      if (rawPrefs) {
        const parsedPrefs = JSON.parse(rawPrefs) as Record<number, boolean>;
        if (parsedPrefs && typeof parsedPrefs === "object") {
          setSaveToLogPrefs(parsedPrefs);
          saveToLogPrefsRef.current = parsedPrefs;
        }
      }
    } catch {
      // ignore localStorage errors
    }
  }, []);

  const persistLogEntries = useCallback(
    (updater: (prev: AccountLogEntry[]) => AccountLogEntry[]) => {
      setLogEntries((prev) => {
        const next = updater(prev);
        try {
          localStorage.setItem("nexus_account_logs_v1", JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    []
  );

  const isAccountSaveToLogEnabled = useCallback(
    (userId: number, serverFlag?: boolean): boolean => {
      if (saveToLogPrefsRef.current[userId] !== undefined) {
        return saveToLogPrefsRef.current[userId];
      }
      if (serverFlag !== undefined) {
        return serverFlag;
      }
      return true; // Default คือ เก็บลง Log เสมอ
    },
    []
  );

  const recordAccountToLocalLog = useCallback(
    (acc: AccountTelemetry, reason = "บันทึกก่อนลบออกจากหน้าเว็บ") => {
      const nowSec = Math.floor(Date.now() / 1000);
      const entry: AccountLogEntry = {
        user_id: acc.user_id,
        username: acc.username,
        display_name: acc.display_name || acc.username,
        avatar_url: acc.avatar_url || "",
        device_name: acc.device_name || (acc.extra_stats?.device_name as string) || "PC",
        level: acc.level || 1,
        gems: acc.gems || 0,
        april_coins:
          acc.april_coins || Number(acc.extra_stats?.april_coins || 0) || 0,
        gold: acc.gold || 0,
        wins: acc.wins || 0,
        disconnects: acc.disconnects || 0,
        game_name: acc.game_name || "Anime Adventures",
        logged_at: nowSec,
        reason,
      };
      persistLogEntries((prev) => {
        const filtered = prev.filter((item) => item.user_id !== acc.user_id);
        return [entry, ...filtered];
      });
    },
    [persistLogEntries]
  );

  // Tick every 1s to keep relative timestamps and 120s heartbeat timeout live
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

  // Determine real-time online status on client (120 seconds threshold, 15s grace for teleports)
  const computeIsOnline = useCallback(
    (acc: AccountTelemetry, currentSec: number): boolean => {
      const refTime = acc.server_updated_at || acc.updated_at || currentSec;
      const age = Math.max(0, currentSec - refTime);
      if (acc.status?.toUpperCase() === "OFFLINE" && age > 15) return false;
      return age <= OFFLINE_TIMEOUT_SECONDS;
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
        const incomingIds = new Set(incoming.map((a) => a.user_id));
        const onlineIds = new Set<number>();

        incoming.forEach((acc) => {
          const isNowOnline =
            acc.effective_status === "ONLINE" &&
            computeIsOnline(acc, currentSec);
          if (isNowOnline) {
            onlineIds.add(acc.user_id);
          }
        });

        // หากมีไอดีไหนหายไปจากเซิร์ฟเวอร์เอง และตั้งค่าเก็บลง Log ไว้ (default = true) ให้เซฟเข้า Log อัตโนมัติทันทีก่อนหาย
        prevAccountObjectsRef.current.forEach((prevAcc, uid) => {
          if (
            !incomingIds.has(uid) &&
            isAccountSaveToLogEnabled(uid, prevAcc.save_to_log)
          ) {
            recordAccountToLocalLog(prevAcc, "บันทึกอัตโนมัติก่อนออกจากหน้าเว็บ");
          }
        });

        // Merge server logs with browser localStorage logs & ลบไอดีที่กลับมา ONLINE ออกจาก Log ทันที
        persistLogEntries((prev) => {
          const map = new Map<number, AccountLogEntry>();
          prev.forEach((item) => {
            if (!onlineIds.has(item.user_id)) {
              map.set(item.user_id, item);
            }
          });
          if (Array.isArray(data.logs)) {
            data.logs.forEach((srvItem) => {
              if (onlineIds.has(srvItem.user_id)) return;
              if (saveToLogPrefsRef.current[srvItem.user_id] === false) return;
              const existing = map.get(srvItem.user_id);
              if (
                !existing ||
                (srvItem.logged_at || 0) >= (existing.logged_at || 0)
              ) {
                map.set(srvItem.user_id, srvItem);
              }
            });
          }
          return Array.from(map.values()).sort(
            (a, b) => (b.logged_at || 0) - (a.logged_at || 0)
          );
        });

        const newFlashEntries: Record<number, number> = {};
        const newWinFlashEntries: Record<number, number> = {};
        let totalNewGemsThisPoll = 0;
        let shouldPlayGemSound = false;
        let shouldPlayOfflineSound = false;

        incoming.forEach((acc) => {
          prevAccountObjectsRef.current.set(acc.user_id, acc);
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

            // Check if Wins increased
            if ((acc.wins || 0) > (prev.wins || 0)) {
              const wDiff = (acc.wins || 0) - (prev.wins || 0);
              newWinFlashEntries[acc.user_id] = wDiff;
              shouldPlayGemSound = true;
              pushToast(
                "win_gain",
                `🏆 ชนะด่านสำเร็จ! (+${wDiff} Win)`,
                `@${acc.username} ชนะสะสมรวม ${formatNumber(acc.wins)} รอบแล้ว!`
              );
            }

            // Check if Account dropped from ONLINE -> OFFLINE
            if (prev.isOnline && !isNowOnline) {
              shouldPlayOfflineSound = true;
              pushToast(
                "offline",
                `🔴 ไอดีหลุด (OFFLINE)!`,
                `@${acc.username} ขาดการติดต่อเกิน ${OFFLINE_TIMEOUT_SECONDS} วินาที`
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
            wins: acc.wins || 0,
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

        if (Object.keys(newWinFlashEntries).length > 0) {
          setWinFlashMap((prev) => ({ ...prev, ...newWinFlashEntries }));
          setTimeout(() => {
            setWinFlashMap((prev) => {
              const next = { ...prev };
              Object.keys(newWinFlashEntries).forEach((k) => {
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
    [
      audioEnabled,
      computeIsOnline,
      isAccountSaveToLogEnabled,
      persistLogEntries,
      pushToast,
      recordAccountToLocalLog,
      refreshIntervalSec,
    ]
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

  // Toggle whether an account should be saved to Log before removal (Default = true)
  const handleToggleSaveToLog = async (
    userId: number,
    username: string,
    currentVal: boolean
  ) => {
    const nextVal = !currentVal;
    const updatedPrefs = {
      ...saveToLogPrefsRef.current,
      [userId]: nextVal,
    };
    saveToLogPrefsRef.current = updatedPrefs;
    setSaveToLogPrefs(updatedPrefs);
    try {
      localStorage.setItem(
        "nexus_save_to_log_prefs_v1",
        JSON.stringify(updatedPrefs)
      );
    } catch {
      // ignore
    }

    if (!nextVal) {
      // ลบออกจาก Log ด้วยหากตั้งค่าไม่ให้เก็บไอดีนี้
      persistLogEntries((prev) =>
        prev.filter((item) => item.user_id !== userId)
      );
      pushToast(
        "info",
        "🚫 ปิดการเก็บลง Log",
        `ตั้งค่าไม่เก็บ @${username} ลงใน Log เมื่อลบการ์ด`
      );
    } else {
      pushToast(
        "info",
        "📋 เปิดการเก็บลง Log",
        `ระบบจะบันทึกข้อมูล @${username} ลง Log ก่อนลบออกจากหน้าเว็บ`
      );
    }

    try {
      await fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_save_to_log",
          user_id: userId,
          save_to_log: nextVal,
        }),
      });
    } catch {
      // ignore
    }
  };

  const handleDeleteAccount = async (userId: number, username: string) => {
    const targetAcc =
      accounts.find((a) => a.user_id === userId) ||
      prevAccountObjectsRef.current.get(userId);
    const shouldSaveLog = isAccountSaveToLogEnabled(
      userId,
      targetAcc?.save_to_log
    );

    if (targetAcc && shouldSaveLog) {
      recordAccountToLocalLog(targetAcc, "ลบการ์ดออกจากหน้าเว็บ");
    }
    prevAccountObjectsRef.current.delete(userId);
    prevAccountsRef.current.delete(userId);

    await fetch(
      `/api/telemetry?user_id=${userId}${shouldSaveLog ? "" : "&skip_log=1"}`,
      { method: "DELETE" }
    );
    pushToast(
      "info",
      shouldSaveLog ? "📋 บันทึกลง Log & ลบการ์ดแล้ว" : "🗑️ ลบการ์ดสำเร็จ",
      shouldSaveLog
        ? `เก็บข้อมูล @${username} ลงใน Log เรียบร้อยก่อนลบ`
        : `ลบ @${username} โดยไม่เก็บลง Log`
    );
    await fetchTelemetry(true);
  };

  const handleClearOffline = async () => {
    let savedCount = 0;
    enrichedAccounts.forEach((acc) => {
      if (acc.effective_status === "OFFLINE") {
        const shouldSave = isAccountSaveToLogEnabled(
          acc.user_id,
          acc.save_to_log
        );
        if (shouldSave) {
          recordAccountToLocalLog(acc, "ล้างจอ Offline");
          savedCount++;
        }
        prevAccountObjectsRef.current.delete(acc.user_id);
        prevAccountsRef.current.delete(acc.user_id);
      }
    });

    await fetch(`/api/telemetry?mode=offline`, { method: "DELETE" });
    pushToast(
      "info",
      "📋 ล้างไอดี Offline เรียบร้อย",
      savedCount > 0
        ? `บันทึกข้อมูลลง Log ${savedCount} ไอดีก่อนลบออกจากหน้าเว็บ`
        : "ลบรายการไอดีที่หลุดออกทั้งหมดแล้ว"
    );
    await fetchTelemetry(true);
  };

  const handleSnapshotAllToLog = async () => {
    let count = 0;
    enrichedAccounts.forEach((acc) => {
      if (isAccountSaveToLogEnabled(acc.user_id, acc.save_to_log)) {
        recordAccountToLocalLog(acc, "กดบันทึกเข้า Log");
        count++;
      }
    });
    try {
      await fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "snapshot_to_log" }),
      });
    } catch {
      // ignore
    }
    pushToast(
      "info",
      "📥 บันทึกเข้า Log สำเร็จ",
      `อัปเดตข้อมูล ${count} ไอดีที่ตั้งค่าเก็บลง Log เรียบร้อย`
    );
  };

  const handleDeleteLogEntry = async (userId: number, username: string) => {
    persistLogEntries((prev) => prev.filter((item) => item.user_id !== userId));
    try {
      await fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_log_entry", user_id: userId }),
      });
    } catch {
      // ignore
    }
    pushToast("info", "ลบออกจาก Log แล้ว", `ลบ @${username} ออกจากประวัติ Log`);
  };

  const handleClearAllLogs = async () => {
    persistLogEntries(() => []);
    try {
      await fetch("/api/telemetry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_logs" }),
      });
    } catch {
      // ignore
    }
    pushToast("info", "ล้างประวัติ Log ทั้งหมดแล้ว", "ข้อมูลใน Log ถูกล้างเรียบร้อย");
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Enrich accounts with live 1-second accuracy for 120s timeout (+ 15s teleport grace)
  const enrichedAccounts = useMemo(() => {
    return accounts.map((acc) => {
      const refTime = acc.server_updated_at || acc.updated_at || nowTick;
      const secondsSinceUpdate = Math.max(0, nowTick - refTime);
      const isExplicitOffline =
        acc.status?.toUpperCase() === "OFFLINE" && secondsSinceUpdate > 15;
      const isTimedOut = secondsSinceUpdate > OFFLINE_TIMEOUT_SECONDS;
      const isOnline = !isExplicitOffline && !isTimedOut;
      const aprilCoins =
        acc.april_coins || Number(acc.extra_stats?.april_coins || 0) || 0;
      const saveToLog =
        saveToLogPrefs[acc.user_id] !== undefined
          ? saveToLogPrefs[acc.user_id]
          : acc.save_to_log !== undefined
          ? acc.save_to_log
          : true;
      return {
        ...acc,
        april_coins: aprilCoins,
        wins: acc.wins || 0,
        disconnects: acc.disconnects || 0,
        save_to_log: saveToLog,
        effective_status: (isOnline ? "ONLINE" : "OFFLINE") as
          | "ONLINE"
          | "OFFLINE",
        seconds_since_update: secondsSinceUpdate,
      };
    });
  }, [accounts, nowTick, saveToLogPrefs]);

  // Compute Live Summary Metrics
  const liveSummary = useMemo(() => {
    return enrichedAccounts.reduce(
      (acc, item) => {
        acc.total_gems += item.gems || 0;
        acc.total_gold += item.gold || 0;
        acc.total_april_coins += item.april_coins || 0;
        acc.total_wins += item.wins || 0;
        acc.total_disconnects += item.disconnects || 0;
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
        total_april_coins: 0,
        total_wins: 0,
        total_disconnects: 0,
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
      if (sortBy === "april_coins_desc")
        return (b.april_coins || 0) - (a.april_coins || 0);
      if (sortBy === "wins_desc") return (b.wins || 0) - (a.wins || 0);
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

  // Compute Log Summary & Filtered Logs (กรองไอดีที่กำลัง ONLINE ออกจาก Log เสมอ)
  const activeOnlineUserIds = useMemo(() => {
    const set = new Set<number>();
    enrichedAccounts.forEach((acc) => {
      if (acc.effective_status === "ONLINE") {
        set.add(acc.user_id);
      }
    });
    return set;
  }, [enrichedAccounts]);

  const visibleLogEntries = useMemo(() => {
    return logEntries.filter((item) => !activeOnlineUserIds.has(item.user_id));
  }, [logEntries, activeOnlineUserIds]);

  const logSummary = useMemo(() => {
    return visibleLogEntries.reduce(
      (acc, item) => {
        acc.total_gems += item.gems || 0;
        acc.total_april_coins += item.april_coins || 0;
        acc.total_gold += item.gold || 0;
        return acc;
      },
      {
        total_logs: visibleLogEntries.length,
        total_gems: 0,
        total_april_coins: 0,
        total_gold: 0,
      }
    );
  }, [visibleLogEntries]);

  const filteredLogs = useMemo(() => {
    const q = logSearchQuery.trim().toLowerCase();
    const list = visibleLogEntries.filter((entry) => {
      if (!q) return true;
      return (
        entry.username?.toLowerCase().includes(q) ||
        entry.display_name?.toLowerCase().includes(q) ||
        String(entry.user_id).includes(q) ||
        entry.reason?.toLowerCase().includes(q)
      );
    });

    return list.sort((a, b) => {
      if (logSortBy === "gems_desc") return (b.gems || 0) - (a.gems || 0);
      if (logSortBy === "april_coins_desc")
        return (b.april_coins || 0) - (a.april_coins || 0);
      if (logSortBy === "level_desc") return (b.level || 0) - (a.level || 0);
      if (logSortBy === "gold_desc") return (b.gold || 0) - (a.gold || 0);
      return (b.logged_at || 0) - (a.logged_at || 0);
    });
  }, [visibleLogEntries, logSearchQuery, logSortBy]);

  const formatLogExportText = useCallback(() => {
    if (filteredLogs.length === 0) return "";
    return filteredLogs
      .map(
        (item, idx) =>
          `${idx + 1}. [${item.device_name || "PC"}] ${item.username} | 💎 Gems: ${formatNumber(
            item.gems
          )} | 🌸 April Fool: ${formatNumber(
            item.april_coins || 0
          )} | ⭐ Lv.${item.level} | 🪙 Gold: ${formatNumber(item.gold)}`
      )
      .join("\n");
  }, [filteredLogs]);

  const endpointUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/telemetry`
      : "https://nexuse-website.vercel.app/api/telemetry";

  const oneLinerLoadstring = `loadstring(game:HttpGet("https://cdn.jsdelivr.net/gh/PeeKillxa/AA_Macro@main/tracker.lua"))()`;

  const sampleLuauScript = `-- ============================================================
-- 🤖 ROBLOX MULTI-ACCOUNT FARM TELEMETRY SENDER (v2.4)
-- Optimized for: Anime Adventures (Lobby + Story/Match) & All Games
-- ตรวจจับชนะด่าน (ResultsUI), นับจำนวนครั้งที่หลุด (Disconnects), กันเตะ Code 285 ตอนวาร์ป
-- ============================================================

if not game:IsLoaded() then
    game.Loaded:Wait()
end

local env = (getgenv and getgenv()) or _G
local CURRENT_RUN_ID = tostring(os.clock()) .. "_" .. tostring(math.random(100000, 999999))
env._COOK45_TRACKER_RUN_ID = CURRENT_RUN_ID

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local Stats = game:GetService("Stats")
local MarketplaceService = game:GetService("MarketplaceService")
local RunService = game:GetService("RunService")
local VirtualUser = game:GetService("VirtualUser")
local GuiService = game:GetService("GuiService")

local API_URL = "${endpointUrl}"
local SEND_INTERVAL = 15 -- ส่งข้อมูลทุกๆ 15 วินาที (Timeout ฝั่งเว็บ 120 วินาที รองรับตอนโหลดแมพ/วาร์ป)

local httpRequest = (syn and syn.request) or (http and http.request) or http_request or (fluxus and fluxus.request) or request
if not httpRequest then
    warn("[FarmDashboard] ❌ Executor ของคุณไม่รองรับคำสั่ง http_request / request")
    return
end

local player = Players.LocalPlayer or Players.PlayerAdded:Wait()

-- ป้องกัน AFK 20 นาที
pcall(function()
    player.Idled:Connect(function()
        pcall(function()
            VirtualUser:CaptureController()
            VirtualUser:ClickButton2(Vector2.new(0, 0))
        end)
    end)
end)

local sessionFile = string.format("bot_session_%s.json", tostring(player.UserId))
local heartbeatFile = "watchdog_heartbeat.txt"
local rokidCheckFile = string.format("executor_check_%s.txt", tostring(player.Name))
local isKickedOrDisconnected = false
local sessionStartTime = os.time()
local sessionWins = 0
local sessionDisconnects = 0
local isFileSystemSupported = (writefile and readfile and isfile) and true or false
local sendTelemetry

if isFileSystemSupported then
    pcall(function()
        if delfile and isfile("watchdog_disconnected.txt") then
            delfile("watchdog_disconnected.txt")
        end
        if isfile(sessionFile) then
            local data = HttpService:JSONDecode(readfile(sessionFile))
            if data and data.last_seen then
                local age = os.time() - data.last_seen
                if data.session_start and age >= 0 and age < 600 then
                    sessionStartTime = data.session_start
                end
                if age >= 0 and age < 86400 then
                    sessionWins = tonumber(data.wins) or 0
                    sessionDisconnects = tonumber(data.disconnects) or 0
                end
            end
        end
    end)
end

local function saveSessionData()
    if not isFileSystemSupported then return end
    pcall(function()
        writefile(sessionFile, HttpService:JSONEncode({
            user_id = player.UserId,
            username = player.Name,
            session_start = sessionStartTime,
            last_seen = os.time(),
            wins = sessionWins,
            disconnects = sessionDisconnects
        }) .. "\\n")
    end)
end

local function pulseHeartbeat()
    if not isFileSystemSupported or isKickedOrDisconnected or env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then return end
    pcall(function()
        local nowEpoch = tostring(os.time())
        writefile(heartbeatFile, nowEpoch .. "\\n")
        writefile(rokidCheckFile, "working:" .. nowEpoch .. "\\n")
        saveSessionData()
    end)
end

local function onDisconnectDetected(reason)
    if isKickedOrDisconnected then return end
    isKickedOrDisconnected = true
    sessionDisconnects = sessionDisconnects + 1
    pcall(function()
        saveSessionData()
        if delfile and isfile and isfile(heartbeatFile) then delfile(heartbeatFile) end
        if writefile then writefile("watchdog_disconnected.txt", tostring(reason) .. "\\n") end
    end)
    task.spawn(function()
        if sendTelemetry then pcall(sendTelemetry, "OFFLINE") end
    end)
end

pcall(function()
    GuiService.ErrorMessageChanged:Connect(function(msg)
        pcall(function()
            local code = GuiService:GetErrorCode().Value
            local lowerMsg = tostring(msg or ""):lower()
            if code == 285 or lowerMsg:find("disconnectclientinitiated") or lowerMsg:find("teleport") or lowerMsg:find("joining") then
                return
            end
            if code >= Enum.ConnectionError.DisconnectErrors.Value then
                onDisconnectDetected(string.format("GuiService Error [Code %d]: %s", code, tostring(msg)))
            end
        end)
    end)
end)

-- ตรวจจับการชนะด่านจาก ResultsUI (Anime Adventures)
local hasCountedMatchResult = false
local function getCurrentWave()
    local ok, val = pcall(function()
        return workspace._wave_num and tonumber(workspace._wave_num.Value) or 0
    end)
    return (ok and val) or 0
end

task.spawn(function()
    while task.wait(0.5) do
        if env._COOK45_TRACKER_RUN_ID ~= CURRENT_RUN_ID then break end
        pcall(function()
            local pg = player:FindFirstChild("PlayerGui")
            local rui = pg and pg:FindFirstChild("ResultsUI")
            local holder = rui and rui:FindFirstChild("Holder")
            local finished = rui and rui:FindFirstChild("Finished")
            local isResultsOpen = rui and (
                rui.Enabled == true
                or (holder and holder.Visible == true)
                or (finished and finished.Visible == true)
            )
            if isResultsOpen then
                if not hasCountedMatchResult then
                    local titleObj = holder and holder:FindFirstChild("Title")
                    local titleText = titleObj and tostring(titleObj.Text or ""):upper() or ""
                    local isDefeat = titleText:find("DEFEAT") ~= nil or titleText:find("LOSE") ~= nil
                    local isVictory = titleText:find("VICTORY") ~= nil or (finished and finished.Visible and not isDefeat)
                    if isVictory or isDefeat then
                        hasCountedMatchResult = true
                        if isVictory then
                            sessionWins = sessionWins + 1
                            saveSessionData()
                            if sendTelemetry then task.spawn(function() pcall(sendTelemetry, "ONLINE") end) end
                        end
                    end
                end
            elseif hasCountedMatchResult and getCurrentWave() <= 1 then
                hasCountedMatchResult = false
            end
        end)
    end
end)

-- ดึงข้อมูลและส่งเข้าเว็บทุก 15 วินาที (หรือใช้ลิงก์โหลดบรรทัดเดียวด้านบนได้เลย!)`;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#080d13] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-100">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% -20%, rgba(34, 211, 238, 0.09), transparent 52%)",
        }}
      />

      {/* ===================================================================
          FLOATING TOAST NOTIFICATIONS (Gem Gain, Win Gain & Offline Alerts)
      =================================================================== */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2.5 max-w-sm w-[calc(100vw-2rem)] pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 backdrop-blur-xl shadow-2xl transition-all duration-300 ${
              t.type === "gem_gain"
                ? "bg-emerald-950/85 border-emerald-400/50 text-emerald-100 shadow-emerald-500/20"
                : t.type === "win_gain"
                ? "bg-amber-950/90 border-amber-400/60 text-amber-100 shadow-amber-500/25"
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
                : t.type === "win_gain"
                ? "🏆"
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
      <main className="relative z-10 mx-auto max-w-screen-2xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {/* TOP BRANDING BAR */}
        <header className="flex flex-col gap-5 rounded-2xl border border-white/[0.08] bg-[#111820]/95 p-5 shadow-[0_14px_42px_-34px_rgba(0,0,0,0.9)] sm:p-7 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/[0.08] text-lg font-black tracking-tight text-cyan-100">
              N
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  NEXUSE <span className="text-slate-600">/</span> FARM MONITOR
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                    storageMode === "vercel-kv"
                      ? "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-200"
                      : "border-amber-300/25 bg-amber-300/[0.07] text-amber-100"
                  }`}
                  title={
                    storageMode === "vercel-kv"
                      ? "กำลังใช้ KV สำหรับจัดเก็บข้อมูล"
                      : "กำลังใช้หน่วยความจำชั่วคราว ข้อมูลอาจหายเมื่อ instance เริ่มใหม่"
                  }
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      storageMode === "vercel-kv" ? "bg-emerald-300" : "bg-amber-300"
                    }`}
                  />
                  {storageMode === "vercel-kv"
                    ? "จัดเก็บผ่าน KV"
                    : "ข้อมูลชั่วคราว · อาจหายหลังรีสตาร์ต"}
                </span>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                ภาพรวมฟาร์ม
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                ดูสถานะบัญชีและสถิติการฟาร์มทั้งหมดในที่เดียว
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowLogModal(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]"
            >
              <span aria-hidden="true">▤</span>
              <span>ประวัติ <span className="text-slate-400">({visibleLogEntries.length})</span></span>
            </button>

            <button
              onClick={() => setShowLuauModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-3.5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-cyan-200"
            >
              <span aria-hidden="true">&lt;/&gt;</span>
              <span>สคริปต์ Luau</span>
            </button>
          </div>
        </header>

        {/* ===================================================================
            TOP SUMMARY (6 key farm metrics)
        =================================================================== */}
        <section className="dashboard-summary-grid grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {/* 1. TOTAL COMBINED GEMS */}
          <div className="group relative overflow-hidden rounded-3xl border border-cyan-500/30 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-cyan-950/40 p-5 backdrop-blur-xl shadow-[0_0_35px_-10px_rgba(6,182,212,0.3)]">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-cyan-500/15 blur-2xl group-hover:bg-cyan-400/25 transition" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-300/90">
                เพชรรวม
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

          {/* 2. TOTAL COMBINED APRIL COINS */}
          <div className="group relative overflow-hidden rounded-3xl border border-pink-500/35 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-fuchsia-950/45 p-5 backdrop-blur-xl shadow-[0_0_35px_-10px_rgba(236,72,153,0.3)]">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-pink-500/15 blur-2xl group-hover:bg-pink-400/25 transition" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-pink-300/90">
                AprilCoins รวม
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-pink-400/30 bg-pink-500/15 text-xl shadow-inner">
                🌸
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2.5">
              <p className="text-2xl sm:text-3xl font-black tracking-tight text-pink-100 tabular-nums drop-shadow-[0_0_12px_rgba(244,114,182,0.35)]">
                {formatNumber(liveSummary.total_april_coins)}
              </p>
            </div>
            <p className="mt-2 text-xs text-slate-400 flex items-center justify-between">
              <span>ยอด AprilCoins รวมทุกจอ</span>
              <span className="font-mono text-pink-300">
                {formatCompact(liveSummary.total_april_coins)} Coins
              </span>
            </p>
          </div>

          {/* 3. ONLINE ACCOUNTS STATUS */}
          <div className="group relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-emerald-950/40 p-5 backdrop-blur-xl shadow-[0_0_35px_-10px_rgba(16,185,129,0.3)]">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-emerald-500/15 blur-2xl group-hover:bg-emerald-400/25 transition" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-300/90">
                บัญชีออนไลน์
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-500/15 text-lg">
                🟢
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <p className="text-2xl sm:text-3xl font-black tracking-tight text-white tabular-nums">
                ออนไลน์ {liveSummary.online_count}{" "}
                <span className="text-base font-semibold text-slate-400">
                  / {liveSummary.total_accounts}
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

          {/* 3. TOTAL WINS & DISCONNECTS */}
          <div className="group relative overflow-hidden rounded-3xl border border-rose-500/25 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-indigo-950/45 p-5 backdrop-blur-xl shadow-[0_0_35px_-10px_rgba(244,63,94,0.25)]">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-amber-500/15 blur-2xl group-hover:bg-amber-400/25 transition" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-300/90">
                ชนะ / หลุดเกม
              </span>
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-500/15 text-xl">
                🏆
              </span>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <div>
                <p className="text-2xl sm:text-3xl font-black tracking-tight text-emerald-300 tabular-nums">
                  {formatNumber(liveSummary.total_wins)}{" "}
                  <span className="text-xs font-bold uppercase text-emerald-400/80">
                    ชนะ
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg sm:text-xl font-black tracking-tight text-rose-400 tabular-nums">
                  {formatNumber(liveSummary.total_disconnects)}{" "}
                  <span className="text-xs font-bold uppercase text-rose-400/80">
                    หลุด
                  </span>
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-400 flex items-center justify-between">
              <span>ชนะรวมทุกจอ</span>
              <span className="font-mono text-rose-300">
                หลุดรวม {formatNumber(liveSummary.total_disconnects)} ครั้ง
              </span>
            </p>
          </div>

          {/* 4. TOTAL COMBINED GOLD */}
          <div className="group relative overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-amber-950/35 p-5 backdrop-blur-xl shadow-[0_0_35px_-10px_rgba(245,158,11,0.25)]">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-amber-500/15 blur-2xl group-hover:bg-amber-400/25 transition" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-amber-300/90">
                Gold รวม
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

          {/* 5. TOTAL FARM TIME (UPTIME) */}
          <div className="group relative overflow-hidden rounded-3xl border border-purple-500/30 bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-purple-950/40 p-5 backdrop-blur-xl shadow-[0_0_35px_-10px_rgba(168,85,247,0.3)]">
            <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-purple-500/15 blur-2xl group-hover:bg-purple-400/25 transition" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-300/90">
                เวลาทำงานรวม
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
        <section className="space-y-4 rounded-2xl border border-white/[0.08] bg-[#111820]/95 p-4 shadow-[0_12px_32px_-26px_rgba(0,0,0,0.9)] sm:p-5">
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
                  <option
                    value="april_coins_desc"
                    className="bg-slate-900 text-white"
                  >
                    🌸 AprilCoins มากสุด
                  </option>
                  <option value="wins_desc" className="bg-slate-900 text-white">
                    🏆 ชนะมากสุด (Wins)
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
                      "ระบบจะส่งเสียงเมื่อเพชร/ชนะเพิ่ม หรือเมื่อไอดีหลุด Offline"
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
                ? "คัดลอกสคริปต์ Luau ไปวางใน Auto-Execute ของ Roblox Executor เพื่อส่งข้อมูลเพชร, ทอง, เลเวล และสถิติชนะ/หลุดเข้ามายังแดชบอร์ดอัตโนมัติ"
                : "ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ Online / Offline ด้านบน"}
            </p>
            {accounts.length === 0 && (
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setShowLuauModal(true)}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-cyan-500/25 hover:opacity-95 transition"
                >
                  <span>📜 ดูโค้ดสคริปต์ Luau สำหรับ Executor</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredAndSortedAccounts.map((acc) => {
              const isOnline = acc.effective_status === "ONLINE";
              const secondsAgo = acc.seconds_since_update ?? 0;
              const activeGemGain = gemFlashMap[acc.user_id] || 0;
              const activeWinGain = winFlashMap[acc.user_id] || 0;
              const recentServerDelta =
                nowTick - (acc.last_gem_gain_at || 0) <= 15
                  ? acc.gems_delta || 0
                  : 0;
              const displayedGemDelta = activeGemGain || recentServerDelta;
              const isGemFlashing = displayedGemDelta > 0;
              const isWinFlashing = activeWinGain > 0;

              const pingColor =
                acc.ping < 80
                  ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10"
                  : acc.ping < 150
                  ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
                  : "text-rose-400 border-rose-500/30 bg-rose-500/10";

              return (
                <article
                  key={acc.user_id}
                  data-online={isOnline ? "true" : "false"}
                  data-flashing={isGemFlashing || isWinFlashing ? "true" : "false"}
                  className={`account-card group relative flex flex-col justify-between overflow-hidden border p-5 sm:p-6 transition-all duration-300 ${
                    isGemFlashing || isWinFlashing
                      ? "border-emerald-400/70"
                      : isOnline
                      ? "border-white/10"
                      : "border-rose-500/25"
                  }`}
                >
                  {/* Subtle status accent */}
                  <div
                    className={`absolute inset-x-0 top-0 h-px ${
                      isGemFlashing || isWinFlashing
                        ? "bg-emerald-300/70"
                        : "bg-white/10"
                    }`}
                  />

                  {/* CARD HEADER: Avatar Headshot + Status + Username + Level Badge */}
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Avatar Headshot with Online/Offline Ring */}
                        <div className="relative shrink-0">
                          <div
                            className={`h-16 w-16 rounded-2xl border p-0.5 ${
                              isOnline
                                ? "border-emerald-400/50"
                                : "border-rose-400/40"
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
                                : `OFFLINE - ขาดการติดต่อเกิน ${OFFLINE_TIMEOUT_SECONDS} วินาที`
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

                            {/* Device / Emu Badge */}
                            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                              <span>{acc.device_name?.startsWith("Android") ? "📱" : "💻"}</span>
                              <span>{acc.device_name || "PC"}</span>
                            </span>

                            {acc.account_age > 0 && (
                              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                                อายุ {acc.account_age} วัน
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Level Badge, Log Save Toggle & Delete Button */}
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-right">
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            LEVEL
                          </span>
                          <span className="text-base sm:text-lg font-black text-white tabular-nums">
                            {acc.level}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() =>
                              handleToggleSaveToLog(
                                acc.user_id,
                                acc.username,
                                acc.save_to_log !== false
                              )
                            }
                            className={`rounded-lg border px-2 py-0.5 text-[10px] font-bold transition ${
                              acc.save_to_log !== false
                                ? "border-amber-400/45 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
                                : "border-slate-600/60 bg-slate-800/70 text-slate-400 hover:text-rose-300 hover:border-rose-500/40"
                            }`}
                            title={
                              acc.save_to_log !== false
                                ? "กำลังตั้งค่า: เก็บไอดีนี้ลง Log ก่อนลบ (คลิกเพื่อเปลี่ยนเป็นไม่เก็บ)"
                                : "กำลังตั้งค่า: ไม่เก็บไอดีนี้ลง Log (คลิกเพื่อเปลี่ยนเป็นเก็บลง Log)"
                            }
                          >
                            {acc.save_to_log !== false
                              ? "📥 เก็บลง Log"
                              : "🚫 ไม่เก็บ Log"}
                          </button>

                          <button
                            onClick={() =>
                              handleDeleteAccount(acc.user_id, acc.username)
                            }
                            className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300 hover:bg-rose-500/25 transition"
                            title="ลบไอดีนี้ออกจากแดชบอร์ด"
                          >
                            ลบการ์ด
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* GEMS & APRIL COINS HIGHLIGHT BOXES */}
                    <div className="mt-5 grid grid-cols-2 gap-2.5">
                      <div
                        className={`rounded-2xl border p-3.5 transition-all duration-500 ${
                          isGemFlashing
                            ? "border-emerald-400 bg-gradient-to-r from-emerald-950/90 via-emerald-900/60 to-cyan-950/80 shadow-[0_0_25px_rgba(16,185,129,0.4)]"
                            : "border-cyan-500/25 bg-slate-950/75"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-1">
                            <span>💎</span>
                            <span>GEMS</span>
                          </span>
                          {displayedGemDelta > 0 && (
                            <span className="inline-flex items-center rounded-full border border-emerald-300/60 bg-emerald-500/30 px-1.5 py-0.2 text-[10px] font-black text-emerald-200 animate-bounce">
                              +{formatCompact(displayedGemDelta)}
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex items-baseline justify-between gap-1">
                          <span
                            className={`text-xl sm:text-2xl font-black tracking-tight tabular-nums transition-colors duration-300 ${
                              isGemFlashing
                                ? "text-emerald-300 drop-shadow-[0_0_14px_rgba(52,211,153,0.75)]"
                                : "text-white"
                            }`}
                          >
                            {formatNumber(acc.gems)}
                          </span>
                        </div>
                        <span className="block text-[10px] font-mono text-slate-400">
                          ({formatCompact(acc.gems)})
                        </span>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3.5">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-pink-300 flex items-center gap-1">
                            <span>🌸</span>
                            <span>APRIL COINS</span>
                          </span>
                        </div>

                        <div className="mt-1 flex items-baseline justify-between gap-1">
                          <span className="text-xl sm:text-2xl font-black tracking-tight text-pink-100 tabular-nums drop-shadow-[0_0_10px_rgba(244,114,182,0.3)]">
                            {formatNumber(acc.april_coins || 0)}
                          </span>
                        </div>
                        <span className="block text-[10px] font-mono text-pink-300/80">
                          ({formatCompact(acc.april_coins || 0)})
                        </span>
                      </div>
                    </div>

                    {/* WINS & DISCONNECTS STATS ROW */}
                    <div className="mt-3 grid grid-cols-2 gap-2.5">
                      <div
                        className={`rounded-2xl border px-3.5 py-2.5 transition-all ${
                          isWinFlashing
                            ? "border-emerald-400 bg-emerald-950/80 shadow-[0_0_20px_rgba(16,185,129,0.35)]"
                            : "border-white/10 bg-white/[0.025]"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-emerald-300 flex items-center gap-1">
                            <span>🏆</span> ชนะด่าน (Wins)
                          </span>
                          {activeWinGain > 0 && (
                            <span className="rounded-full bg-emerald-500/30 px-1.5 py-0.2 text-[10px] font-black text-emerald-200 animate-bounce">
                              +{activeWinGain}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-base sm:text-lg font-black text-emerald-200 tabular-nums">
                          {formatNumber(acc.wins || 0)}{" "}
                          <span className="text-xs font-semibold text-emerald-400/80">
                            ครั้ง
                          </span>
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-3.5 py-2.5">
                        <span className="text-[11px] font-bold text-rose-300 flex items-center gap-1">
                          <span>🔌</span> หลุดเกม (Disconnects)
                        </span>
                        <p className="mt-0.5 text-base sm:text-lg font-black text-rose-200 tabular-nums">
                          {formatNumber(acc.disconnects || 0)}{" "}
                          <span className="text-xs font-semibold text-rose-400/80">
                            ครั้ง
                          </span>
                        </p>
                      </div>
                    </div>

                    {/* GOLD & EXTRA STATS ROW */}
                    <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                      <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-3.5 py-2.5">
                        <span className="text-[11px] font-semibold text-amber-300/90 flex items-center gap-1">
                          <span>🪙</span> Gold
                        </span>
                        <p className="mt-0.5 text-sm sm:text-base font-extrabold text-amber-200 tabular-nums">
                          {formatCompact(acc.gold)}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-3.5 py-2.5">
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
          MODAL: LUAU EXECUTOR SCRIPT & ONE-LINER LOADSTRING
      =================================================================== */}
      {showLuauModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-cyan-500/40 bg-[#080816] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div>
                <h3 className="text-lg font-extrabold text-white">
                  📜 สคริปต์ Luau (v2.4) สำหรับใส่ใน Roblox Executor
                </h3>
                <p className="text-xs text-slate-400">
                  รองรับเช็คชนะด่าน (ResultsUI), นับจำนวนครั้งที่หลุด, และ Timeout 120 วินาทีส่งเข้า{" "}
                  <code className="text-cyan-300">{endpointUrl}</code>
                </p>
              </div>
              <button
                onClick={() => setShowLuauModal(false)}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/10"
              >
                ✕ ปิด
              </button>
            </div>

            <div className="overflow-y-auto p-6 space-y-5">
              {/* 1-Line Loadstring Recommended Box */}
              <div className="rounded-2xl border border-emerald-500/35 bg-emerald-950/25 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                    ⚡ แนะนำ: โค้ดบรรทัดเดียว (ดึงอัปเดตอัตโนมัติผ่าน CDN)
                  </span>
                  <button
                    onClick={() => handleCopy(oneLinerLoadstring, "luau-oneliner")}
                    className="rounded-xl bg-emerald-500/20 border border-emerald-400/40 px-3.5 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 transition"
                  >
                    {copiedText === "luau-oneliner"
                      ? "✓ คัดลอก Loadstring แล้ว!"
                      : "📋 คัดลอกบรรทัดเดียว"}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-xl border border-white/10 bg-slate-950 p-3 text-xs font-mono text-emerald-300">
                  <code>{oneLinerLoadstring}</code>
                </pre>
              </div>

              {/* Full Source Code Box */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                    โค้ดเต็ม tracker.lua v2.4 (วางในโฟลเดอร์ Autoexecute)
                  </span>
                  <button
                    onClick={() => handleCopy(sampleLuauScript, "luau-script")}
                    className="rounded-xl bg-cyan-500/20 border border-cyan-400/40 px-3.5 py-1.5 text-xs font-bold text-cyan-200 hover:bg-cyan-500/30 transition"
                  >
                    {copiedText === "luau-script"
                      ? "✓ คัดลอกโค้ดเต็มแล้ว!"
                      : "📋 คัดลอกโค้ดเต็ม"}
                  </button>
                </div>

                <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950 p-4 text-xs font-mono text-cyan-200 leading-relaxed max-h-96">
                  <code>{sampleLuauScript}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          MODAL: ACCOUNT LOG ARCHIVE (บันทึกไอดีก่อนลบออกจากหน้าเว็บ)
      =================================================================== */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-md">
          <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-amber-500/40 bg-[#080816] shadow-2xl">
            {/* Modal Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 sm:px-6 py-4">
              <div>
                <h3 className="text-lg sm:text-xl font-extrabold text-white flex items-center gap-2">
                  <span>📋</span>
                  <span>ประวัติ Log ไอดีที่ถูกเก็บไว้ ({visibleLogEntries.length} ไอดี)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  ไอดีที่เปิด{" "}
                  <span className="text-amber-300 font-semibold">
                    &ldquo;📥 เก็บลง Log&rdquo;
                  </span>{" "}
                  (ค่าเริ่มต้น) จะถูกบันทึกอัตโนมัติก่อนถูกลบออกจากหน้าเว็บ และหากไอดีกลับมาออนไลน์จะถูกลบออกจาก Log อัตโนมัติ
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSnapshotAllToLog}
                  className="rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-200 hover:bg-emerald-500/25 transition"
                  title="บันทึกไอดีที่อยู่บนหน้าเว็บตอนนี้ (เฉพาะที่ตั้งค่าเก็บลง Log) เข้าสู่ Log ทันที"
                >
                  📥 บันทึกไอดีหน้าเว็บตอนนี้
                </button>
                <button
                  onClick={() => setShowLogModal(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-1.5 text-sm font-bold text-slate-300 hover:bg-white/10"
                >
                  ✕ ปิด
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto p-5 sm:p-6 space-y-5">
              {/* Summary Boxes */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-3.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    📋 ไอดีใน Log ทั้งหมด
                  </span>
                  <p className="mt-1 text-xl sm:text-2xl font-black text-white tabular-nums">
                    {formatNumber(logSummary.total_logs)}{" "}
                    <span className="text-xs font-semibold text-amber-300/80">
                      ไอดี
                    </span>
                  </p>
                </div>

                <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-3.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-300">
                    💎 เพชรรวมใน Log
                  </span>
                  <p className="mt-1 text-xl sm:text-2xl font-black text-cyan-200 tabular-nums">
                    {formatNumber(logSummary.total_gems)}
                  </p>
                  <span className="text-[10px] font-mono text-slate-400">
                    ({formatCompact(logSummary.total_gems)})
                  </span>
                </div>

                <div className="rounded-2xl border border-pink-500/30 bg-fuchsia-950/20 p-3.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-pink-300">
                    🌸 April Fool รวม
                  </span>
                  <p className="mt-1 text-xl sm:text-2xl font-black text-pink-200 tabular-nums">
                    {formatNumber(logSummary.total_april_coins)}
                  </p>
                  <span className="text-[10px] font-mono text-pink-300/80">
                    ({formatCompact(logSummary.total_april_coins)})
                  </span>
                </div>

                <div className="rounded-2xl border border-yellow-500/30 bg-yellow-950/20 p-3.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    🪙 Gold รวมใน Log
                  </span>
                  <p className="mt-1 text-xl sm:text-2xl font-black text-amber-200 tabular-nums">
                    {formatNumber(logSummary.total_gold)}
                  </p>
                  <span className="text-[10px] font-mono text-slate-400">
                    ({formatCompact(logSummary.total_gold)})
                  </span>
                </div>
              </div>

              {/* Search, Sort & Export Toolbar */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-white/10 bg-slate-900/60 p-3.5">
                <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
                  <span className="text-slate-400">🔍</span>
                  <input
                    type="text"
                    value={logSearchQuery}
                    onChange={(e) => setLogSearchQuery(e.target.value)}
                    placeholder="ค้นหาชื่อไอดีใน Log..."
                    className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none"
                  />
                  {logSearchQuery && (
                    <button
                      onClick={() => setLogSearchQuery("")}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
                    <span className="text-xs text-slate-400">เรียง:</span>
                    <select
                      value={logSortBy}
                      onChange={(e) =>
                        setLogSortBy(
                          e.target.value as
                            | "logged_at_desc"
                            | "gems_desc"
                            | "april_coins_desc"
                            | "level_desc"
                            | "gold_desc"
                        )
                      }
                      className="bg-transparent text-xs font-bold text-amber-200 focus:outline-none cursor-pointer"
                    >
                      <option
                        value="logged_at_desc"
                        className="bg-slate-900 text-white"
                      >
                        🕒 บันทึกล่าสุด
                      </option>
                      <option
                        value="gems_desc"
                        className="bg-slate-900 text-white"
                      >
                        💎 เพชรมากสุด
                      </option>
                      <option
                        value="april_coins_desc"
                        className="bg-slate-900 text-white"
                      >
                        🌸 April Fool มากสุด
                      </option>
                      <option
                        value="level_desc"
                        className="bg-slate-900 text-white"
                      >
                        ⭐ เลเวลมากสุด
                      </option>
                      <option
                        value="gold_desc"
                        className="bg-slate-900 text-white"
                      >
                        🪙 Gold มากสุด
                      </option>
                    </select>
                  </div>

                  {filteredLogs.length > 0 && (
                    <button
                      onClick={() =>
                        handleCopy(formatLogExportText(), "log-export-all")
                      }
                      className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-500/25 transition"
                    >
                      {copiedText === "log-export-all"
                        ? "✓ คัดลอกทั้งหมดแล้ว!"
                        : "📋 คัดลอกรายการทั้งหมด"}
                    </button>
                  )}

                  {logEntries.length > 0 && (
                    <button
                      onClick={handleClearAllLogs}
                      className="rounded-xl border border-rose-500/35 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/25 transition"
                    >
                      🗑️ ล้าง Log ทั้งหมด
                    </button>
                  )}
                </div>
              </div>

              {/* Log Entries List */}
              {filteredLogs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/15 bg-slate-900/40 p-10 text-center space-y-2">
                  <div className="text-3xl">📋</div>
                  <p className="text-base font-bold text-white">
                    {logEntries.length === 0
                      ? "ยังไม่มีไอดีถูกบันทึกใน Log"
                      : "ไม่พบไอดีใน Log ที่ตรงกับคำค้นหา"}
                  </p>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    เมื่อระบบลบไอดีออกจากหน้าเว็บ (หรือกดปุ่ม &ldquo;ลบการ์ด&rdquo; / &ldquo;ล้างจอ Offline&rdquo;) ไอดีที่ตั้งค่า{" "}
                    <span className="text-amber-300 font-semibold">
                      📥 เก็บลง Log
                    </span>{" "}
                    จะถูกบันทึกข้อมูลไว้ที่นี่โดยอัตโนมัติ
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/70">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 bg-slate-900/80 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        <th className="py-3 px-4">ชื่อไอดี (Account)</th>
                        <th className="py-3 px-4">🖥️ จอ / Emu</th>
                        <th className="py-3 px-4">💎 เพชร (Gems)</th>
                        <th className="py-3 px-4">🌸 April Fool</th>
                        <th className="py-3 px-4">⭐ Level</th>
                        <th className="py-3 px-4">🪙 Gold</th>
                        <th className="py-3 px-4">สาเหตุ / เวลาบันทึก</th>
                        <th className="py-3 px-4 text-right">จัดการ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-xs sm:text-sm">
                      {filteredLogs.map((item) => {
                        const rowCopyText = `[${item.device_name || "PC"}] ${item.username} | Gems: ${formatNumber(
                          item.gems
                        )} | April Fool: ${formatNumber(
                          item.april_coins || 0
                        )} | Lv.${item.level} | Gold: ${formatNumber(
                          item.gold
                        )}`;
                        const agoSec = Math.max(
                          0,
                          nowTick - (item.logged_at || nowTick)
                        );

                        return (
                          <tr
                            key={item.user_id}
                            className="hover:bg-white/[0.03] transition"
                          >
                            {/* Username & Avatar */}
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-3">
                                <img
                                  src={
                                    item.avatar_url ||
                                    generateFallbackAvatarSvg(item.username)
                                  }
                                  alt={item.username}
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).src =
                                      generateFallbackAvatarSvg(item.username);
                                  }}
                                  className="h-10 w-10 rounded-xl bg-slate-900 object-cover border border-white/10 shrink-0"
                                />
                                <div className="min-w-0">
                                  <p className="font-extrabold text-white truncate">
                                    {item.username}
                                  </p>
                                  <p className="text-[11px] font-mono text-slate-400 truncate">
                                    ID: {item.user_id}
                                  </p>
                                </div>
                              </div>
                            </td>

                            {/* Device / Emu */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5 rounded-lg border border-purple-400/35 bg-purple-500/15 px-2.5 py-1 text-xs font-bold text-purple-200">
                                <span>{item.device_name?.startsWith("Android") ? "📱" : "💻"}</span>
                                <span>{item.device_name || "PC"}</span>
                              </span>
                            </td>

                            {/* Gems */}
                            <td className="py-3.5 px-4">
                              <span className="font-black text-cyan-300 tabular-nums">
                                {formatNumber(item.gems)}
                              </span>
                              <span className="block text-[10px] font-mono text-slate-400">
                                ({formatCompact(item.gems)})
                              </span>
                            </td>

                            {/* April Fool (AprilCoins) */}
                            <td className="py-3.5 px-4">
                              <span className="font-black text-pink-300 tabular-nums">
                                {formatNumber(item.april_coins || 0)}
                              </span>
                              <span className="block text-[10px] font-mono text-pink-400/70">
                                ({formatCompact(item.april_coins || 0)})
                              </span>
                            </td>

                            {/* Level */}
                            <td className="py-3.5 px-4">
                              <span className="inline-flex items-center rounded-lg border border-purple-400/35 bg-purple-500/15 px-2.5 py-1 font-black text-purple-200 tabular-nums">
                                Lv. {item.level}
                              </span>
                            </td>

                            {/* Gold */}
                            <td className="py-3.5 px-4">
                              <span className="font-extrabold text-amber-300 tabular-nums">
                                {formatNumber(item.gold)}
                              </span>
                              <span className="block text-[10px] font-mono text-slate-400">
                                ({formatCompact(item.gold)})
                              </span>
                            </td>

                            {/* Reason & Timestamp */}
                            <td className="py-3.5 px-4">
                              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                                {item.reason || "บันทึกก่อนลบ"}
                              </span>
                              <span className="block text-[11px] text-slate-400 mt-1">
                                {formatRelativeThaiTime(agoSec)}
                              </span>
                            </td>

                            {/* Actions */}
                            <td className="py-3.5 px-4 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  onClick={() =>
                                    handleCopy(
                                      rowCopyText,
                                      `log-row-${item.user_id}`
                                    )
                                  }
                                  className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 px-2.5 py-1 text-xs font-bold text-cyan-200 hover:bg-cyan-500/20 transition"
                                  title="คัดลอกข้อมูลไอดีนี้"
                                >
                                  {copiedText === `log-row-${item.user_id}`
                                    ? "✓ Copied"
                                    : "คัดลอก"}
                                </button>
                                <button
                                  onClick={() =>
                                    handleDeleteLogEntry(
                                      item.user_id,
                                      item.username
                                    )
                                  }
                                  className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-bold text-rose-300 hover:bg-rose-500/25 transition"
                                  title="ลบไอดีนี้ออกจากประวัติ Log"
                                >
                                  ลบ
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
