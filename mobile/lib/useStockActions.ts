import { useCallback } from "react";
import { useRouter } from "expo-router";
import { ActionSheetIOS, Platform, Share } from "react-native";
import { haptic } from "../components/ui";
import { useAppContext } from "../contexts/AppContext";
import { formatPrice, formatSignedPercent } from "./format";
import { useIsDarkTheme } from "./theme";

export interface StockActionInfo {
  name?: string | null;
  price?: number | null;
  changePct?: number | null;
}

/**
 * Long-press quick actions for any stock row: open, add/remove from the
 * watchlist, see its KAP filings, share. Uses the native iOS action sheet.
 */
export function useStockActions() {
  const router = useRouter();
  const isDark = useIsDarkTheme();
  const { watchlists, addTickerToWatchlist, removeTickerFromWatchlist } = useAppContext();
  const list = watchlists[0];

  return useCallback(
    (ticker: string, info: StockActionInfo = {}) => {
      if (Platform.OS !== "ios") {
        router.push(`/stock/${ticker}` as never);
        return;
      }
      haptic.medium();
      const inList = Boolean(list?.tickers.includes(ticker));
      const options = [
        "Analizi aç",
        inList ? "Takip listesinden çıkar" : "Takip listesine ekle",
        "KAP bildirimleri",
        "Paylaş",
        "Vazgeç",
      ];
      const priceLine =
        info.price != null ? `${formatPrice(info.price)} · ${formatSignedPercent(info.changePct)}` : undefined;
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: info.name ? `${ticker} · ${info.name}` : ticker,
          message: priceLine,
          options,
          cancelButtonIndex: 4,
          destructiveButtonIndex: inList ? 1 : undefined,
          userInterfaceStyle: isDark ? "dark" : "light",
        },
        (index) => {
          if (index === 0) router.push(`/stock/${ticker}` as never);
          if (index === 1) {
            if (inList) {
              removeTickerFromWatchlist(ticker, list?.id);
              haptic.warning();
            } else {
              addTickerToWatchlist(ticker, list?.id);
              haptic.success();
            }
          }
          if (index === 2) router.push({ pathname: "/(tabs)/events", params: { ticker } } as never);
          if (index === 3) {
            const parts = [ticker, info.name, priceLine].filter(Boolean).join(" · ");
            void Share.share({ message: parts }).catch(() => undefined);
          }
        },
      );
    },
    [addTickerToWatchlist, isDark, list, removeTickerFromWatchlist, router],
  );
}
