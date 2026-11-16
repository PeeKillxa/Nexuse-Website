"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { MatchLogEntry } from "@/app/lib/telemetry-types";

interface MatchHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialUsername?: string;
  onLogsChanged?: () => void;
}

function fmtNum(n?: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(Number(n || 0)));
}

function fmtDateTime(epochSec?: number): string {
  if (!epochSec) return "-";
  return new Date(epochSec * 1000).toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDiscordWebhookText(item: MatchLogEntry): string {
  const lines: string[] = [];
  lines.push("Anime Adventures");
  lines.push(`User: ${item.display_name || item.username} (@${item.username})`);
  lines.push(
    item.player_xp !== undefined
      ? `Level: ${item.level} [${fmtNum(item.player_xp)} XP]`
      : `Level: ${item.level}`
  );
  lines.push("Player Stats");
  lines.push(`💎 Gems: ${fmtNum(item.gems)}`);
  lines.push(`🪙 Gold: ${fmtNum(item.gold)}`);
  lines.push(`🦪 Summer Pearls: ${fmtNum(item.summer_pearls)}`);
  lines.push(`🎲 Trait Reroll: ${fmtNum(item.rerolls)}`);

  if (item.rewards && item.rewards.length > 0) {
    lines.push("Rewards");
    item.rewards.forEach((r) => lines.push(r));
  }
  if (item.portals && item.portals.length > 0) {
    lines.push("Portals");
    item.portals.forEach((p) => {
      const tierStr = p.tier ? ` [T${p.tier}]` : "";
      lines.push(`🌀 ${p.name}${tierStr} x${p.count}`);
    });
  }
  if (item.units && item.units.length > 0) {
    lines.push("Units");
    item.units.forEach((u) => {
      lines.push(
        `[ ${u.count} ] ${u.name} = ${fmtNum(u.kills)} ⚔️ - [Upg ${u.upg_cur}/${u.upg_max}]`
      );
    });
  }
  lines.push("Match Result");
  lines.push(
    `${item.result === "VICTORY" ? "🏆 Victory" : "💀 Defeat"} - ${item.duration || "00:00"} - Wave ${item.wave}`
  );
  lines.push(
    item.difficulty ? `${item.map_name} - ${item.difficulty}` : item.map_name
  );
  lines.push(`${fmtNum(item.kills)} kills - ${fmtNum(item.damage)} dmg`);
  return lines.join("\n");
}

export default function MatchHistoryModal({
  isOpen,
  onClose,
  initialUsername = "",
  onLogsChanged,
}: MatchHistoryModalProps) {
  const [logs, setLogs] = useState<MatchLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(initialUsername);
  const [resultFilter, setResultFilter] = useState<"ALL" | "VICTORY" | "DEFEAT">("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSearch(initialUsername || "");
    }
  }, [isOpen, initialUsername]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/match-logs", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as {
          ok: boolean;
          logs?: MatchLogEntry[];
        };
        if (data.ok && Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadLogs();
    const timer = setInterval(loadLogs, 15000);
    return () => clearInterval(timer);
  }, [isOpen, loadLogs]);

  const activeUserFilter = useMemo(() => {
    const q = search.trim().replace(/^@/, "");
    return q;
  }, [search]);

  const filtered = useMemo(() => {
    const q = activeUserFilter.toLowerCase();
    return logs.filter((item) => {
      if (resultFilter !== "ALL" && item.result !== resultFilter) return false;
      if (!q) return true;
      return (
        item.username?.toLowerCase().includes(q) ||
        item.display_name?.toLowerCase().includes(q) ||
        item.map_name?.toLowerCase().includes(q)
      );
    });
  }, [logs, activeUserFilter, resultFilter]);

  const stats = useMemo(() => {
    let wins = 0;
    let defeats = 0;
    filtered.forEach((x) => {
      if (x.result === "VICTORY") wins++;
      else defeats++;
    });
    return { total: filtered.length, wins, defeats };
  }, [filtered]);

  const handleCopy = (item: MatchLogEntry) => {
    navigator.clipboard.writeText(formatDiscordWebhookText(item));
    setCopiedId(item.id);
    setTimeout(() => setCopiedId((p) => (p === item.id ? null : p)), 2000);
  };

  const handleDeleteOne = async (id: string) => {
    setBusyDelete(true);
    try {
      const res = await fetch(
        `/api/match-logs?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.logs)) setLogs(data.logs);
        else setLogs((prev) => prev.filter((x) => x.id !== id));
        onLogsChanged?.();
      }
    } finally {
      setBusyDelete(false);
    }
  };

  const handleClearUser = async (username: string) => {
    if (
      !confirm(
        `ต้องการลบประวัติการจบด่านทั้งหมดของ @${username} (จบงานแล้ว) ใช่หรือไม่?`
      )
    ) {
      return;
    }
    setBusyDelete(true);
    try {
      const res = await fetch(
        `/api/match-logs?username=${encodeURIComponent(username)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.logs)) setLogs(data.logs);
        onLogsChanged?.();
      }
    } finally {
      setBusyDelete(false);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("ต้องการล้างประวัติ Webhook จบด่านทั้งหมดในระบบใช่หรือไม่?")) {
      return;
    }
    setBusyDelete(true);
    try {
      const res = await fetch("/api/match-logs?mode=all", { method: "DELETE" });
      if (res.ok) {
        setLogs([]);
        onLogsChanged?.();
      }
    } finally {
      setBusyDelete(false);
    }
  };

  if (!isOpen) return null;

  const exactMatchedUsername = useMemoOrNull(logs, activeUserFilter);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-5 backdrop-blur-md">
      <div className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-indigo-500/40 bg-[#0b0e18] shadow-2xl">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 sm:px-6 py-4">
          <div>
            <h3 className="text-lg sm:text-xl font-extrabold text-white flex items-center gap-2">
              <span>📜</span>
              <span>ประวัติจบด่าน Webhook ({stats.total} รอบ)</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              บันทึกอัตโนมัติทุกครั้งที่จบเกม (ResultsUI) · กดลบได้ทันทีเมื่อส่งงานลูกค้าเสร็จแล้ว
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadLogs}
              disabled={loading}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10 transition"
            >
              {loading ? "⏳" : "🔄 รีเฟรช"}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-1.5 text-sm font-bold text-slate-300 hover:bg-white/10"
            >
              ✕ ปิด
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 bg-slate-900/50 px-5 py-3">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2">
            <span className="text-slate-400 text-xs">🔍</span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="กรองตาม @Username หรือชื่อแมพ..."
              className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-slate-950 p-1 text-xs">
              {(
                [
                  { id: "ALL", label: `ทั้งหมด (${stats.total})` },
                  { id: "VICTORY", label: `🏆 ชนะ (${stats.wins})` },
                  { id: "DEFEAT", label: `💀 แพ้ (${stats.defeats})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setResultFilter(tab.id)}
                  className={`rounded-lg px-2.5 py-1 font-bold transition ${
                    resultFilter === tab.id
                      ? "bg-indigo-500/30 border border-indigo-400/50 text-indigo-100"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {exactMatchedUsername && (
              <button
                disabled={busyDelete}
                onClick={() => handleClearUser(exactMatchedUsername)}
                className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-200 hover:bg-rose-500/30 transition disabled:opacity-50"
              >
                🗑️ ลบประวัติ @{exactMatchedUsername} (จบงานแล้ว)
              </button>
            )}

            {logs.length > 0 && !exactMatchedUsername && (
              <button
                disabled={busyDelete}
                onClick={handleClearAll}
                className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/25 transition disabled:opacity-50"
              >
                🗑️ ล้างประวัติทั้งหมด
              </button>
            )}
          </div>
        </div>

        {/* Body: Discord Embed Style Cards */}
        <div className="overflow-y-auto p-5 space-y-4">
          {loading && logs.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              ⏳ กำลังโหลดประวัติการจบด่าน...
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/15 bg-slate-900/40 p-10 text-center space-y-2">
              <div className="text-3xl">📜</div>
              <p className="text-base font-bold text-white">
                ยังไม่มีประวัติ Webhook จบด่าน
              </p>
              <p className="text-xs text-slate-400">
                เมื่อบอทเล่นจบตาแล้วหน้า ResultsUI เด้งขึ้นมา ข้อมูลรางวัล ยูนิต และผลแมพจะถูกบันทึกมาแสดงที่นี่ทันที
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filtered.map((item) => {
                const isWin = item.result === "VICTORY";
                return (
                  <article
                    key={item.id}
                    className={`relative overflow-hidden rounded-2xl border bg-[#111420] p-4 shadow-lg border-l-4 ${
                      isWin
                        ? "border-white/10 border-l-emerald-400"
                        : "border-white/10 border-l-rose-500"
                    }`}
                  >
                    {/* Header: Game + User + Level */}
                    <div className="flex items-start justify-between gap-2 border-b border-white/10 pb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={
                            item.avatar_url ||
                            `https://www.roblox.com/headshot-thumbnail/image?userId=${item.user_id || 1}&width=150&height=150&format=png`
                          }
                          alt={item.username}
                          className="h-10 w-10 rounded-xl bg-slate-900 object-cover border border-white/10 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-300">
                              Anime Adventures
                            </span>
                            {item.device_name && (
                              <span className="rounded bg-white/5 px-1.5 py-0.2 text-[10px] text-slate-400">
                                {item.device_name}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-sm font-extrabold text-white">
                            {item.display_name || item.username}{" "}
                            <span className="font-mono text-xs font-normal text-cyan-300">
                              (@{item.username})
                            </span>
                          </p>
                          <p className="text-[11px] text-slate-300 font-semibold">
                            Level: <span className="text-white font-bold">{item.level}</span>
                            {item.player_xp !== undefined && item.player_xp > 0 && (
                              <span className="text-slate-400 font-mono">
                                {" "}
                                [{fmtNum(item.player_xp)} XP]
                              </span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleCopy(item)}
                          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-bold text-slate-200 hover:bg-white/10"
                          title="คัดลอกข้อความแบบ Webhook"
                        >
                          {copiedId === item.id ? "✓" : "📋"}
                        </button>
                        <button
                          onClick={() => handleDeleteOne(item.id)}
                          className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] font-bold text-rose-300 hover:bg-rose-500/25"
                          title="ลบประวัตินี้"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {/* Player Stats */}
                    <div className="mt-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                        Player Stats
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-xs font-bold">
                        <div className="rounded-lg bg-slate-950/75 border border-white/5 px-2.5 py-1.5 text-cyan-300">
                          💎 {fmtNum(item.gems)}
                        </div>
                        <div className="rounded-lg bg-slate-950/75 border border-white/5 px-2.5 py-1.5 text-amber-300">
                          🪙 {fmtNum(item.gold)}
                        </div>
                        <div className="rounded-lg bg-slate-950/75 border border-white/5 px-2.5 py-1.5 text-pink-300">
                          🦪 {fmtNum(item.summer_pearls)}
                        </div>
                        <div className="rounded-lg bg-slate-950/75 border border-white/5 px-2.5 py-1.5 text-purple-300">
                          🎲 {fmtNum(item.rerolls)}
                        </div>
                      </div>
                    </div>

                    {/* Rewards & Portals */}
                    {(item.rewards.length > 0 || item.portals.length > 0) && (
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {item.rewards.length > 0 && (
                          <div className="rounded-xl border border-white/5 bg-slate-950/60 p-2.5">
                            <p className="text-[11px] font-bold text-emerald-300 mb-1">
                              Rewards
                            </p>
                            <ul className="space-y-0.5 text-xs text-slate-200 font-medium">
                              {item.rewards.map((r, idx) => (
                                <li key={idx}>{r}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {item.portals.length > 0 && (
                          <div className="rounded-xl border border-white/5 bg-slate-950/60 p-2.5">
                            <p className="text-[11px] font-bold text-sky-300 mb-1">
                              Portals
                            </p>
                            <ul className="space-y-0.5 text-xs text-slate-200 font-medium">
                              {item.portals.map((p, idx) => (
                                <li key={idx}>
                                  🌀 {p.name}
                                  {p.tier ? ` [T${p.tier}]` : ""} x{p.count}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Placed Units */}
                    {item.units && item.units.length > 0 && (
                      <div className="mt-3 rounded-xl border border-white/5 bg-slate-950/60 p-2.5">
                        <p className="text-[11px] font-bold text-indigo-300 mb-1">
                          Units
                        </p>
                        <div className="space-y-0.5 font-mono text-[11px] text-slate-200">
                          {item.units.map((u, idx) => (
                            <div key={idx} className="truncate">
                              [ {u.count} ] {u.name} = {fmtNum(u.kills)} ⚔️ - [Upg{" "}
                              {u.upg_cur}/{u.upg_max}]
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Match Result Footer */}
                    <div
                      className={`mt-3 rounded-xl border p-2.5 ${
                        isWin
                          ? "border-emerald-500/30 bg-emerald-950/25"
                          : "border-rose-500/30 bg-rose-950/25"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className={`text-xs font-black ${
                            isWin ? "text-emerald-300" : "text-rose-300"
                          }`}
                        >
                          {isWin ? "🏆 Victory" : "💀 Defeat"} -{" "}
                          {item.duration || "00:00"} - Wave {item.wave}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {fmtDateTime(item.logged_at)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-bold text-white">
                        {item.map_name}
                        {item.difficulty ? ` - ${item.difficulty}` : ""}
                      </p>
                      <p className="mt-0.5 text-[11px] font-mono text-slate-300">
                        {fmtNum(item.kills)} kills - {fmtNum(item.damage)} dmg
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function useMemoOrNull(logs: MatchLogEntry[], query: string): string | null {
  if (!query) return null;
  const q = query.toLowerCase();
  const exact = logs.find((x) => (x.username || "").toLowerCase() === q);
  return exact ? exact.username : null;
}
