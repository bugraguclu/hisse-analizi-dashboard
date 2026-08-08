"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCompact } from "@/lib/format";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState, ErrorState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import { motion } from "framer-motion";
import { FileText } from "lucide-react";

type StatementTab = "balance_sheet" | "income_stmt" | "cashflow";

interface StatementKey {
  key: string;
  aliases?: string[];
  label: Record<string, string>;
}

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

function statementMatrix(raw: unknown, items: StatementKey[]) {
  const rows = parseStatementData(raw);
  if (rows.length === 0) return { periods: [] as string[], rows: [] as Array<{ item: StatementKey; values: unknown[] }> };

  // borsapy/KAP contract: one row per financial item and one column per
  // reporting period, e.g. {Item: "Toplam Varlıklar", "2025/12": ...}.
  if (rows.some((row) => row.Item != null)) {
    const sample = rows.find((row) => row.Item != null) ?? {};
    const periods = Object.keys(sample)
      .filter((key) => !["Item", "index"].includes(key))
      .sort((a, b) => {
        const rank = (period: string) => {
          const match = period.match(/^(\d{4})(?:[\/-](\d{1,2}))?/);
          if (!match) return 0;
          return Number(match[1]) * 100 + Number(match[2] ?? 12);
        };
        return rank(b) - rank(a);
      })
      .slice(0, 5);
    const matrixRows = items.flatMap((item) => {
      const aliases = [item.key, ...(item.aliases ?? [])].map((value) => value.trim().toLocaleLowerCase("tr-TR"));
      const match = rows.find((row) => aliases.includes(String(row.Item ?? "").trim().toLocaleLowerCase("tr-TR")));
      if (!match) return [];
      const values = periods.map((period) => match[period]);
      return values.some((value) => value != null && Number(value) !== 0) ? [{ item, values }] : [];
    });
    return { periods, rows: matrixRows };
  }

  // Legacy/yfinance contract: one row per period with canonical field names.
  const periodRows = rows.slice(0, 5);
  const periods = periodRows.map((row) => String(row.period ?? row.date ?? row.fiscalDateEnding ?? "")).filter(Boolean);
  const matrixRows = items.flatMap((item) => {
    const values = periodRows.map((row) => row[item.key]);
    return values.some((value) => value != null && Number(value) !== 0) ? [{ item, values }] : [];
  });
  return { periods, rows: matrixRows };
}

function formatStatValue(val: unknown): string {
  if (val === null || val === undefined) return "-";
  const num = Number(val);
  if (isNaN(num)) return String(val);
  return formatCompact(num);
}

const BALANCE_SHEET_KEYS = [
  { key: "TotalAssets", aliases: ["Toplam Varlıklar", "TOPLAM VARLIKLAR"], label: { tr: "Toplam Varlıklar", en: "Total Assets", fr: "Total des actifs" } },
  { key: "CurrentAssets", aliases: ["Dönen Varlıklar"], label: { tr: "Dönen Varlıklar", en: "Current Assets", fr: "Actifs courants" } },
  { key: "TotalLiabilitiesNetMinorityInterest", aliases: ["Toplam Yükümlülükler"], label: { tr: "Toplam Yükümlülükler", en: "Total Liabilities", fr: "Total des passifs" } },
  { key: "CurrentLiabilities", aliases: ["Kısa Vadeli Yükümlülükler"], label: { tr: "Kısa Vadeli Yükümlülükler", en: "Current Liabilities", fr: "Passifs courants" } },
  { key: "StockholdersEquity", aliases: ["Toplam Özkaynaklar", "Özkaynaklar", "Ana Ortaklığa Ait Özkaynaklar"], label: { tr: "Özkaynaklar", en: "Stockholders Equity", fr: "Fonds propres" } },
  { key: "CashAndCashEquivalents", aliases: ["Nakit ve Nakit Benzerleri"], label: { tr: "Nakit ve Benzerleri", en: "Cash & Equivalents", fr: "Trésorerie" } },
] satisfies StatementKey[];

