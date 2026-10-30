"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  const navItems = [
    {
      href: "/",
      label: "มอนิเตอร์บอทฟาร์ม",
      icon: "📡",
      badge: "LIVE",
      activeColor:
        "border-cyan-400/50 bg-cyan-500/15 text-cyan-200 shadow-[0_0_20px_-5px_rgba(6,182,212,0.35)]",
    },
    {
      href: "/customers",
      label: "บัญชีลูกค้า",
      icon: "👥",
      badge: "NEW",
      activeColor:
        "border-blue-400/50 bg-blue-500/15 text-blue-200 shadow-[0_0_20px_-5px_rgba(59,130,246,0.35)]",
    },
    {
      href: "/finance",
      label: "คำนวณเงิน (หาร 2)",
      icon: "💰",
      badge: "50/50",
      activeColor:
        "border-emerald-400/50 bg-emerald-500/15 text-emerald-200 shadow-[0_0_20px_-5px_rgba(16,185,129,0.35)]",
    },
    {
      href: "/party",
      label: "ตั้งค่าตี้รันสคริปต์ (Party Sync)",
      icon: "🛡️",
      badge: "SYNC",
      activeColor:
        "border-purple-400/50 bg-purple-500/15 text-purple-200 shadow-[0_0_20px_-5px_rgba(168,85,247,0.35)]",
    },
  ];

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-white/10 bg-[#070913]/85 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-7xl flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 via-purple-600 to-emerald-500 p-[1px] shadow-md shadow-cyan-500/15">
            <div className="flex h-full w-full items-center justify-center rounded-[11px] bg-[#090919] text-base">
              ⚡
            </div>
          </div>
          <div>
            <span className="text-sm sm:text-base font-black tracking-tight bg-gradient-to-r from-white via-cyan-200 to-purple-300 bg-clip-text text-transparent">
              NEXUS CONTROL CENTER
            </span>
            <span className="hidden sm:inline-block ml-2 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
              v3.0
            </span>
          </div>
        </Link>

        {/* Navigation Links */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname?.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs sm:text-sm font-bold transition-all ${
                  isActive
                    ? item.activeColor
                    : "border-transparent bg-white/[0.03] text-slate-400 hover:border-white/10 hover:bg-white/[0.07] hover:text-slate-100"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
                {item.badge && (
                  <span
                    className={`hidden md:inline-block rounded-md px-1.5 py-0.5 text-[10px] font-extrabold ${
                      isActive
                        ? "bg-white/15 text-white"
                        : "bg-white/5 text-slate-500"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
