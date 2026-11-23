import React from "react";
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { CompanySectorOut, SectorMetricKey } from "../../dashboard/src/types/index.ts";
import {
  EMPTY_VALUE,
  formatCompactCount,
  formatCompactTry,
  formatIstanbulDate,
  formatIstanbulDateTime,
  formatMillions,
  formatNumber,
  formatPercent,
  formatPrice,
  formatRatio,
  formatSignedPercent,
  statementRowDecimals,
} from "../lib/format";
import {
  CASHFLOW_SUMMARY_ITEMS,
  computeTrailingDividendYield,
  isStatementEmphasisLine,
  signalLabelTr,
  type AnalystSummary,
  type CompanyProfile,
  type DividendItem,
  type EarningsItem,
  type HolderItem,
  type MovingAverageCross,
  type MovingAverageRow,
  type ParsedTechnicalSignals,
  type PivotLevels,
  type RatioKey,
  type RatioSet,
  type SignalGroup,
  type SignalLevel,
  type StatementTable,
  type StockFastInfo,
  type StockKapItem,
  type StockNewsItem,
  type StockQuote,
  type TimeframeSignal,
} from "../lib/stockParsers";
import type { StatementKind } from "../lib/api";
import { buildScorecard, LOSS_MAKING_PE, type ScoredMetric } from "../lib/scorecard";
import { BorderRadius, FontSize, Spacing, useThemeColors, type ThemeColors } from "../lib/theme";
import { EmptyCard, ErrorCard, LoadingBlock, MetricTile, SectionCard } from "./StatusViews";

export function signalColor(level: SignalLevel | null, colors: ThemeColors): string {
  if (level === "strongBuy" || level === "buy") return colors.up;
  if (level === "strongSell" || level === "sell") return colors.down;
  if (level === "neutral") return colors.warn;
  return colors.textMuted;
}

export function QuoteStatsPanel({
  quote,
  fastInfo,
  ratios,
}: {
  quote: StockQuote | null;
  fastInfo: StockFastInfo | null;
  ratios: RatioSet | null;
}) {
  const pe = ratios?.values.pe_ratio ?? fastInfo?.pe ?? null;
  const pb = ratios?.values.pb_ratio ?? fastInfo?.pb ?? null;
  const dayRange =
    quote?.low != null && quote?.high != null
      ? `${formatNumber(quote.low)} – ${formatNumber(quote.high)}`
      : EMPTY_VALUE;
  const yearRange =
    fastInfo?.yearLow != null && fastInfo?.yearHigh != null
      ? `${formatNumber(fastInfo.yearLow)} – ${formatNumber(fastInfo.yearHigh)}`
      : EMPTY_VALUE;

  return (
    <SectionCard title="Günlük İşlem ve Özet">
      <View style={styles.tileGrid}>
        <MetricTile label="Açılış" value={formatPrice(quote?.open ?? fastInfo?.open)} />
        <MetricTile label="Önceki kapanış" value={formatPrice(quote?.prevClose ?? fastInfo?.prevClose)} />
        <MetricTile label="Gün aralığı" value={dayRange} />
        <MetricTile label="52 hafta aralığı" value={yearRange} />
        <MetricTile
          label="İşlem hacmi"
          value={
            fastInfo?.amount != null
              ? formatCompactTry(fastInfo.amount)
              : formatCompactCount(quote?.volume ?? fastInfo?.volume)
          }
          subValue={fastInfo?.amount != null && quote?.volume != null ? `${formatCompactCount(quote.volume)} lot` : null}
        />
        <MetricTile label="Piyasa değeri" value={formatCompactTry(quote?.marketCap ?? fastInfo?.marketCap)} />
        <MetricTile label="F/K" value={formatRatio(pe)} />
        <MetricTile label="PD/DD" value={formatRatio(pb)} />
      </View>
    </SectionCard>
  );
}

export function AnalystPanel({
  analyst,
  currentPrice,
}: {
  analyst: AnalystSummary | null;
  currentPrice: number | null;
}) {
  const colors = useThemeColors();
  if (!analyst) {
    return (
      <SectionCard title="Analist Görüşü ve Hedef Fiyat">
        <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
          Bu hisse için güncel analist hedef fiyatı bulunmuyor.
        </Text>
      </SectionCard>
    );
  }
  const primaryTarget = analyst.mean ?? analyst.target ?? analyst.median;
  const upside =
    analyst.upside ??
    (primaryTarget != null && currentPrice != null && currentPrice > 0
      ? ((primaryTarget / currentPrice) - 1) * 100
      : null);

  return (
    <SectionCard
      title="Analist Görüşü ve Hedef Fiyat"
      subtitle={analyst.analysts != null ? `${formatNumber(analyst.analysts, 0)} analist tahmini` : null}
    >
      <View style={styles.tileGrid}>
        <MetricTile
          label="Öneri"
          value={analyst.level ? signalLabelTr(analyst.level) : analyst.raw ?? EMPTY_VALUE}
          tone={
            analyst.level === "buy" || analyst.level === "strongBuy"
              ? "up"
              : analyst.level === "sell" || analyst.level === "strongSell"
                ? "down"
                : "default"
          }
        />
        <MetricTile
          label="Ortalama hedef"
          value={formatPrice(primaryTarget)}
          subValue={upside != null ? `Potansiyel: ${formatSignedPercent(upside, 1)}` : null}
          tone={upside != null ? (upside >= 0 ? "up" : "down") : "default"}
        />
        <MetricTile label="En düşük hedef" value={formatPrice(analyst.low)} />
        <MetricTile label="En yüksek hedef" value={formatPrice(analyst.high)} />
      </View>
    </SectionCard>
  );
}

