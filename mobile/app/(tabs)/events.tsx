import React, { useEffect, useMemo, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActionSheetIOS, Linking, Pressable, RefreshControl, SectionList, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyCard, ErrorCard, FreshnessBanner } from "../../components/StatusViews";
import {
  Card,
  Chip,
  haptic,
  type IconName,
  ScreenHeader,
  SegmentedControl,
  SkeletonRows,
  StatusBarScrim,
  usePullToRefresh,
} from "../../components/ui";
import { mobileApi, type EventItemPayload } from "../../lib/api";
import { formatIstanbulTime, parseIsoOrEpoch } from "../../lib/format";
import { BorderRadius, FontSize, Spacing, Type, useIsDarkTheme, useThemeColors, type ThemeColors } from "../../lib/theme";
import { useResource } from "../../lib/useResource";

type SeverityFilter = "" | "high" | "watch";

const SEVERITIES: readonly { id: SeverityFilter; label: string }[] = [
  { id: "", label: "Tümü" },
  { id: "high", label: "Yüksek önem" },
  { id: "watch", label: "Takip" },
];

const CATEGORY_META: Record<string, { label: string; icon: IconName }> = {
  piyasa_duyurusu: { label: "Piyasa duyurusu", icon: "megaphone" },
  "borçlanma_aracı": { label: "Borçlanma aracı", icon: "banknote" },
  "pay_geri_alımı": { label: "Geri alım", icon: "arrow.uturn.backward.circle" },
  kredi_notu: { label: "Kredi notu", icon: "rosette" },
  "yeni_iş": { label: "Yeni iş", icon: "briefcase" },
  dava_ceza: { label: "Dava / ceza", icon: "building.columns" },
  "yönetim_değişimi": { label: "Yönetim", icon: "person.2" },
  "pay_alım_satım": { label: "Pay alım satım", icon: "arrow.left.arrow.right" },
  "temettü": { label: "Temettü", icon: "dollarsign.circle" },
  "finansal_rapor": { label: "Finansal rapor", icon: "doc.text" },
  "sermaye_artırımı": { label: "Sermaye artırımı", icon: "chart.bar.doc.horizontal" },
};

const DEFAULT_META = { label: "Bildirim", icon: "doc.plaintext" as IconName };

function categoryMeta(category?: string): { label: string; icon: IconName } {
  if (!category) return DEFAULT_META;
  const known = CATEGORY_META[category];
  if (known) return known;
  const label = category.replace(/_/g, " ");
  return { label: label.charAt(0).toLocaleUpperCase("tr-TR") + label.slice(1), icon: DEFAULT_META.icon };
}

function severityTone(severity: string | undefined, colors: ThemeColors) {
  const s = severity?.toUpperCase();
  if (s === "HIGH") return { fg: colors.down, bg: colors.downSoft, label: "Yüksek önem" };
  if (s === "WATCH") return { fg: colors.warn, bg: colors.warnSoft, label: "Takip" };
  return { fg: colors.accent, bg: colors.accentLight, label: "Bilgi" };
}

const DAY_FORMAT = (() => {
  try {
    return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", weekday: "long", timeZone: "Europe/Istanbul" });
  } catch {
    return null;
  }
})();

const DAY_KEY_FORMAT = (() => {
  try {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Istanbul" });
  } catch {
    return null;
  }
})();

function dayKey(ms: number): string {
  return DAY_KEY_FORMAT ? DAY_KEY_FORMAT.format(new Date(ms)) : new Date(ms).toISOString().slice(0, 10);
}

function dayTitle(ms: number, nowMs: number): string {
  const key = dayKey(ms);
  if (key === dayKey(nowMs)) return "Bugün";
  if (key === dayKey(nowMs - 86_400_000)) return "Dün";
  return DAY_FORMAT ? DAY_FORMAT.format(new Date(ms)) : key;
}

function isKapUrl(url: string | undefined): url is string {
  if (!url) return false;
  return /^https:\/\/(www\.)?kap\.org\.tr\//.test(url);
}

