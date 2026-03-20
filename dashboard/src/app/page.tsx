"use client";

import { StatsCards } from "@/components/dashboard/StatsCards";
import { LatestEvents } from "@/components/dashboard/LatestEvents";
import { PriceSnapshot } from "@/components/dashboard/PriceSnapshot";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-400 mt-0.5">BIST piyasa verileri, olaylar ve sistem durumu</p>
      </div>
      <StatsCards />
      <PriceSnapshot />
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Son Olaylar</h2>
          <span className="text-[11px] font-mono text-teal-600 bg-teal-50 px-2 py-0.5 rounded-md">CANLI</span>
        </div>
        <LatestEvents />
      </div>
    </div>
  );
}
