/**
 * Pure React Native interactive charts (zero native SVG/WebView dependencies so
 * Expo prebuild, CocoaPods, and iOS builds stay completely self-contained).
 *
 * Supports:
 *  - Multi-series line & stepped charts with optional Bollinger shaded band
 *  - Reference horizontal thresholds (previous close, RSI 30/70, zero baseline)
 *  - MACD histogram + MACD/Signal overlay sub-panel
 *  - Monthly vertical bar chart (e.g. Aylık TÜFE)
 *  - Touch/drag crosshair scrub readout showing exact date and series values
 */

import React, { useMemo, useState } from "react";
import { type GestureResponderEvent, type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { EMPTY_VALUE, formatNumber } from "../lib/format";
import {
  buildHistogramBars,
  buildLineSegments,
  computeYDomain,
  latestFinite,
  projectX,
  projectY,
  selectSampleIndices,
  type YDomain,
} from "../lib/indicators";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../lib/theme";

export interface ChartSeriesInput {
  id: string;
  label: string;
  values: ReadonlyArray<number | null>;
  color: string;
  strokeWidth?: number;
  stepped?: boolean;
}

export interface ChartReferenceLine {
  value: number;
  label?: string;
  color?: string;
}

export interface ChartBandInput {
  upper: ReadonlyArray<number | null>;
  lower: ReadonlyArray<number | null>;
  color: string;
}

interface MultiLineChartProps {
  labels: readonly string[];
  series: readonly ChartSeriesInput[];
  band?: ChartBandInput | null;
  referenceLines?: readonly ChartReferenceLine[];
  fixedDomain?: Partial<YDomain>;
  height?: number;
  formatValue?: (value: number | null) => string;
  formatAxis?: (value: number) => string;
  emptyMessage?: string;
}

function clampIndex(x: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, x / width));
  return Math.round(ratio * (count - 1));
}