export default function EventsScreen() {
  const params = useLocalSearchParams<{ ticker?: string; severity?: string; category?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const toFilter = (v?: string): SeverityFilter => (v === "high" || v === "watch" ? v : "");
  const [severity, setSeverity] = useState<SeverityFilter>(toFilter(params.severity));
  // A deep link that arrives while this tab is already open replaces the params in place.
  useEffect(() => setSeverity(toFilter(params.severity)), [params.severity]);
  const [tickerFilter, setTickerFilter] = useState(params.ticker ?? "");
  useEffect(() => setTickerFilter(params.ticker ?? ""), [params.ticker]);

  const events = useResource({
    key: `events:${tickerFilter}:${severity}:${params.category ?? ""}`,
    cacheKey: tickerFilter || severity || params.category ? undefined : "events_default",
    fetcher: (signal) =>
      mobileApi.events({ ticker: tickerFilter || undefined, severity: severity || undefined, category: params.category }, signal),
    isEmpty: (res) => !res.items || res.items.length === 0,
  });

  const pull = usePullToRefresh(events.reload, events.refreshing);

  const sections = useMemo(() => {
    const now = Date.now();
    const groups = new Map<string, { title: string; data: EventItemPayload[] }>();
    for (const item of events.data?.items ?? []) {
      const ms = parseIsoOrEpoch(item.published_at ?? null);
      const key = ms === null ? "?" : dayKey(ms);
      if (!groups.has(key)) groups.set(key, { title: ms === null ? "Tarihsiz" : dayTitle(ms, now), data: [] });
      groups.get(key)!.data.push(item);
    }
    return [...groups.values()];
  }, [events.data?.items]);

  const header = (
    <View style={styles.header}>
      <ScreenHeader title="Takvim" subtitle="KAP bildirimleri" />
      <SegmentedControl options={SEVERITIES} value={severity} onChange={setSeverity} size="sm" />
      {tickerFilter ? (
        <View style={{ flexDirection: "row" }}>
          <Chip active removable label={`Hisse: ${tickerFilter}`} onPress={() => setTickerFilter("")} />
        </View>
      ) : null}
      <FreshnessBanner
        status={events.status}
        fetchedAt={events.fetchedAt}
        source="Kamuyu Aydınlatma Platformu"
        refreshing={events.refreshing}
        error={events.error}
        onRetry={events.reload}
      />
    </View>
  );

  const isLoading = events.status === "loading" && !events.data;
  const isError = events.status === "error" && !events.data;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgPrimary }}>
    <SectionList
      style={{ flex: 1, backgroundColor: colors.bgPrimary }}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.md, paddingBottom: Spacing.xxl * 2 }]}
      sections={isLoading || isError ? [] : sections}
      keyExtractor={(item) => String(item.id)}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl {...pull} tintColor={colors.accent} />}
      renderSectionHeader={({ section }) => (
        <Text style={[styles.dayHeader, { color: colors.textSecondary }]}>{section.title}</Text>
      )}
      renderItem={({ item, index, section }) => (
        <EventRow
          item={item}
          first={index === 0}
          last={index === section.data.length - 1}
          onOpenStock={item.ticker ? () => router.push(`/stock/${item.ticker}` as never) : undefined}
          onFilterTicker={item.ticker ? () => setTickerFilter(item.ticker ?? "") : undefined}
        />
      )}
      ListEmptyComponent={
        isLoading ? (
          <Card padded={false}>
            <SkeletonRows count={6} />
          </Card>
        ) : isError ? (
          <ErrorCard title="KAP bildirimleri alınamadı" message={events.error ?? "Sunucuya bağlanılamadı."} onRetry={events.reload} />
        ) : (
          <EmptyCard
            icon="calendar.badge.exclamationmark"
            title="Bildirim yok"
            message="Seçili filtreye uyan KAP bildirimi bulunmuyor."
            actionLabel={severity || tickerFilter ? "Filtreyi temizle" : "Yenile"}
            onAction={() => {
              if (severity || tickerFilter) {
                setSeverity("");
                setTickerFilter("");
              } else {
                events.reload();
              }
            }}
          />
        )
      }
    />
    <StatusBarScrim />
    </View>
  );
}

