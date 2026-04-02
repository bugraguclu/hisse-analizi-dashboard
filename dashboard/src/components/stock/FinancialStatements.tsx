"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCompact, formatNumber } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import { motion } from "framer-motion";
import { FileText, TrendingUp, TrendingDown } from "lucide-react";

type StatementTab = "balance_sheet" | "income_stmt" | "cashflow";

interface FinancialStatementsProps {
  ticker: string;
}

function parseStatementData(raw: unknown): Record<string, unknown>[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const obj = raw as Record<string, unknown>;
  if (obj.data && Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
  if (obj.annual && Array.isArray(obj.annual)) return obj.annual as Record<string, unknown>[];
  // DataFrame-style: {column: {index: value}}
  const keys = Object.keys(obj);
  if (keys.length > 0 && typeof obj[keys[0]] === "object" && obj[keys[0]] !== null) {
    const firstCol = obj[keys[0]] as Record<string, unknown>;
    const indices = Object.keys(firstCol);
    return indices.map((idx) => {
      const row: Record<string, unknown> = { period: idx };
      for (const col of keys) {
        const colData = obj[col] as Record<string, unknown>;
        row[col] = colData?.[idx] ?? null;
      }
      return row;
    });
  }
  return [];
}

function formatStatValue(val: unknown): string {
  if (val === null || val === undefined) return "-";
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return formatCompact(num);
}

const BALANCE_SHEET_KEYS = [
  { key: "TotalAssets", label: { tr: "Toplam Varliklar", en: "Total Assets", fr: "Total des actifs" } },
  { key: "CurrentAssets", label: { tr: "Donen Varliklar", en: "Current Assets", fr: "Actifs courants" } },
  { key: "TotalLiabilitiesNetMinorityInterest", label: { tr: "Toplam Yukumlulukler", en: "Total Liabilities", fr: "Total des passifs" } },
  { key: "CurrentLiabilities", label: { tr: "Kisa Vadeli Yukumlulukler", en: "Current Liabilities", fr: "Passifs courants" } },
  { key: "StockholdersEquity", label: { tr: "Ozsermaye", en: "Stockholders Equity", fr: "Fonds propres" } },
  { key: "CashAndCashEquivalents", label: { tr: "Nakit ve Benzerleri", en: "Cash & Equivalents", fr: "Trésorerie" } },
  { key: "TotalDebt", label: { tr: "Toplam Borc", en: "Total Debt", fr: "Dette totale" } },
  { key: "NetDebt", label: { tr: "Net Borc", en: "Net Debt", fr: "Dette nette" } },
];

const INCOME_KEYS = [
  { key: "TotalRevenue", label: { tr: "Toplam Gelir", en: "Total Revenue", fr: "Revenu total" } },
  { key: "GrossProfit", label: { tr: "Brut Kar", en: "Gross Profit", fr: "Bénéfice brut" } },
  { key: "OperatingIncome", label: { tr: "Faaliyet Geliri", en: "Operating Income", fr: "Résultat opérationnel" } },
  { key: "EBITDA", label: { tr: "FAVOK", en: "EBITDA", fr: "EBITDA" } },
  { key: "NetIncome", label: { tr: "Net Kar", en: "Net Income", fr: "Résultat net" } },
  { key: "BasicEPS", label: { tr: "Hisse Basi Kar", en: "EPS", fr: "BPA" } },
];

const CASHFLOW_KEYS = [
  { key: "OperatingCashFlow", label: { tr: "Isletme Nakit Akisi", en: "Operating Cash Flow", fr: "Flux de trésorerie opérationnel" } },
  { key: "InvestingCashFlow", label: { tr: "Yatirim Nakit Akisi", en: "Investing Cash Flow", fr: "Flux d'investissement" } },
  { key: "FinancingCashFlow", label: { tr: "Finansman Nakit Akisi", en: "Financing Cash Flow", fr: "Flux de financement" } },
  { key: "FreeCashFlow", label: { tr: "Serbest Nakit Akisi", en: "Free Cash Flow", fr: "Flux de trésorerie libre" } },
  { key: "CapitalExpenditure", label: { tr: "Sermaye Harcamasi", en: "Capital Expenditure", fr: "Dépenses d'investissement" } },
];

export function FinancialStatements({ ticker }: FinancialStatementsProps) {
  const { t, locale } = useLocale();
  const [tab, setTab] = useState<StatementTab>("balance_sheet");
  const [quarterly, setQuarterly] = useState(false);

  const bsQ = useQuery({
    queryKey: ["balanceSheet", ticker, quarterly],
    queryFn: () => api.balanceSheet(ticker, quarterly),
  });
  const isQ = useQuery({
    queryKey: ["incomeStatement", ticker, quarterly],
    queryFn: () => api.incomeStatement(ticker, quarterly),
  });
  const cfQ = useQuery({
    queryKey: ["cashflow", ticker, quarterly],
    queryFn: () => api.cashflow(ticker, quarterly),
  });

  const queryMap = { balance_sheet: bsQ, income_stmt: isQ, cashflow: cfQ };
  const keyMap = { balance_sheet: BALANCE_SHEET_KEYS, income_stmt: INCOME_KEYS, cashflow: CASHFLOW_KEYS };
  const currentQuery = queryMap[tab];
  const currentKeys = keyMap[tab];
  const rows = parseStatementData(currentQuery.data);

  const tabs: { key: StatementTab; label: string }[] = [
    { key: "balance_sheet", label: locale === "en" ? "Balance Sheet" : locale === "fr" ? "Bilan" : "Bilanco" },
    { key: "income_stmt", label: locale === "en" ? "Income Statement" : locale === "fr" ? "Compte de résultat" : "Gelir Tablosu" },
    { key: "cashflow", label: locale === "en" ? "Cash Flow" : locale === "fr" ? "Flux de trésorerie" : "Nakit Akisi" },
  ];

  // Extract period columns from data
  const periods = rows.length > 0
    ? rows.map((r) => String(r.period ?? r.date ?? r.fiscalDateEnding ?? "")).filter(Boolean).slice(0, 5)
    : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-card rounded-2xl border border-border/60 overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-border/40">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">
            {locale === "en" ? "Financial Statements" : locale === "fr" ? "États financiers" : "Finansal Tablolar"}
          </h2>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-0 bg-muted/50 rounded-lg p-0.5">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                  tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex gap-0 bg-muted/50 rounded-lg p-0.5">
            <button
              onClick={() => setQuarterly(false)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${!quarterly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {locale === "en" ? "Annual" : locale === "fr" ? "Annuel" : "Yillik"}
            </button>
            <button
              onClick={() => setQuarterly(true)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${quarterly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {locale === "en" ? "Quarterly" : locale === "fr" ? "Trimestriel" : "Ceyreklik"}
            </button>
          </div>
        </div>
      </div>

      <div className="p-5">
        {currentQuery.isLoading ? (
          <LoadingSpinner />
        ) : rows.length === 0 ? (
          <EmptyState message={t("common.noData")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-40" />
                  {periods.map((p) => (
                    <th key={p} className="pb-2.5 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3">
                      {p.length > 10 ? p.substring(0, 10) : p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentKeys.map((item) => {
                  const vals = rows.map((r) => r[item.key]);
                  const hasData = vals.some((v) => v != null && v !== 0);
                  if (!hasData) return null;
                  return (
                    <tr key={item.key} className="border-b border-border/20 hover:bg-muted/10 transition-colors">
                      <td className="py-2.5 text-xs text-muted-foreground font-medium">
                        {item.label[locale] ?? item.label.tr}
                      </td>
                      {vals.map((v, i) => {
                        const num = Number(v);
                        const isNeg = !isNaN(num) && num < 0;
                        return (
                          <td key={i} className={`py-2.5 text-right px-3 text-xs font-mono ${isNeg ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
                            {formatStatValue(v)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </motion.div>
  );
}
