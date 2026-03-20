"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatNumber, formatPercent } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";

function MacroCard({ title, children, isLoading: loading }: { title: string; children: React.ReactNode; isLoading?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-4">{title}</h2>
      {loading ? <LoadingSpinner /> : children}
    </div>
  );
}

export default function MakroPage() {
  const rateQ = useQuery({ queryKey: ["policy-rate"], queryFn: () => api.policyRate() });
  const infQ = useQuery({ queryKey: ["inflation"], queryFn: () => api.inflation() });
  const usdQ = useQuery({ queryKey: ["fx-usd"], queryFn: () => api.fx("USD") });
  const eurQ = useQuery({ queryKey: ["fx-eur"], queryFn: () => api.fx("EUR") });
  const gbpQ = useQuery({ queryKey: ["fx-gbp"], queryFn: () => api.fx("GBP") });
  const tcmbQ = useQuery({ queryKey: ["tcmb"], queryFn: () => api.tcmb() });
  const calQ = useQuery({ queryKey: ["calendar"], queryFn: () => api.calendar() });

  const rate = rateQ.data as Record<string, unknown> | null;
  const rateVal = rate?.rate || rate?.policy_rate || rate?.value;
  const inf = infQ.data as Record<string, unknown> | null;

  function fxCard(label: string, data: Record<string, unknown> | null) {
    if (!data) return <EmptyState message="Veri yok" />;
    const price = data.close || data.price || data.rate || data.value;
    const change = data.change_pct || data.change_percent || 0;
    const isUp = Number(change) >= 0;
    return (
      <div>
        <div className="text-2xl font-bold font-mono text-slate-800">{price != null ? formatNumber(Number(price), 4) : "-"}</div>
        <div className={`text-xs font-semibold mt-1 ${isUp ? "text-red-500" : "text-emerald-600"}`}>
          {isUp ? "+" : ""}{formatNumber(Number(change))}%
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Makro Ekonomi</h1>
        <p className="text-sm text-slate-400 mt-0.5">TCMB, enflasyon, doviz kurlari, ekonomik takvim</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-400 uppercase mb-2">Politika Faizi</div>
          <div className="text-2xl font-bold font-mono text-teal-600">
            {rateVal != null ? formatPercent(Number(rateVal)) : rateQ.isLoading ? "..." : "-"}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-400 uppercase mb-2">Enflasyon (TUFE)</div>
          <div className="text-2xl font-bold font-mono text-amber-600">
            {inf ? formatPercent(Number(inf.rate || inf.value || inf.cpi || 0)) : infQ.isLoading ? "..." : "-"}
          </div>
        </div>
        <MacroCard title="USD/TRY" isLoading={usdQ.isLoading}>{fxCard("USD/TRY", usdQ.data as Record<string, unknown> | null)}</MacroCard>
        <MacroCard title="EUR/TRY" isLoading={eurQ.isLoading}>{fxCard("EUR/TRY", eurQ.data as Record<string, unknown> | null)}</MacroCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MacroCard title="GBP/TRY" isLoading={gbpQ.isLoading}>{fxCard("GBP/TRY", gbpQ.data as Record<string, unknown> | null)}</MacroCard>
        <MacroCard title="TCMB Verileri" isLoading={tcmbQ.isLoading}>
          {tcmbQ.data ? (
            <pre className="text-xs font-mono bg-slate-50 p-3 rounded-lg overflow-auto max-h-64">{JSON.stringify(tcmbQ.data, null, 2)}</pre>
          ) : <EmptyState />}
        </MacroCard>
      </div>

      <MacroCard title="Ekonomik Takvim" isLoading={calQ.isLoading}>
        {calQ.data ? (
          <pre className="text-xs font-mono bg-slate-50 p-3 rounded-lg overflow-auto max-h-80">{JSON.stringify(calQ.data, null, 2)}</pre>
        ) : <EmptyState message="Takvim verisi yok" />}
      </MacroCard>
    </div>
  );
}