function EventRow({
  item,
  first,
  last,
  onOpenStock,
  onFilterTicker,
}: {
  item: EventItemPayload;
  first: boolean;
  last: boolean;
  onOpenStock?: () => void;
  onFilterTicker?: () => void;
}) {
  const colors = useThemeColors();
  const isDark = useIsDarkTheme();
  const meta = categoryMeta(item.category);
  const tone = severityTone(item.severity, colors);
  const kapUrl = isKapUrl(item.event_url) ? item.event_url : undefined;
  const openKap = kapUrl
    ? () => {
        haptic.light();
        void Linking.openURL(kapUrl).catch(() => undefined);
      }
    : undefined;
  const onPress = openKap ?? onOpenStock;

  const showActions = () => {
    const actions: { label: string; run: () => void }[] = [];
    if (kapUrl) actions.push({ label: "Bildirimi KAP'ta aç", run: openKap! });
    if (onOpenStock) actions.push({ label: `${item.ticker} analizini aç`, run: onOpenStock });
    if (onFilterTicker) actions.push({ label: `Yalnızca ${item.ticker} bildirimleri`, run: onFilterTicker });
    if (kapUrl) {
      actions.push({
        label: "Paylaş",
        run: () => void Share.share({ message: `${item.ticker ?? "KAP"} · ${item.title ?? ""}\n${kapUrl}` }).catch(() => undefined),
      });
    }
    if (actions.length === 0) return;
    haptic.medium();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: item.ticker ?? "KAP",
        message: item.title ?? undefined,
        options: [...actions.map((a) => a.label), "Vazgeç"],
        cancelButtonIndex: actions.length,
        userInterfaceStyle: isDark ? "dark" : "light",
      },
      (index) => actions[index]?.run(),
    );
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={showActions}
      delayLongPress={320}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.ticker ?? "KAP"}, ${meta.label}, ${tone.label}: ${item.title ?? ""}`}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.pressed : colors.bgCard,
          borderColor: colors.border,
          borderTopLeftRadius: first ? BorderRadius.lg : 0,
          borderTopRightRadius: first ? BorderRadius.lg : 0,
          borderBottomLeftRadius: last ? BorderRadius.lg : 0,
          borderBottomRightRadius: last ? BorderRadius.lg : 0,
          borderTopWidth: first ? StyleSheet.hairlineWidth : 0,
          borderBottomWidth: last ? StyleSheet.hairlineWidth : 0,
        },
      ]}
    >
      <View style={[styles.rowBody, !last ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator } : null]}>
        <View style={styles.rowMeta}>
          <Text style={{ color: colors.textPrimary, fontWeight: "700", fontSize: FontSize.sm }} numberOfLines={1}>
            {item.ticker ?? "KAP"}
            {item.company_name ? (
              <Text style={{ color: colors.textMuted, fontWeight: "400" }}>{`  ${item.company_name}`}</Text>
            ) : null}
          </Text>
          <Text style={[Type.number, { color: colors.textMuted, fontSize: 11 }]}>
            {item.published_at ? formatIstanbulTime(item.published_at) : ""}
          </Text>
        </View>
        <Text style={{ color: colors.textPrimary, fontSize: FontSize.sm, lineHeight: 19 }} numberOfLines={3}>
          {item.title ?? item.form_title ?? "Bildirim"}
        </Text>
        <Text style={{ color: tone.label === "Bilgi" ? colors.textMuted : tone.fg, fontSize: 11, fontWeight: "600", marginTop: 2 }}>
          {meta.label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.lg },
  header: { gap: Spacing.md, marginBottom: Spacing.xs },
  dayHeader: { fontSize: FontSize.sm, fontWeight: "600", marginTop: Spacing.lg, marginBottom: Spacing.sm, marginLeft: 2 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingLeft: Spacing.lg,
    gap: Spacing.md,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: 4, paddingVertical: 12, paddingRight: Spacing.lg },
  rowMeta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: Spacing.sm },
});