const INCOME_KEYS = [
  { key: "TotalRevenue", aliases: ["Hasılat", "Satış Gelirleri"], label: { tr: "Hasılat", en: "Total Revenue", fr: "Revenu total" } },
  { key: "GrossProfit", aliases: ["Brüt Kâr (Zarar)", "BRÜT KAR (ZARAR)"], label: { tr: "Brüt Kâr", en: "Gross Profit", fr: "Bénéfice brut" } },
  { key: "OperatingIncome", aliases: ["Esas Faaliyet Kârı (Zararı)", "FAALİYET KARI (ZARARI)"], label: { tr: "Esas Faaliyet Kârı", en: "Operating Income", fr: "Résultat opérationnel" } },
  { key: "EBITDA", aliases: ["FAVÖK", "FAVOK"], label: { tr: "FAVÖK", en: "EBITDA", fr: "EBITDA" } },
  { key: "NetIncome", aliases: ["Net Dönem Kârı (Zararı)", "DÖNEM KARI (ZARARI)"], label: { tr: "Net Dönem Kârı", en: "Net Income", fr: "Résultat net" } },
  { key: "BasicEPS", aliases: ["Hisse Başına Kazanç"], label: { tr: "Hisse Başına Kâr", en: "EPS", fr: "BPA" } },
] satisfies StatementKey[];

const CASHFLOW_KEYS = [
  { key: "OperatingCashFlow", aliases: ["İşletme Faaliyetlerinden Kaynaklanan Net Nakit"], label: { tr: "İşletme Nakit Akışı", en: "Operating Cash Flow", fr: "Flux de trésorerie opérationnel" } },
  { key: "InvestingCashFlow", aliases: ["Yatırım Faaliyetlerinden Kaynaklanan Nakit"], label: { tr: "Yatırım Nakit Akışı", en: "Investing Cash Flow", fr: "Flux d'investissement" } },
  { key: "FinancingCashFlow", aliases: ["Finansman Faaliyetlerden Kaynaklanan Nakit"], label: { tr: "Finansman Nakit Akışı", en: "Financing Cash Flow", fr: "Flux de financement" } },
  { key: "FreeCashFlow", aliases: ["Serbest Nakit Akım"], label: { tr: "Serbest Nakit Akışı", en: "Free Cash Flow", fr: "Flux de trésorerie libre" } },
  { key: "CapitalExpenditure", aliases: ["Sabit Sermaye Yatırımları"], label: { tr: "Sermaye Harcaması", en: "Capital Expenditure", fr: "Dépenses d'investissement" } },
] satisfies StatementKey[];

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
  const matrix = statementMatrix(currentQuery.data, currentKeys);
  const statementMeta = currentQuery.data as Record<string, unknown> | null;

  const tabs: { key: StatementTab; label: string }[] = [
    { key: "balance_sheet", label: locale === "en" ? "Balance Sheet" : locale === "fr" ? "Bilan" : "Bilanço" },
    { key: "income_stmt", label: locale === "en" ? "Income Statement" : locale === "fr" ? "Compte de résultat" : "Gelir Tablosu" },
    { key: "cashflow", label: locale === "en" ? "Cash Flow" : locale === "fr" ? "Flux de trésorerie" : "Nakit Akışı" },
  ];

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
          {statementMeta?.source ? (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {String(statementMeta.source)}{statementMeta.as_of ? ` · ${String(statementMeta.as_of)}` : ""}
            </span>
          ) : null}
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
              {locale === "en" ? "Annual" : locale === "fr" ? "Annuel" : "Yıllık"}
            </button>
            <button
              onClick={() => setQuarterly(true)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${quarterly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {locale === "en" ? "Interim" : locale === "fr" ? "Intermédiaire" : "Ara Dönem"}
            </button>
          </div>
        </div>
      </div>

      <div className="p-5">
        {currentQuery.isError ? (
          <ErrorState message={locale === "tr" ? "Finansal tablo yüklenemedi" : "Financial statement could not be loaded"} onRetry={() => { void currentQuery.refetch(); }} />
        ) : currentQuery.isLoading ? (
          <LoadingSpinner />
        ) : matrix.rows.length === 0 ? (
          <EmptyState message={t("common.noData")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40">
                  <th className="pb-2.5 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider w-40" />
                  {matrix.periods.map((p) => (
                    <th key={p} className="pb-2.5 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-3">
                      {p.length > 10 ? p.substring(0, 10) : p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map(({ item, values }) => {
                  return (
                    <tr key={item.key} className="border-b border-border/20 hover:bg-muted/10 transition-colors">
                      <td className="py-2.5 text-xs text-muted-foreground font-medium">
                        {item.label[locale] ?? item.label.tr}
                      </td>
                      {values.map((v, i) => {
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
