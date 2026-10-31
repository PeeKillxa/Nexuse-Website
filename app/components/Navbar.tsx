"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavIconName = "overview" | "customers" | "finance" | "party";

const navItems: { href: string; label: string; icon: NavIconName }[] = [
  { href: "/", label: "ภาพรวม", icon: "overview" },
  { href: "/customers", label: "บัญชีลูกค้า", icon: "customers" },
  { href: "/finance", label: "การเงิน", icon: "finance" },
  { href: "/party", label: "ปาร์ตี้", icon: "party" },
];

function NavIcon({ name }: { name: NavIconName }) {
  const shared = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" {...shared}>
      {name === "overview" && <path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" />}
      {name === "customers" && (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
        </>
      )}
      {name === "finance" && (
        <>
          <rect x="3" y="5" width="18" height="15" rx="2" />
          <path d="M3 9h18M16 14h.01" />
        </>
      )}
      {name === "party" && (
        <>
          <path d="m16 3 4 4-4 4M4 7h16M8 21l-4-4 4-4m12 4H4" />
        </>
      )}
    </svg>
  );
}

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="เมนูหลัก"
      className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#0a0f15]/90 backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <Link href="/" className="group flex w-fit items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-sm font-black tracking-tight text-cyan-100">
            N
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-bold tracking-[0.14em] text-slate-100">NEXUSE</span>
            <span className="mt-0.5 text-[10px] font-medium tracking-[0.11em] text-slate-500">FARM OPERATIONS</span>
          </span>
        </Link>

        <div className="nav-scrollbar -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:-mx-6 sm:px-6 md:mx-0 md:w-auto md:px-0 lg:mx-0">
          <div className="flex min-w-max items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.025] p-1">
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname?.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:text-sm ${
                    isActive
                      ? "bg-white/[0.09] text-white shadow-sm"
                      : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100"
                  }`}
                >
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
