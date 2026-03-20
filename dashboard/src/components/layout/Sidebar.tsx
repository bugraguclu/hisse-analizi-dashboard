"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Newspaper,
  BarChart3,
  TrendingUp,
  Building2,
  Globe,
  Search,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/events", label: "Olaylar & KAP", icon: Newspaper },
  { href: "/hisse/THYAO", label: "Hisse Analizi", icon: BarChart3, match: "/hisse" },
  { href: "/teknik/THYAO", label: "Teknik Analiz", icon: TrendingUp, match: "/teknik" },
  { href: "/temel/THYAO", label: "Temel Analiz", icon: Building2, match: "/temel" },
  { href: "/makro", label: "Makro Ekonomi", icon: Globe },
  { href: "/tarama", label: "Hisse Tarama", icon: Search },
];

export function Sidebar() {
  const pathname = usePathname();

  function isActive(item: (typeof navItems)[0]) {
    if (item.match) return pathname.startsWith(item.match);
    return pathname === item.href;
  }

  return (
    <aside className="w-[240px] bg-[#1a2332] min-h-screen flex flex-col fixed left-0 top-0 bottom-0 z-40">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-sm">
            H
          </div>
          <div>
            <div className="text-sm font-bold text-white">Hisse Analizi</div>
            <div className="text-[10px] text-slate-400 font-mono">v0.4.0</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all ${
                active
                  ? "bg-teal-500/15 text-teal-400"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              }`}
            >
              <Icon className="h-[18px] w-[18px] flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <a
          href="/docs"
          target="_blank"
          className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          API Docs (Swagger)
        </a>
      </div>
    </aside>
  );
}
