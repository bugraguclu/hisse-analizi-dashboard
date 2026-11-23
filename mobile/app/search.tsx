import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SymbolSearchResult } from "../../dashboard/src/types/index.ts";
import { ErrorCard } from "../components/StatusViews";
import { Card, ChangePill, Icon, ListRow, SkeletonRows, trUpper } from "../components/ui";
import { useAppContext } from "../contexts/AppContext";
import { mobileApi } from "../lib/api";
import { normalizeTicker } from "../lib/externalLinking";
import { formatPrice } from "../lib/format";
import { describeApiFailure, isAbortError, RequestGuard } from "../lib/requestState";
import type { ScreenerStockRow } from "../lib/screener";
import { BorderRadius, FontSize, Spacing, Type, useThemeColors } from "../lib/theme";
import { useMarketUniverse } from "../lib/useMarketUniverse";
import { useStockActions } from "../lib/useStockActions";

const POPULAR = ["THYAO", "GARAN", "AKBNK", "ASELS", "EREGL", "TUPRS", "KCHOL", "SISE"] as const;

function fold(text: string): string {
  return text.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

interface Hit {
  code: string;
  name: string | null;
  row?: ScreenerStockRow;
}

export default function SearchModalScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { watchlists } = useAppContext();
  const universe = useMarketUniverse();
  const stockActions = useStockActions();
  const [query, setQuery] = useState(params.q ?? "");
  const [remoteResults, setRemoteResults] = useState<SymbolSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardRef = useRef(new RequestGuard());

  const trimmed = query.trim();
  const folded = fold(trimmed);

  // Local, instant matches from the quote board (all BIST shares).
  const localHits = useMemo<Hit[]>(() => {
    if (folded.length === 0) return [];
    const rows = (universe.data?.rows ?? []) as ScreenerStockRow[];
    const exact: Hit[] = [];
    const starts: Hit[] = [];
    const contains: Hit[] = [];
    for (const row of rows) {
      const sym = row.symbol.toLowerCase();
      const name = fold(row.name ?? "");
      const hit = { code: row.symbol, name: row.name ?? null, row };
      if (sym === folded) exact.push(hit);
      else if (sym.startsWith(folded) || name.startsWith(folded)) starts.push(hit);
      else if (folded.length >= 2 && (name.includes(folded) || sym.includes(folded))) contains.push(hit);
    }
    return [...exact, ...starts, ...contains].slice(0, 30);
  }, [folded, universe.data?.rows]);

  // Remote search only fills in when the local board has nothing (offline cache, new listings).
  const needRemote = trimmed.length >= 2 && localHits.length === 0 && universe.status !== "loading";

  useEffect(() => {
    const guard = guardRef.current;
    if (!needRemote) {
      guard.cancel();
      setRemoteResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const timer = setTimeout(() => {
      const { token, signal } = guard.begin(trimmed);
      setLoading(true);
      setError(null);
      void mobileApi
        .searchSymbols(trimmed, signal)
        .then((res) => {
          if (!guard.isCurrent(token, trimmed)) return;
          setRemoteResults(res.results ?? []);
          setLoading(false);
        })
        .catch((err) => {
          if (isAbortError(err) || !guard.isCurrent(token, trimmed)) return;
          setError(describeApiFailure(err).message);
          setRemoteResults([]);
          setLoading(false);
        });
    }, 200);

    return () => {
      clearTimeout(timer);
      guard.cancel();
    };
  }, [needRemote, trimmed]);

  const remoteHits = useMemo<Hit[]>(
    () =>
      remoteResults
        .map((item): Hit | null => {
          const code = normalizeTicker(item.symbol ?? item.ticker ?? "");
          return code ? { code, name: item.name ?? item.description ?? null, row: universe.bySymbol.get(code) } : null;
        })
        .filter((h): h is Hit => h !== null)
        .slice(0, 20),
    [remoteResults, universe.bySymbol],
  );

  const watchSet = useMemo(() => new Set(watchlists[0]?.tickers ?? []), [watchlists]);

  const suggestions = useMemo<Hit[]>(() => {
    const seen = new Set<string>();
    const list: Hit[] = [];
    for (const code of [...(watchlists[0]?.tickers ?? []), ...POPULAR]) {
      if (seen.has(code)) continue;
      seen.add(code);
      const row = universe.bySymbol.get(code);
      list.push({ code, name: row?.name ?? null, row });
    }
    return list.slice(0, 10);
  }, [universe.bySymbol, watchlists]);

  const openTicker = (raw: string) => {
    const ticker = normalizeTicker(raw);
    if (!ticker) return;
    router.replace(`/stock/${ticker}` as never);
  };

  const hits = localHits.length > 0 ? localHits : remoteHits;
  const showingSuggestions = trimmed.length === 0;
  const list = showingSuggestions ? suggestions : hits;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.bgPrimary,
          paddingTop: Spacing.lg,
          paddingBottom: Math.max(insets.bottom, Spacing.lg),
        },
      ]}
    >
      <View style={styles.searchRow}>
        <View style={[styles.inputWrap, { backgroundColor: colors.fill }]}>
          <Icon name="magnifyingglass" size={15} color={colors.textMuted} weight="semibold" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => openTicker(hits[0]?.code ?? query)}
            placeholder="Hisse kodu veya şirket adı"
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.textPrimary }]}
            accessibilityLabel="Hisse ara"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Aramayı temizle">
              <Icon name="xmark.circle.fill" size={16} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
          <Text style={{ color: colors.accent, fontSize: FontSize.md }}>Vazgeç</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Text style={[Type.overline, { color: colors.textMuted, marginLeft: 2 }]}>
          {trUpper(showingSuggestions ? (watchSet.size > 0 ? "Takip listen ve popüler" : "Popüler") : `${hits.length} sonuç`)}
        </Text>

        {!showingSuggestions && (loading || (universe.status === "loading" && !universe.data)) ? (
          <Card padded={false}>
            <SkeletonRows count={4} />
          </Card>
        ) : !showingSuggestions && error && hits.length === 0 ? (
          <ErrorCard title="Arama yapılamadı" message={error} />
        ) : list.length === 0 ? (
          <View style={styles.noResult}>
            <Icon name="magnifyingglass" size={28} color={colors.textMuted} />
            <Text style={[Type.headline, { color: colors.textPrimary }]}>Sonuç yok</Text>
            <Text style={{ color: colors.textMuted, fontSize: FontSize.sm, textAlign: "center" }}>
              “{trimmed}” ile eşleşen BIST şirketi bulunamadı. Kodu veya şirket adını kontrol edin.
            </Text>
          </View>
        ) : (
          <Card padded={false}>
            {list.map((hit, i) => (
              <ListRow
                key={hit.code}
                title={hit.code}
                subtitle={hit.name}
                onPress={() => openTicker(hit.code)}
                onLongPress={() =>
                  stockActions(hit.code, { name: hit.name, price: hit.row?.close, changePct: hit.row?.change_pct })
                }
                isLast={i === list.length - 1}
                accessibilityLabel={`${hit.code} ${hit.name ?? ""} analizini aç`}
                trailing={
                  hit.row ? (
                    <View style={styles.trailing}>
                      <Text style={[Type.number, { color: colors.textPrimary, fontSize: FontSize.sm, fontWeight: "600" }]}>
                        {formatPrice(hit.row.close)}
                      </Text>
                      <ChangePill value={hit.row.change_pct} size="sm" />
                    </View>
                  ) : watchSet.has(hit.code) ? (
                    <Icon name="star.fill" size={13} color={colors.warn} />
                  ) : null
                }
              />
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg, gap: Spacing.md },
  searchRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    height: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
  },
  input: { flex: 1, fontSize: FontSize.md, paddingVertical: 0 },
  list: { gap: Spacing.sm, paddingBottom: Spacing.xxl },
  trailing: { alignItems: "flex-end", gap: 4 },
  noResult: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xxl, paddingHorizontal: Spacing.lg },
});
