"use client";

import React from "react";
import type { TeamUnitInfo } from "@/app/lib/telemetry-types";

interface TeamStripProps {
  team?: TeamUnitInfo[];
  compact?: boolean;
}

const TRAIT_STYLE: Record<string, string> = {
  unique: "border-amber-400/50 bg-amber-500/20 text-amber-200",
  divine: "border-rose-400/50 bg-rose-500/20 text-rose-200",
  golden: "border-yellow-400/50 bg-yellow-500/20 text-yellow-200",
  celestial: "border-fuchsia-400/50 bg-fuchsia-500/20 text-fuchsia-200",
  reaper: "border-purple-400/50 bg-purple-500/20 text-purple-200",
  godspeed: "border-cyan-400/50 bg-cyan-500/20 text-cyan-200",
};

function getTraitBadgeClass(trait: string): string {
  const key = trait.trim().toLowerCase();
  return (
    TRAIT_STYLE[key] ||
    "border-sky-400/35 bg-sky-500/15 text-sky-200"
  );
}

export default function TeamStrip({ team, compact = false }: TeamStripProps) {
  if (!Array.isArray(team) || team.length === 0) {
    return null;
  }

  const sorted = [...team].sort((a, b) => (a.slot || 0) - (b.slot || 0));

  return (
    <div
      className={`rounded-2xl border border-indigo-500/25 bg-indigo-950/20 ${
        compact ? "p-2.5" : "p-3"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-200 flex items-center gap-1.5">
          <span>🛡️</span>
          <span>ทีมปัจจุบัน ({sorted.length} ตัว)</span>
        </span>
      </div>

      <div
        className={`grid gap-1.5 ${
          compact
            ? "grid-cols-2 sm:grid-cols-3"
            : "grid-cols-2 sm:grid-cols-3"
        }`}
      >
        {sorted.map((u, idx) => {
          const traitText =
            u.trait ||
            (Array.isArray(u.traits) && u.traits.length > 0
              ? u.traits.join(", ")
              : "");

          return (
            <div
              key={`${u.slot || idx}-${u.name}`}
              className="flex flex-col justify-between rounded-xl border border-white/10 bg-slate-950/75 px-2.5 py-1.5 min-w-0"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-mono text-slate-500">
                  #{u.slot || idx + 1}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {u.shiny && (
                    <span
                      className="text-[10px]"
                      title="Shiny"
                    >
                      ✨
                    </span>
                  )}
                  <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] font-bold text-slate-200 tabular-nums">
                    Lv.{u.level || 1}
                  </span>
                </div>
              </div>

              <p
                className="mt-0.5 truncate text-[11px] font-bold text-white"
                title={u.name}
              >
                {u.name}
              </p>

              {traitText && (
                <span
                  className={`mt-1 inline-block w-fit max-w-full truncate rounded-md border px-1.5 py-0.2 text-[10px] font-bold ${getTraitBadgeClass(
                    traitText
                  )}`}
                  title={traitText}
                >
                  {traitText}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
