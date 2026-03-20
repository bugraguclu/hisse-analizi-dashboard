"use client";

import { TickerSearch } from "@/components/shared/TickerSearch";
import { Bell } from "lucide-react";

export function TopBar() {
  return (
    <header className="h-14 bg-white border-b border-slate-100 flex items-center justify-between px-6 sticky top-0 z-30">
      <div className="w-72">
        <TickerSearch />
      </div>
      <div className="flex items-center gap-4">
        <button className="relative p-2 text-slate-400 hover:text-slate-600 transition-colors">
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-teal-500 rounded-full" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">
            U
          </div>
        </div>
      </div>
    </header>
  );
}