export function MultiLineChart({
  labels,
  series,
  band,
  referenceLines,
  fixedDomain,
  height = 176,
  formatValue = (v) => formatNumber(v, 2),
  formatAxis = (v) => formatNumber(v, 2),
  emptyMessage = "Bu aralık için çizilecek veri bulunamadı.",
}: MultiLineChartProps) {
  const colors = useThemeColors();
  const [plotWidth, setPlotWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const primary = series[0];
  const sampleIndices = useMemo(() => {
    if (!primary || labels.length === 0) return [];
    return selectSampleIndices(primary.values, 92);
  }, [labels.length, primary]);

  const sampledLabels = useMemo(() => sampleIndices.map((i) => labels[i] ?? ""), [labels, sampleIndices]);
  const sampledSeries = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        values: sampleIndices.map((i) => s.values[i] ?? null),
      })),
    [sampleIndices, series],
  );
  const sampledBand = useMemo(() => {
    if (!band) return null;
    return {
      color: band.color,
      upper: sampleIndices.map((i) => band.upper[i] ?? null),
      lower: sampleIndices.map((i) => band.lower[i] ?? null),
    };
  }, [band, sampleIndices]);

  const domain = useMemo(() => {
    const allSeries: Array<ReadonlyArray<number | null>> = sampledSeries.map((s) => s.values);
    if (sampledBand) {
      allSeries.push(sampledBand.upper, sampledBand.lower);
    }
    if (referenceLines && referenceLines.length > 0) {
      allSeries.push(referenceLines.map((r) => r.value));
    }
    return computeYDomain(allSeries, fixedDomain);
  }, [fixedDomain, referenceLines, sampledBand, sampledSeries]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width);
    if (w > 0 && w !== plotWidth) setPlotWidth(w);
  };

  const handleTouch = (e: GestureResponderEvent) => {
    if (plotWidth <= 0 || sampledLabels.length === 0) return;
    const x = e.nativeEvent.locationX;
    setActiveIndex(clampIndex(x, plotWidth, sampledLabels.length));
  };

  if (!domain || sampledLabels.length < 2) {
    return (
      <View style={[styles.emptyPlot, { height: Math.min(height, 110), borderColor: colors.border }]}>
        <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>{emptyMessage}</Text>
      </View>
    );
  }

  const displayIdx =
    activeIndex !== null && activeIndex < sampledLabels.length ? activeIndex : null;
  const midVal = (domain.min + domain.max) / 2;
  const xStart = sampledLabels[0] ?? "";
  const xMid = sampledLabels[Math.floor(sampledLabels.length / 2)] ?? "";
  const xEnd = sampledLabels[sampledLabels.length - 1] ?? "";

  return (
    <View style={styles.wrapper}>
      {/* Live legend / scrub readout */}
      <View style={styles.legendRow}>
        {displayIdx !== null ? (
          <Text style={[styles.scrubDate, { color: colors.textPrimary }]}>
            {sampledLabels[displayIdx]}
          </Text>
        ) : null}
        {sampledSeries.map((s) => {
          const val = displayIdx !== null ? s.values[displayIdx] : latestFinite(s.values);
          return (
            <View key={s.id} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: s.color }]} />
              <Text style={[styles.legendText, { color: colors.textSecondary }]}>
                {s.label}: <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{formatValue(val)}</Text>
              </Text>
            </View>
          );
        })}
      </View>

      <View style={styles.plotRow}>
        {/* Y-axis labels */}
        <View style={[styles.yAxis, { height }]}>
          <Text style={[styles.axisLabel, { color: colors.textMuted }]} numberOfLines={1}>
            {formatAxis(domain.max)}
          </Text>
          <Text style={[styles.axisLabel, { color: colors.textMuted }]} numberOfLines={1}>
            {formatAxis(midVal)}
          </Text>
          <Text style={[styles.axisLabel, { color: colors.textMuted }]} numberOfLines={1}>
            {formatAxis(domain.min)}
          </Text>
        </View>

        {/* Plot canvas */}
        <View
          style={[styles.plotArea, { height, borderColor: colors.border }]}
          onLayout={handleLayout}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleTouch}
          onResponderMove={handleTouch}
          onResponderRelease={() => setActiveIndex(null)}
          onResponderTerminate={() => setActiveIndex(null)}
        >
          {/* Grid lines */}
          <View style={[styles.gridLine, { top: 0, backgroundColor: colors.border }]} />
          <View style={[styles.gridLine, { top: height / 2, backgroundColor: colors.border }]} />
          <View style={[styles.gridLine, { top: height - 1, backgroundColor: colors.border }]} />

          {/* Reference lines */}
          {plotWidth > 0 &&
            referenceLines?.map((refLine, idx) => {
              const y = projectY(refLine.value, domain, height);
              if (y < 0 || y > height) return null;
              return (
                <View
                  key={`${refLine.value}-${idx}`}
                  pointerEvents="none"
                  style={[
                    styles.refLine,
                    {
                      top: y,
                      borderTopColor: refLine.color ?? colors.textMuted,
                    },
                  ]}
                >
                  {refLine.label ? (
                    <Text
                      style={[
                        styles.refLabel,
                        { color: refLine.color ?? colors.textMuted, backgroundColor: colors.bgCard },
                      ]}
                    >
                      {refLine.label}
                    </Text>
                  ) : null}
                </View>
              );
            })}

          {/* Shaded band columns (e.g. Bollinger envelope) */}
          {plotWidth > 0 && sampledBand
            ? sampledBand.upper.map((u, idx) => {
                const l = sampledBand.lower[idx];
                if (u === null || l === null) return null;
                const yTop = projectY(Math.max(u, l), domain, height);
                const yBot = projectY(Math.min(u, l), domain, height);
                const colW = Math.max(1.5, plotWidth / sampledLabels.length);
                const x = projectX(idx, sampledLabels.length, plotWidth) - colW / 2;
                return (
                  <View
                    key={`band-${idx}`}
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      left: Math.max(0, x),
                      top: yTop,
                      width: colW + 0.5,
                      height: Math.max(1, yBot - yTop),
                      backgroundColor: sampledBand.color,
                    }}
                  />
                );
              })
            : null}

          {/* Series segments */}
          {plotWidth > 0 &&
            sampledSeries.map((s) => {
              const stroke = s.strokeWidth ?? 2;
              const segs = buildLineSegments(s.values, domain, plotWidth, height, stroke, Boolean(s.stepped));
              return segs.map((seg) => (
                <View
                  key={`${s.id}-${seg.key}`}
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: seg.left,
                    top: seg.top,
                    width: seg.width,
                    height: stroke,
                    borderRadius: stroke / 2,
                    backgroundColor: s.color,
                    transform: [{ rotate: `${seg.angleRad}rad` }],
                  }}
                />
              ));
            })}

          {/* Touch crosshair */}
          {plotWidth > 0 && displayIdx !== null ? (
            <>
              <View
                pointerEvents="none"
                style={[
                  styles.crosshairLine,
                  {
                    left: projectX(displayIdx, sampledLabels.length, plotWidth),
                    height,
                    backgroundColor: colors.textMuted,
                  },
                ]}
              />
              {sampledSeries[0]?.values[displayIdx] !== null &&
              sampledSeries[0]?.values[displayIdx] !== undefined ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.crosshairDot,
                    {
                      left: projectX(displayIdx, sampledLabels.length, plotWidth) - 4,
                      top: projectY(sampledSeries[0].values[displayIdx] as number, domain, height) - 4,
                      backgroundColor: sampledSeries[0].color,
                      borderColor: colors.bgCard,
                    },
                  ]}
                />
              ) : null}
            </>
          ) : null}
        </View>
      </View>

      {/* X-axis ticks */}
      <View style={styles.xAxisRow}>
        <Text style={[styles.axisLabel, { color: colors.textMuted }]} numberOfLines={1}>
          {xStart}
        </Text>
        <Text style={[styles.axisLabel, { color: colors.textMuted }]} numberOfLines={1}>
          {xMid}
        </Text>
        <Text style={[styles.axisLabel, { color: colors.textMuted }]} numberOfLines={1}>
          {xEnd}
        </Text>
      </View>
    </View>
  );
}

