"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatMarketDate } from "@/lib/format";

export interface HistoryPoint {
  /** ISO date, ascending order. */
  date: string;
  value: number;
}

/** Small trend chart shared by the policy-rate and inflation cards. Not a
 * price-direction indicator, so it intentionally does NOT use the --up/--down
 * tokens — callers pass a plain theme color instead. */
export function HistoryChart({
  data,
  color,
  valueFormatter,
  height = 140,
}: {
  data: HistoryPoint[];
  color: string;
  valueFormatter: (v: number) => string;
  height?: number;
}) {
  if (data.length < 2) return null;
  const gradientId = `macro-hist-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div style={{ height }} className="mt-3 -mx-1">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="var(--color-muted-foreground)" strokeOpacity={0.1} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
            tickMargin={4}
            tickFormatter={(v) => formatMarketDate(String(v), "monthYear")}
            interval="equidistantPreserveStart"
            minTickGap={36}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 9, fill: "var(--color-muted-foreground)" }}
            tickMargin={4}
            tickFormatter={(v) => valueFormatter(Number(v))}
            domain={["auto", "auto"]}
            width={38}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "10px",
              fontSize: "12px",
              color: "var(--color-card-foreground)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            }}
            labelFormatter={(label) => formatMarketDate(String(label), "monthYear")}
            formatter={(value: unknown) => [valueFormatter(Number(value)), ""]}
          />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 3, fill: color }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
