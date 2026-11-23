import React, { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SymbolSearchResult } from "../../dashboard/src/types/index.ts";
import { EmptyCard, ErrorCard, LoadingBlock } from "../components/StatusViews";
import { mobileApi } from "../lib/api";
import { normalizeTicker } from "../lib/externalLinking";
import { describeApiFailure, isAbortError, RequestGuard } from "../lib/requestState";
import { BorderRadius, FontSize, Spacing, useThemeColors } from "../lib/theme";

const POPULAR = ["THYAO", "GARAN", "AKBNK", "ASELS", "EREGL", "TUPRS", "KCHOL", "SISE"] as const;

export default function SearchModalScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState(params.q ?? "");
  const [remoteResults, setRemoteResults] = useState<SymbolSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guardRef = useRef(new RequestGuard());

  const trimmed = query.trim();

  useEffect(() => {
    const guard = guardRef.current;
    if (trimmed.length < 2) {
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
  }, [trimmed]);

  const filteredPopular = POPULAR.filter((ticker) =>
    ticker.includes(trimmed.toUpperCase()),
  );

  const openTicker = (raw: string) => {
    const ticker = normalizeTicker(raw);
    if (!ticker) return;
    router.replace(`/stock/${ticker}` as never);
  };

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
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>Hisse Ara</Text>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text style={{ color: colors.accent, fontSize: FontSize.md }}>Kapat</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => openTicker(query)}
        placeholder="Hisse kodu veya şirket adı (örn. THYAO)"
        placeholderTextColor={colors.textMuted}
        style={[
          styles.input,
          {
            color: colors.textPrimary,
            backgroundColor: colors.bgCard,
            borderColor: colors.border,
          },
        ]}
      />

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {trimmed.length >= 2 ? (
          loading ? (
            <LoadingBlock message="Hisseler aranıyor…" />
          ) : error ? (
            <ErrorCard title="Arama yapılamadı" message={error} />
          ) : remoteResults.length === 0 ? (
            <EmptyCard
              title="Eşleşen hisse bulunamadı"
              message={`"${trimmed}" için BIST şirketi bulunamadı.`}
            />
          ) : (
            remoteResults.slice(0, 20).map((item) => {
              const code = normalizeTicker(item.symbol ?? item.ticker ?? "");
              if (!code) return null;
              return (
                <TouchableOpacity
                  key={code}
                  style={[styles.row, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
                  onPress={() => openTicker(code)}
                  accessibilityRole="button"
                >
                  <Text style={{ color: colors.textPrimary, fontSize: FontSize.md, fontWeight: "700" }}>
                    {code}
                  </Text>
                  {item.name || item.description ? (
                    <Text style={{ color: colors.textMuted, fontSize: FontSize.xs }} numberOfLines={1}>
                      {item.name ?? item.description}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })
          )
        ) : (
          filteredPopular.map((ticker) => (
            <TouchableOpacity
              key={ticker}
              style={[styles.row, { backgroundColor: colors.bgCard, borderColor: colors.border }]}
              onPress={() => openTicker(ticker)}
              accessibilityRole="button"
            >
              <Text style={{ color: colors.textPrimary, fontSize: FontSize.md, fontWeight: "600" }}>
                {ticker}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.lg, gap: Spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: FontSize.xl, fontWeight: "700" },
  input: {
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: FontSize.md,
  },
  list: { gap: Spacing.sm, paddingBottom: Spacing.lg },
  row: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
});
