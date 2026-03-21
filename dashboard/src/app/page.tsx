"use client";

import { StatsCards } from "@/components/dashboard/StatsCards";
import { LatestEvents } from "@/components/dashboard/LatestEvents";
import { PriceSnapshot } from "@/components/dashboard/PriceSnapshot";
import { motion } from "framer-motion";

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">BIST piyasa verileri, olaylar ve sistem durumu</p>
      </motion.div>

      <StatsCards />

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Takip Listesi</h2>
        <PriceSnapshot />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.3 }}
        className="bg-card rounded-xl border border-border overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Son Olaylar</h2>
          <span className="text-[11px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded-md">CANLI</span>
        </div>
        <LatestEvents />
      </motion.div>
    </div>
  );
}