export function MacdSubChart({
  labels,
  macd,
  signal,
  histogram,
  height = 112,
}: {
  labels: readonly string[];
  macd: ReadonlyArray<number | null>;
  signal: ReadonlyArray<number | null>;
  histogram: ReadonlyArray<number | null>;
  height?: number;
}) {
  const colors = useThemeColors();
  const [plotWidth, setPlotWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const sampleIndices = useMemo(() => selectSampleIndices(macd, 80), [macd]);
  const sLabels = useMemo(() => sampleIndices.map((i) => labels[i] ?? ""), [labels, sampleIndices]);
  const sMacd = useMemo(() => sampleIndices.map((i) => macd[i] ?? null), [macd, sampleIndices]);
  const sSig = useMemo(() => sampleIndices.map((i) => signal[i] ?? null), [signal, sampleIndices]);
  const sHist = useMemo(() => sampleIndices.map((i) => histogram[i] ?? null), [histogram, sampleIndices]);

  const domain = useMemo(() => computeYDomain([sMacd, sSig, sHist, [0]]), [sHist, sMacd, sSig]);

  if (!domain || sLabels.length < 2) {
    return (
      <View style={[styles.emptyPlot, { height: 72, borderColor: colors.border }]}>
        <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>
          MACD hesaplamak için yeterli bar bulunamadı.
        </Text>
      </View>
    );
  }

  const displayIdx = activeIndex !== null && activeIndex < sLabels.length ? activeIndex : null;
  const macdVal = displayIdx !== null ? sMacd[displayIdx] : latestFinite(sMacd);
  const sigVal = displayIdx !== null ? sSig[displayIdx] : latestFinite(sSig);
  const histVal = displayIdx !== null ? sHist[displayIdx] : latestFinite(sHist);
  const zeroY = projectY(0, domain, height);

  const handleTouch = (e: GestureResponderEvent) => {
    if (plotWidth <= 0 || sLabels.length === 0) return;
    setActiveIndex(clampIndex(e.nativeEvent.locationX, plotWidth, sLabels.length));
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.legendRow}>
        {displayIdx !== null ? (
          <Text style={[styles.scrubDate, { color: colors.textPrimary }]}>{sLabels[displayIdx]}</Text>
        ) : null}
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>
            MACD: <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{formatNumber(macdVal, 2)}</Text>
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: colors.warn }]} />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>
            Sinyal: <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{formatNumber(sigVal, 2)}</Text>
          </Text>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendDot,
              { backgroundColor: (histVal ?? 0) >= 0 ? colors.up : colors.down },
            ]}
          />
          <Text style={[styles.legendText, { color: colors.textSecondary }]}>
            Hist: <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{formatNumber(histVal, 2)}</Text>
          </Text>
        </View>
      </View>

      <View style={styles.plotRow}>
        <View style={[styles.yAxis, { height }]}>
          <Text style={[styles.axisLabel, { color: colors.textMuted }]} numberOfLines={1}>
            {formatNumber(domain.max, 2)}
          </Text>
          <Text style={[styles.axisLabel, { color: colors.textMuted }]} numberOfLines={1}>
            0
          </Text>
          <Text style={[styles.axisLabel, { color: colors.textMuted }]} numberOfLines={1}>
            {formatNumber(domain.min, 2)}
          </Text>
        </View>

        <View
          style={[styles.plotArea, { height, borderColor: colors.border }]}
          onLayout={(e) => setPlotWidth(Math.floor(e.nativeEvent.layout.width))}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleTouch}
          onResponderMove={handleTouch}
          onResponderRelease={() => setActiveIndex(null)}
          onResponderTerminate={() => setActiveIndex(null)}
        >
          <View style={[styles.gridLine, { top: zeroY, backgroundColor: colors.border }]} />

          {plotWidth > 0 &&
            buildHistogramBars(sHist, domain, plotWidth, height).map((bar) => (
              <View
                key={`hist-${bar.index}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: bar.left,
                  top: bar.top,
                  width: bar.width,
                  height: bar.height,
                  backgroundColor: bar.positive ? colors.up : colors.down,
                  opacity: 0.45,
                  borderRadius: 1,
                }}
              />
            ))}

          {plotWidth > 0 &&
            buildLineSegments(sMacd, domain, plotWidth, height, 1.75).map((seg) => (
              <View
                key={`macd-${seg.key}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: seg.left,
                  top: seg.top,
                  width: seg.width,
                  height: 1.75,
                  backgroundColor: colors.accent,
                  transform: [{ rotate: `${seg.angleRad}rad` }],
                }}
              />
            ))}

          {plotWidth > 0 &&
            buildLineSegments(sSig, domain, plotWidth, height, 1.5).map((seg) => (
              <View
                key={`sig-${seg.key}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: seg.left,
                  top: seg.top,
                  width: seg.width,
                  height: 1.5,
                  backgroundColor: colors.warn,
                  transform: [{ rotate: `${seg.angleRad}rad` }],
                }}
              />
            ))}

          {plotWidth > 0 && displayIdx !== null ? (
            <View
              pointerEvents="none"
              style={[
                styles.crosshairLine,
                {
                  left: projectX(displayIdx, sLabels.length, plotWidth),
                  height,
                  backgroundColor: colors.textMuted,
                },
              ]}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

export function VerticalBarChart({
  labels,
  values,
  height = 128,
  formatValue = (v) => (v === null ? EMPTY_VALUE : `%${formatNumber(v, 2)}`),
}: {
  labels: readonly string[];
  values: ReadonlyArray<number | null>;
  height?: number;
  formatValue?: (value: number | null) => string;
}) {
  const colors = useThemeColors();
  const [plotWidth, setPlotWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const domain = useMemo(() => computeYDomain([values, [0]], undefined, 0.1), [values]);

  if (!domain || labels.length === 0) {
    return (
      <View style={[styles.emptyPlot, { height: 84, borderColor: colors.border }]}>
        <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }}>
          Grafik verisi bulunamadı.
        </Text>
      </View>
    );
  }

  const displayIdx = activeIndex !== null && activeIndex < labels.length ? activeIndex : labels.length - 1;
  const zeroY = projectY(0, domain, height);

  const handleTouch = (e: GestureResponderEvent) => {
    if (plotWidth <= 0 || labels.length === 0) return;
    setActiveIndex(clampIndex(e.nativeEvent.locationX, plotWidth, labels.length));
  };

  return (
    <View style={styles.wrapper}>
      <View style={styles.legendRow}>
        <Text style={[styles.scrubDate, { color: colors.textPrimary }]}>{labels[displayIdx]}</Text>
        <Text style={[styles.legendText, { color: colors.accent, fontWeight: "700" }]}>
          {formatValue(values[displayIdx] ?? null)}
        </Text>
      </View>

      <View style={styles.plotRow}>
        <View style={[styles.yAxis, { height }]}>
          <Text style={[styles.axisLabel, { color: colors.textMuted }]}>
            {formatValue(domain.max)}
          </Text>
          <Text style={[styles.axisLabel, { color: colors.textMuted }]}>
            {formatValue(0)}
          </Text>
        </View>
        <View
          style={[styles.plotArea, { height, borderColor: colors.border }]}
          onLayout={(e) => setPlotWidth(Math.floor(e.nativeEvent.layout.width))}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleTouch}
          onResponderMove={handleTouch}
          onResponderRelease={() => setActiveIndex(null)}
          onResponderTerminate={() => setActiveIndex(null)}
        >
          <View style={[styles.gridLine, { top: zeroY, backgroundColor: colors.border }]} />
          {plotWidth > 0 &&
            buildHistogramBars(values, domain, plotWidth, height).map((bar) => (
              <View
                key={`bar-${bar.index}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: bar.left,
                  top: bar.top,
                  width: bar.width,
                  height: bar.height,
                  borderRadius: 2,
                  backgroundColor: bar.index === displayIdx ? colors.accent : bar.positive ? colors.accent : colors.down,
                  opacity: bar.index === displayIdx ? 1 : 0.6,
                }}
              />
            ))}
        </View>
      </View>

      <View style={styles.xAxisRow}>
        <Text style={[styles.axisLabel, { color: colors.textMuted }]}>{labels[0] ?? ""}</Text>
        <Text style={[styles.axisLabel, { color: colors.textMuted }]}>
          {labels[Math.floor(labels.length / 2)] ?? ""}
        </Text>
        <Text style={[styles.axisLabel, { color: colors.textMuted }]}>{labels[labels.length - 1] ?? ""}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.xs,
  },
  legendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: 18,
  },
  scrubDate: {
    fontSize: 11,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    fontVariant: ["tabular-nums"],
  },
  plotRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: Spacing.xs,
  },
  yAxis: {
    width: 50,
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  plotArea: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    borderRadius: BorderRadius.md,
  },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    opacity: 0.7,
  },
  refLine: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: "dashed",
    opacity: 0.75,
  },
  refLabel: {
    position: "absolute",
    right: 4,
    top: -12,
    fontSize: 9,
    fontWeight: "600",
    paddingHorizontal: 3,
  },
  crosshairLine: {
    position: "absolute",
    top: 0,
    width: 1,
    opacity: 0.6,
  },
  crosshairDot: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  xAxisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingLeft: 54,
  },
  axisLabel: {
    fontSize: 10,
    fontVariant: ["tabular-nums"],
  },
  emptyPlot: {
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
});