export function DividendsPanel({
  dividends,
  currentPrice,
}: {
  dividends: readonly DividendItem[];
  currentPrice: number | null;
}) {
  const colors = useThemeColors();
  const trailing = computeTrailingDividendYield(dividends, currentPrice);

  return (
    <SectionCard
      title="Temettü Geçmişi"
      subtitle={
        trailing.count > 0
          ? `Son 12 ay: ${formatPrice(trailing.perShare)} (${formatPercent(trailing.yieldPct)} verim)`
          : null
      }
    >
      {dividends.length === 0 ? (
        <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
          Kayıtlı nakit temettü ödemesi bulunamadı.
        </Text>
      ) : (
        <View style={styles.tableWrap}>
          <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.th, { flex: 1.2, color: colors.textMuted }]}>Tarih</Text>
            <Text style={[styles.th, styles.numCol, { color: colors.textMuted }]}>Brüt (₺)</Text>
            <Text style={[styles.th, styles.numCol, { color: colors.textMuted }]}>Net (₺)</Text>
            <Text style={[styles.th, styles.numCol, { color: colors.textMuted }]}>Oran</Text>
          </View>
          {dividends.slice(0, 6).map((item, idx) => (
            <View key={`${item.date}-${idx}`} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.td, { flex: 1.2, color: colors.textPrimary }]}>
                {formatIstanbulDate(item.date)}
              </Text>
              <Text style={[styles.td, styles.numCol, { color: colors.textPrimary }]}>
                {formatNumber(item.grossPerShare, 2)}
              </Text>
              <Text style={[styles.td, styles.numCol, { color: colors.textSecondary }]}>
                {formatNumber(item.netPerShare, 2)}
              </Text>
              <Text style={[styles.td, styles.numCol, { color: colors.textSecondary }]}>
                {formatPercent(item.grossRate, 1)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </SectionCard>
  );
}

const SEVERITY_LABELS: Record<string, string> = { HIGH: "Yüksek önem", WATCH: "Takip", INFO: "Bilgi" };

export function KapAndNewsPanel({
  kap,
  news,
}: {
  kap: readonly StockKapItem[];
  news: readonly StockNewsItem[];
}) {
  const colors = useThemeColors();
  const openUrl = (url: string | null) => {
    if (!url) return;
    void Linking.openURL(url).catch(() => undefined);
  };

  return (
    <>
      <SectionCard title="KAP Bildirimleri" subtitle={kap.length > 0 ? `Son ${kap.length} kayıt` : null}>
        {kap.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
            Yakın dönem KAP bildirimi bulunamadı.
          </Text>
        ) : (
          <View style={styles.listWrap}>
            {kap.slice(0, 6).map((item, idx) => (
              <TouchableOpacity
                key={item.id ?? `${item.time}-${idx}`}
                disabled={!item.url}
                onPress={() => openUrl(item.url)}
                style={[styles.feedRow, { borderBottomColor: colors.border }]}
              >
                <View style={styles.feedMeta}>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                    {formatIstanbulDateTime(item.publishedAt ?? item.time)}
                  </Text>
                  {item.severity ? (
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: "700",
                        color:
                          item.severity === "HIGH" ? colors.down : item.severity === "WATCH" ? colors.warn : colors.accent,
                      }}
                    >
                      {SEVERITY_LABELS[item.severity] ?? item.severity}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ color: colors.textPrimary, fontSize: FontSize.sm }} numberOfLines={2}>
                  {item.summary ?? item.title}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </SectionCard>

      <SectionCard title="Şirket Haberleri">
        {news.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
            Son 72 saatte kayıtlı şirket haberi bulunamadı.
          </Text>
        ) : (
          <View style={styles.listWrap}>
            {news.slice(0, 5).map((item, idx) => (
              <TouchableOpacity
                key={`${item.time}-${idx}`}
                disabled={!item.url}
                onPress={() => openUrl(item.url)}
                style={[styles.feedRow, { borderBottomColor: colors.border }]}
              >
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                  {[item.source, formatIstanbulDateTime(item.publishedAt)].filter(Boolean).join(" · ")}
                </Text>
                <Text style={{ color: colors.textPrimary, fontSize: FontSize.sm }} numberOfLines={2}>
                  {item.title}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </SectionCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Technical Analysis Panels
// ---------------------------------------------------------------------------

function SignalVoteRow({ label, group }: { label: string; group: SignalGroup | null }) {
  const colors = useThemeColors();
  const toneColor = signalColor(group?.level ?? null, colors);
  return (
    <View style={[styles.voteRow, { borderBottomColor: colors.border }]}>
      <Text style={{ color: colors.textPrimary, fontSize: FontSize.sm, fontWeight: "600", flex: 1 }}>
        {label}
      </Text>
      <View style={styles.voteCounts}>
        <Text style={{ color: colors.up, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          Al {group?.buy ?? EMPTY_VALUE}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          Nötr {group?.neutral ?? EMPTY_VALUE}
        </Text>
        <Text style={{ color: colors.down, fontSize: 11, fontVariant: ["tabular-nums"] }}>
          Sat {group?.sell ?? EMPTY_VALUE}
        </Text>
      </View>
      <View style={[styles.signalBadge, { borderColor: toneColor }]}>
        <Text style={{ color: toneColor, fontSize: 11, fontWeight: "700" }}>
          {signalLabelTr(group?.level ?? null)}
        </Text>
      </View>
    </View>
  );
}

export function TechnicalSummaryPanel({
  signals,
  timeframes,
}: {
  signals: ParsedTechnicalSignals | null;
  timeframes: readonly TimeframeSignal[];
}) {
  const colors = useThemeColors();

  return (
    <>
      <SectionCard
        title="Teknik Özet"
        subtitle={signals?.interval ? `Zaman dilimi: ${signals.interval}` : "Günlük TradingView teknik derecelendirmesi"}
      >
        {!signals ? (
          <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
            Teknik derecelendirme verisi bulunamadı.
          </Text>
        ) : (
          <View>
            <SignalVoteRow label="Genel Özet" group={signals.summary} />
            <SignalVoteRow label="Hareketli Ortalamalar" group={signals.movingAverages} />
            <SignalVoteRow label="Osilatörler" group={signals.oscillators} />
          </View>
        )}
      </SectionCard>

      {timeframes.length > 0 ? (
        <SectionCard title="Zaman Dilimlerine Göre Sinyaller">
          <View style={styles.tfGrid}>
            {timeframes.map((tf) => {
              const level = tf.summary?.level ?? null;
              const col = signalColor(level, colors);
              return (
                <View
                  key={tf.timeframe}
                  style={[
                    styles.tfCell,
                    { backgroundColor: colors.bgSecondary, borderColor: level ? col : colors.border },
                  ]}
                >
                  <Text style={{ color: colors.textMuted, fontSize: 11, fontWeight: "700" }}>
                    {tf.timeframe}
                  </Text>
                  <Text style={{ color: col, fontSize: 11, fontWeight: "700" }} numberOfLines={1}>
                    {signalLabelTr(level)}
                  </Text>
                </View>
              );
            })}
          </View>
        </SectionCard>
      ) : null}
    </>
  );
}

export function MovingAveragesAndPivotsPanel({
  rows,
  lastCross,
  pivots,
}: {
  rows: readonly MovingAverageRow[];
  lastCross: MovingAverageCross | null;
  pivots: PivotLevels | null;
}) {
  const colors = useThemeColors();

  return (
    <>
      <SectionCard
        title="Hareketli Ortalamalar"
        subtitle={
          lastCross
            ? `Son kesişim: ${lastCross.type === "golden" ? "Golden Cross" : "Death Cross"}${lastCross.date ? ` (${formatIstanbulDate(lastCross.date)})` : ""}`
            : null
        }
      >
        {rows.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
            Hareketli ortalama tablosu bulunamadı.
          </Text>
        ) : (
          <View style={styles.tableWrap}>
            <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.th, { width: 52, color: colors.textMuted }]}>Dönem</Text>
              <Text style={[styles.th, styles.numCol, { color: colors.textMuted }]}>SMA</Text>
              <Text style={[styles.th, styles.numCol, { color: colors.textMuted }]}>EMA</Text>
              <Text style={[styles.th, { width: 64, textAlign: "right", color: colors.textMuted }]}>Sinyal</Text>
            </View>
            {rows.map((row) => (
              <View key={row.period} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.td, { width: 52, fontWeight: "600", color: colors.textPrimary }]}>
                  {row.period}
                </Text>
                <Text style={[styles.td, styles.numCol, { color: colors.textPrimary }]}>
                  {formatNumber(row.sma)}
                </Text>
                <Text style={[styles.td, styles.numCol, { color: colors.textSecondary }]}>
                  {formatNumber(row.ema)}
                </Text>
                <Text
                  style={[
                    styles.td,
                    {
                      width: 64,
                      textAlign: "right",
                      fontWeight: "700",
                      color: signalColor(row.smaVote ?? row.emaVote, colors),
                    },
                  ]}
                >
                  {signalLabelTr(row.smaVote ?? row.emaVote)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </SectionCard>

      <SectionCard
        title="Pivot, Destek ve Direnç Seviyeleri"
        subtitle={pivots?.sessionDate ? `Seans: ${formatIstanbulDate(pivots.sessionDate)}` : null}
      >
        {!pivots ? (
          <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
            Klasik pivot seviyeleri bulunamadı.
          </Text>
        ) : (
          <View style={styles.pivotGrid}>
            {[
              { label: "Direnç 3 (R3)", value: pivots.r3, tone: "down" as const },
              { label: "Direnç 2 (R2)", value: pivots.r2, tone: "down" as const },
              { label: "Direnç 1 (R1)", value: pivots.r1, tone: "down" as const },
              { label: "Pivot (P)", value: pivots.pivot, tone: "accent" as const },
              { label: "Destek 1 (S1)", value: pivots.s1, tone: "up" as const },
              { label: "Destek 2 (S2)", value: pivots.s2, tone: "up" as const },
              { label: "Destek 3 (S3)", value: pivots.s3, tone: "up" as const },
            ].map((item) => (
              <View key={item.label} style={[styles.pivotRow, { borderBottomColor: colors.border }]}>
                <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>{item.label}</Text>
                <Text
                  style={{
                    color:
                      item.tone === "up"
                        ? colors.up
                        : item.tone === "down"
                          ? colors.down
                          : colors.accent,
                    fontSize: FontSize.sm,
                    fontWeight: "700",
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {formatPrice(item.value)}
                </Text>
              </View>
            ))}
          </View>
        )}
      </SectionCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fundamental Analysis Panels
// ---------------------------------------------------------------------------

const RATIO_GROUPS: readonly {
  title: string;
  items: readonly { key: RatioKey; label: string; kind: "ratio" | "pct" }[];
}[] = [
  {
    title: "Değerleme",
    items: [
      { key: "pe_ratio", label: "F/K", kind: "ratio" },
      { key: "pb_ratio", label: "PD/DD", kind: "ratio" },
      { key: "ev_ebitda", label: "FD/FAVÖK", kind: "ratio" },
      { key: "ps_ratio", label: "PD/Satış", kind: "ratio" },
    ],
  },
  {
    title: "Kârlılık",
    items: [
      { key: "roe", label: "Özkaynak Kârlılığı (ROE)", kind: "pct" },
      { key: "roa", label: "Aktif Kârlılığı (ROA)", kind: "pct" },
      { key: "gross_margin", label: "Brüt Kâr Marjı", kind: "pct" },
      { key: "operating_margin", label: "Faaliyet Marjı", kind: "pct" },
      { key: "ebitda_margin", label: "FAVÖK Marjı", kind: "pct" },
      { key: "net_margin", label: "Net Kâr Marjı", kind: "pct" },
    ],
  },
  {
    title: "Finansal Yapı ve Büyüme",
    items: [
      { key: "current_ratio", label: "Cari Oran", kind: "ratio" },
      { key: "debt_to_equity", label: "Borç / Özkaynak", kind: "ratio" },
      { key: "net_debt_ebitda", label: "Net Borç / FAVÖK", kind: "ratio" },
      { key: "revenue_growth_yoy", label: "Hasılat Büyümesi (YoY)", kind: "pct" },
      { key: "net_income_growth_yoy", label: "Net Kâr Büyümesi (YoY)", kind: "pct" },
    ],
  },
];

export function RatiosPanel({ ratios, compact = false }: { ratios: RatioSet | null; compact?: boolean }) {
  const colors = useThemeColors();
  const periodSubtitle = ratios?.mainPeriod
    ? `Dönem: ${ratios.mainPeriod.label}${ratios.mainPeriod.ttm ? " · TTM (son 12 ay)" : ""}`
    : null;

  return (
    <SectionCard title="Finansal Oranlar" subtitle={periodSubtitle}>
      {!ratios ? (
        <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
          Finansal oran verisi bulunamadı.
        </Text>
      ) : (
        <View style={{ gap: Spacing.md }}>
          {(compact ? RATIO_GROUPS.slice(0, 2) : RATIO_GROUPS).map((group) => (
            <View key={group.title} style={{ gap: Spacing.xs }}>
              <Text style={[styles.subGroupTitle, { color: colors.textMuted }]}>
                {group.title.toUpperCase()}
              </Text>
              <View style={styles.tileGrid}>
                {group.items.map((item) => {
                  const val = ratios.values[item.key];
                  const rowPeriod = ratios.periods[item.key];
                  const differs =
                    rowPeriod &&
                    ratios.mainPeriod &&
                    rowPeriod.label !== ratios.mainPeriod.label;
                  return (
                    <MetricTile
                      key={item.key}
                      label={item.label}
                      value={item.kind === "pct" ? formatPercent(val, 1) : formatRatio(val, 2)}
                      subValue={differs ? rowPeriod.label : null}
                    />
                  );
                })}
              </View>
            </View>
          ))}
        </View>
      )}
    </SectionCard>
  );
}

export function FinancialStatementsPanel({
  kind,
  onKindChange,
  quarterly,
  onQuarterlyChange,
  discrete,
  onDiscreteChange,
  showAllCashflow,
  onToggleAllCashflow,
  status,
  table,
  error,
  onRetry,
}: {
  kind: StatementKind;
  onKindChange: (kind: StatementKind) => void;
  quarterly: boolean;
  onQuarterlyChange: (quarterly: boolean) => void;
  discrete: boolean;
  onDiscreteChange: (discrete: boolean) => void;
  showAllCashflow: boolean;
  onToggleAllCashflow: () => void;
  status: "loading" | "ready" | "empty" | "stale" | "error";
  table: StatementTable | null;
  error: string | null;
  onRetry: () => void;
}) {
  const colors = useThemeColors();
  const isFlow = kind !== "balance";
  const canDiscrete = Boolean(isFlow && quarterly && table?.cumulative === true && table.discreteRows);
  const showDiscrete = canDiscrete && discrete;
  const allRows = (showDiscrete ? table?.discreteRows : table?.rows) ?? [];
  const summaryRows = kind === "cashflow" ? allRows.filter((r) => CASHFLOW_SUMMARY_ITEMS.has(r.label)) : [];
  const rows =
    kind === "cashflow" && !showAllCashflow && summaryRows.length > 0 ? summaryRows : allRows;

  return (
    <SectionCard
      title="Finansal Tablolar"
      subtitle={`Birim: ${table?.unitLabel ?? "Milyon ₺"}${quarterly ? (showDiscrete ? " · Tek çeyrek" : isFlow ? " · Kümülatif ara dönem" : " · Ara dönem") : " · Yıllık"}`}
    >
      {/* Statement type selector */}
      <View style={styles.segmentRow}>
        {(
          [
            { id: "income", label: "Gelir" },
            { id: "balance", label: "Bilanço" },
            { id: "cashflow", label: "Nakit Akışı" },
          ] as const
        ).map((opt) => {
          const active = kind === opt.id;
          return (
            <TouchableOpacity
              key={opt.id}
              style={[
                styles.segmentBtn,
                {
                  backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                  borderColor: active ? colors.accent : colors.border,
                },
              ]}
              onPress={() => onKindChange(opt.id)}
              accessibilityRole="button"
            >
              <Text
                style={{
                  color: active ? colors.accent : colors.textSecondary,
                  fontSize: FontSize.xs,
                  fontWeight: active ? "700" : "500",
                }}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Annual / Quarterly + Discrete toggle */}
      <View style={styles.segmentRow}>
        {[
          { val: false, label: "Yıllık" },
          { val: true, label: "Çeyreklik" },
        ].map((opt) => {
          const active = quarterly === opt.val;
          return (
            <TouchableOpacity
              key={opt.label}
              style={[
                styles.segmentBtn,
                {
                  backgroundColor: active ? colors.accentLight : colors.bgSecondary,
                  borderColor: active ? colors.accent : colors.border,
                },
              ]}
              onPress={() => onQuarterlyChange(opt.val)}
              accessibilityRole="button"
            >
              <Text
                style={{
                  color: active ? colors.accent : colors.textSecondary,
                  fontSize: FontSize.xs,
                  fontWeight: active ? "700" : "500",
                }}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
        {canDiscrete ? (
          <TouchableOpacity
            style={[
              styles.segmentBtn,
              {
                backgroundColor: discrete ? colors.accentLight : colors.bgSecondary,
                borderColor: discrete ? colors.accent : colors.border,
              },
            ]}
            onPress={() => onDiscreteChange(!discrete)}
            accessibilityRole="button"
          >
            <Text
              style={{
                color: discrete ? colors.accent : colors.textSecondary,
                fontSize: FontSize.xs,
                fontWeight: discrete ? "700" : "500",
              }}
            >
              {discrete ? "Tek çeyrek ✓" : "Kümülatif"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {status === "loading" && !table ? (
        <LoadingBlock message="Finansal tablo yükleniyor…" />
      ) : status === "error" && !table ? (
        <ErrorCard
          title="Finansal tablo alınamadı"
          message={error ?? "Bağlantı hatası."}
          onRetry={onRetry}
        />
      ) : table?.unavailable ? (
        <EmptyCard
          title="Bu şirket için tablo yayımlanmıyor"
          message="Bankacılık veya finans şirketlerinde nakit akış tablosu standart KAP formatında yer almayabilir."
        />
      ) : !table || rows.length === 0 ? (
        <EmptyCard
          title="Tablo verisi bulunamadı"
          message="Seçilen dönem için finansal tablo satırı bulunamadı."
        />
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View style={{ minWidth: "100%" }}>
              <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
                <Text style={[styles.th, { width: 156, color: colors.textMuted }]}>Kalem (Milyon ₺)</Text>
                {table.periods.map((p) => {
                  const main =
                    !quarterly && p.month === 12 && p.year
                      ? String(p.year)
                      : p.year && p.month
                        ? `${p.year}/${String(p.month).padStart(2, "0")}`
                        : p.key;
                  const sub =
                    quarterly && isFlow && p.month
                      ? showDiscrete || table.cumulative === false
                        ? `Ç${Math.ceil(p.month / 3)}`
                        : `${p.months ?? p.month} ay`
                      : null;
                  return (
                    <View key={p.key} style={styles.periodHeaderCell}>
                      <Text style={[styles.th, { textAlign: "right", color: colors.textPrimary }]}>{main}</Text>
                      {sub ? (
                        <Text style={{ fontSize: 9, textAlign: "right", color: colors.textMuted }}>{sub}</Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              {rows.map((row, idx) => {
                const bold = isStatementEmphasisLine(row.label);
                const decimals = statementRowDecimals(row.values);
                return (
                  <View
                    key={`${row.label}-${idx}`}
                    style={[styles.tableRow, { borderBottomColor: colors.border }]}
                  >
                    <Text
                      style={[
                        styles.td,
                        {
                          width: 156,
                          paddingLeft: row.depth * 8,
                          color: bold ? colors.textPrimary : colors.textSecondary,
                          fontWeight: bold ? "700" : "400",
                        },
                      ]}
                      numberOfLines={2}
                    >
                      {row.label}
                    </Text>
                    {row.values.map((val, cIdx) => (
                      <Text
                        key={cIdx}
                        style={[
                          styles.td,
                          styles.periodValCell,
                          {
                            color: bold ? colors.textPrimary : colors.textSecondary,
                            fontWeight: bold ? "700" : "400",
                          },
                        ]}
                      >
                        {formatMillions(val, decimals)}
                      </Text>
                    ))}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {kind === "cashflow" && summaryRows.length > 0 && allRows.length > summaryRows.length ? (
            <TouchableOpacity onPress={onToggleAllCashflow} accessibilityRole="button">
              <Text style={{ color: colors.accent, fontSize: FontSize.xs, fontWeight: "600" }}>
                {showAllCashflow
                  ? "Özet satırları göster"
                  : `Tüm satırları göster (${allRows.length})`}
              </Text>
            </TouchableOpacity>
          ) : null}

          <Text style={{ color: colors.textMuted, fontSize: 11, lineHeight: 16 }}>
            Tüm tutarlar Milyon ₺ cinsindendir.{table.source ? ` Kaynak: ${table.source}.` : ""}
            {table.notes.length > 0 ? ` ${table.notes.join(" ")}` : ""}
          </Text>
        </>
      )}
    </SectionCard>
  );
}

export function ProfileAndHoldersPanel({
  profile,
  holders,
  earnings,
}: {
  profile: CompanyProfile | null;
  holders: readonly HolderItem[];
  earnings: readonly EarningsItem[];
}) {
  const colors = useThemeColors();

  return (
    <>
      {profile ? (
        <SectionCard title="Şirket Profili">
          <View style={styles.kvList}>
            {profile.legalName ? (
              <View style={[styles.kvRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.kvKey, { color: colors.textMuted }]}>Unvan</Text>
                <Text style={[styles.kvVal, { color: colors.textPrimary }]}>{profile.legalName}</Text>
              </View>
            ) : null}
            {profile.sector ? (
              <View style={[styles.kvRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.kvKey, { color: colors.textMuted }]}>Sektör</Text>
                <Text style={[styles.kvVal, { color: colors.textPrimary }]}>{profile.sector}</Text>
              </View>
            ) : null}
            {profile.market ? (
              <View style={[styles.kvRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.kvKey, { color: colors.textMuted }]}>Pazar</Text>
                <Text style={[styles.kvVal, { color: colors.textPrimary }]}>{profile.market}</Text>
              </View>
            ) : null}
            {profile.website ? (
              <View style={[styles.kvRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.kvKey, { color: colors.textMuted }]}>Web</Text>
                <Text style={[styles.kvVal, { color: colors.accent }]}>{profile.website}</Text>
              </View>
            ) : null}
          </View>
        </SectionCard>
      ) : null}

      <SectionCard title="Ortaklık Yapısı">
        {holders.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
            Ortaklık yapısı verisi bulunamadı.
          </Text>
        ) : (
          <View style={{ gap: Spacing.sm }}>
            {holders.slice(0, 8).map((h, idx) => (
              <View key={`${h.name}-${idx}`} style={{ gap: 4 }}>
                <View style={styles.holderHeader}>
                  <Text style={{ color: colors.textPrimary, fontSize: FontSize.xs, flex: 1 }} numberOfLines={1}>
                    {h.name}
                  </Text>
                  <Text style={{ color: colors.textPrimary, fontSize: FontSize.xs, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
                    {formatPercent(h.percent, 2)}
                  </Text>
                </View>
                <View style={[styles.holderTrack, { backgroundColor: colors.bgSecondary }]}>
                  <View
                    style={[
                      styles.holderFill,
                      {
                        width: `${Math.max(2, Math.min(100, h.percent))}%`,
                        backgroundColor: h.isOther ? colors.textMuted : colors.accent,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </SectionCard>

      {earnings.length > 0 ? (
        <SectionCard title="Finansal Rapor Takvimi">
          <View style={styles.listWrap}>
            {earnings.slice(-5).reverse().map((ev, idx) => (
              <View key={`${ev.date}-${idx}`} style={[styles.kvRow, { borderBottomColor: colors.border }]}>
                <Text style={{ color: colors.textPrimary, fontSize: FontSize.xs, fontWeight: "600" }}>
                  {formatIstanbulDate(ev.date)}
                </Text>
                <Text style={{ color: colors.textSecondary, fontSize: FontSize.xs, fontVariant: ["tabular-nums"] }}>
                  HBK: {ev.epsActual != null ? formatNumber(ev.epsActual) : ev.epsEstimate != null ? `Bekl. ${formatNumber(ev.epsEstimate)}` : EMPTY_VALUE}
                </Text>
              </View>
            ))}
          </View>
        </SectionCard>
      ) : null}
    </>
  );
}

const SECTOR_METRICS: readonly { key: SectorMetricKey; label: string; kind: "ratio" | "pct" }[] = [
  { key: "pe", label: "F/K", kind: "ratio" },
  { key: "pb", label: "PD/DD", kind: "ratio" },
  { key: "ev_ebitda", label: "FD/FAVÖK", kind: "ratio" },
  { key: "roe", label: "ROE", kind: "pct" },
  { key: "net_margin", label: "Net Marj", kind: "pct" },
  { key: "dividend_yield", label: "Temettü", kind: "pct" },
];

export function SectorComparisonPanel({
  sector,
  currentTicker,
  onSelectPeer,
}: {
  sector: CompanySectorOut | null;
  currentTicker: string;
  onSelectPeer: (ticker: string) => void;
}) {
  const colors = useThemeColors();
  if (!sector || !sector.available || !sector.sector) {
    return (
      <SectionCard title="Sektör Karşılaştırması">
        <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>
          Bu şirket için KAP sektör karşılaştırma verisi bulunmuyor.
        </Text>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Sektör Karşılaştırması"
      subtitle={`${sector.sector.name} · ${sector.sector.count} şirket${sector.ratio_period ? ` · Dönem: ${sector.ratio_period}` : ""}`}
    >
      <View style={styles.tableWrap}>
        <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.th, { flex: 1.3, color: colors.textMuted }]}>Metrik</Text>
          <Text style={[styles.th, styles.numCol, { color: colors.textMuted }]}>{currentTicker}</Text>
          <Text style={[styles.th, styles.numCol, { color: colors.textMuted }]}>Sektör Med.</Text>
        </View>
        {SECTOR_METRICS.map((m) => {
          const item = sector.metrics[m.key];
          if (!item) return null;
          const fmt = (v: number | null) => (m.kind === "pct" ? formatPercent(v, 1) : formatRatio(v, 2));
          return (
            <View key={m.key} style={[styles.tableRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.td, { flex: 1.3, color: colors.textPrimary, fontWeight: "500" }]}>
                {m.label}
              </Text>
              <Text style={[styles.td, styles.numCol, { color: colors.textPrimary, fontWeight: "700" }]}>
                {fmt(item.value)}
              </Text>
              <Text style={[styles.td, styles.numCol, { color: colors.textSecondary }]}>
                {fmt(item.median)}
              </Text>
            </View>
          );
        })}
      </View>

      {sector.peers.length > 1 ? (
        <View style={{ gap: Spacing.xs }}>
          <Text style={[styles.subGroupTitle, { color: colors.textMuted }]}>SEKTÖR ŞİRKETLERİ</Text>
          <View style={styles.peerWrap}>
            {sector.peers.slice(0, 8).map((peer) => {
              const isCurrent = peer.symbol === currentTicker;
              return (
                <TouchableOpacity
                  key={peer.symbol}
                  disabled={isCurrent}
                  onPress={() => onSelectPeer(peer.symbol)}
                  style={[
                    styles.peerChip,
                    {
                      backgroundColor: isCurrent ? colors.accentLight : colors.bgSecondary,
                      borderColor: isCurrent ? colors.accent : colors.border,
                    },
                  ]}
                  accessibilityRole="button"
                >
                  <Text
                    style={{
                      color: isCurrent ? colors.accent : colors.textPrimary,
                      fontSize: FontSize.xs,
                      fontWeight: "700",
                    }}
                  >
                    {peer.symbol}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 10 }}>
                    F/K {peer.pe != null ? formatNumber(peer.pe, 1) : peer.loss ? "Zarar" : EMPTY_VALUE}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : null}
    </SectionCard>
  );
}

function formatScoreValue(metric: ScoredMetric): string {
  if (metric.value === null) return EMPTY_VALUE;
  if (metric.id === "pe" && metric.value === LOSS_MAKING_PE) return "Zarar";
  if (metric.kind === "pct") return formatPercent(metric.value, 1);
  if (metric.kind === "multiple") return formatRatio(metric.value, 2);
  return formatNumber(metric.value, 2);
}

function ScoreBar({ score, colors }: { score: number | null; colors: ThemeColors }) {
  const tone = score === null ? colors.textMuted : score >= 3.5 ? colors.up : score >= 2.5 ? colors.warn : colors.down;
  return (
    <View style={styles.scoreBarRow}>
      <View style={[styles.scoreTrack, { backgroundColor: colors.bgSecondary, borderColor: colors.border }]}>
        {score !== null ? (
          <View style={[styles.scoreFill, { width: `${(score / 5) * 100}%`, backgroundColor: tone }]} />
        ) : null}
      </View>
      <Text style={[styles.scoreText, { color: score === null ? colors.textMuted : colors.textPrimary }]}>
        {score === null ? EMPTY_VALUE : formatNumber(score, 1)}
      </Text>
    </View>
  );
}

/**
 * "Şirket analiz karnesi": web FinancialHealthScorecard on the phone — four
 * fundamental categories plus the daily technical summary, each 1–5 points.
 */
export function ScorecardPanel({
  ratios,
  fastInfo,
  technicalLevel,
  loading,
}: {
  ratios: RatioSet | null;
  fastInfo: StockFastInfo | null;
  technicalLevel: SignalLevel | null;
  loading?: boolean;
}) {
  const colors = useThemeColors();
  const [expanded, setExpanded] = React.useState(false);
  const card = buildScorecard({
    ratios: ratios?.values,
    marketPe: fastInfo?.pe ?? null,
    marketPb: fastInfo?.pb ?? null,
    technicalLevel,
  });

  return (
    <SectionCard
      title="Şirket analiz karnesi"
      subtitle={
        card.overall !== null
          ? `Genel puan: 5 üzerinden ${formatNumber(card.overall, 1)}`
          : "Kârlılık, büyüme, finansal sağlık, değerleme ve teknik trend"
      }
    >
      {loading && card.overall === null ? (
        <LoadingBlock message="Karne hesaplanıyor…" />
      ) : card.overall === null ? (
        <Text style={{ color: colors.textMuted, fontSize: FontSize.sm }}>Karne için yeterli veri yok.</Text>
      ) : (
        <View style={{ gap: Spacing.sm }}>
          {card.categories.map((category) => (
            <View
              key={category.id}
              style={{ gap: 4 }}
              accessible
              accessibilityLabel={`${category.title}: ${
                category.score === null ? "veri yok" : `5 üzerinden ${formatNumber(category.score, 1)}`
              }. ${category.metrics
                .map((m) => `${m.label} ${formatScoreValue(m) === EMPTY_VALUE ? "veri yok" : formatScoreValue(m)}`)
                .join(", ")}`}
            >
              <Text style={[styles.subGroupTitle, { color: colors.textMuted }]}>
                {category.title.toLocaleUpperCase("tr")}
              </Text>
              <ScoreBar score={category.score} colors={colors} />
              {expanded
                ? category.metrics.map((metric) => (
                    <View key={metric.id} style={styles.scoreMetricRow}>
                      <Text style={{ flex: 1, color: colors.textSecondary, fontSize: FontSize.xs }}>{metric.label}</Text>
                      <Text style={[styles.scoreMetricValue, { color: colors.textPrimary }]}>
                        {formatScoreValue(metric)}
                      </Text>
                      <Text style={[styles.scoreMetricValue, { color: colors.textMuted, width: 44 }]}>
                        {metric.score === null ? EMPTY_VALUE : `${metric.score}/5`}
                      </Text>
                    </View>
                  ))
                : null}
            </View>
          ))}
          <View
            style={{ gap: 4 }}
            accessible
            accessibilityLabel={`Teknik trend: ${
              card.technicalScore === null ? "veri yok" : `5 üzerinden ${card.technicalScore}`
            }, günlük teknik özet ${signalLabelTr(card.technicalLevel)}`}
          >
            <Text style={[styles.subGroupTitle, { color: colors.textMuted }]}>TEKNİK TREND</Text>
            <ScoreBar score={card.technicalScore} colors={colors} />
            {expanded ? (
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                Günlük teknik özet: {signalLabelTr(card.technicalLevel)} · Güçlü al 5 · Al 4 · Nötr 3 · Sat 2 · Güçlü sat 1
              </Text>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
          >
            <Text style={{ color: colors.accent, fontSize: FontSize.xs, fontWeight: "600" }}>
              {expanded ? "Ayrıntıları gizle" : "Göstergeler ve puanlar"}
            </Text>
          </TouchableOpacity>
          <Text style={{ color: colors.textMuted, fontSize: 11, lineHeight: 15 }}>
            Her gösterge eşiklere göre 1–5 puan alır; kategori puanı göstergelerin, genel puan kategorilerin
            ortalamasıdır. Eşikler nominal TL verisi için basit kurallardır, yatırım tavsiyesi değildir.
          </Text>
        </View>
      )}
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  scoreBarRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  scoreTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  scoreFill: { height: "100%", borderRadius: 4 },
  scoreText: { width: 32, textAlign: "right", fontSize: FontSize.xs, fontWeight: "700", fontVariant: ["tabular-nums"] },
  scoreMetricRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingLeft: Spacing.xs },
  scoreMetricValue: { fontSize: FontSize.xs, fontVariant: ["tabular-nums"], textAlign: "right", minWidth: 64 },
  tileGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  subGroupTitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.7,
  },
  tableWrap: {
    gap: 2,
  },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  th: {
    fontSize: 11,
    fontWeight: "700",
  },
  td: {
    fontSize: FontSize.xs,
    fontVariant: ["tabular-nums"],
  },
  numCol: {
    flex: 1,
    textAlign: "right",
  },
  periodHeaderCell: {
    width: 78,
    alignItems: "flex-end",
  },
  periodValCell: {
    width: 78,
    textAlign: "right",
  },
  listWrap: {
    gap: Spacing.xs,
  },
  feedRow: {
    paddingVertical: Spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 3,
  },
  feedMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  voteRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  voteCounts: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  signalBadge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    minWidth: 68,
    alignItems: "center",
  },
  tfGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  tfCell: {
    width: "31%",
    minWidth: 88,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    alignItems: "center",
    gap: 2,
  },
  pivotGrid: {
    gap: 2,
  },
  pivotRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  segmentRow: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  segmentBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  kvList: {
    gap: 2,
  },
  kvRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
  },
  kvKey: {
    fontSize: FontSize.xs,
    width: 72,
  },
  kvVal: {
    fontSize: FontSize.xs,
    flex: 1,
    textAlign: "right",
    fontWeight: "500",
  },
  holderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  holderTrack: {
    height: 6,
    borderRadius: BorderRadius.full,
    overflow: "hidden",
  },
  holderFill: {
    height: "100%",
    borderRadius: BorderRadius.full,
  },
  peerWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.xs,
  },
  peerChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 1,
  },
});
