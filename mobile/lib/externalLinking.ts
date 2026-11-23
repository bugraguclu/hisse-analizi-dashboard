/**
 * Validated URL parser shared between custom-scheme deep links (`hisseanalizi://...`),
 * Universal Links (`https://hisseanalizi.com/...`), and local notification taps.
 *
 * Adapted from TusAnkiM's `externalLinking.ts`: enforces strict length, character, ticker,
 * and route bounds and returns structured rejection reasons instead of silently ignoring
 * malformed links.
 */

export type StockSection = "hisse" | "teknik" | "temel" | "analiz";

export type AppDeepLinkAction =
  | { kind: "markets" }
  | { kind: "companion"; server?: string; code?: string; eventId?: string }
  | { kind: "watchlists"; listId?: string }
  | { kind: "stock"; ticker: string; section: StockSection; fromNotification?: boolean }
  | { kind: "tarama"; preset?: string; sector?: string; index?: string; q?: string }
  | { kind: "events"; ticker?: string; severity?: string; category?: string; fromNotification?: boolean }
  | { kind: "makro"; piyasa?: string }
  | { kind: "search"; query?: string };

export type ExternalLinkRejection =
  | { reason: "tooLong" }
  | { reason: "invalidUrl" }
  | { reason: "unsupportedOrigin"; origin: string }
  | { reason: "unknownRoute"; path: string }
  | { reason: "invalidTicker"; ticker: string };

export type ExternalLinkReading =
  | { action: AppDeepLinkAction; source: "notification" | "external" }
  | { rejected: ExternalLinkRejection };

export const APP_SCHEME = "hisseanalizi";
const MAX_URL_LENGTH = 4096;
const TICKER_RE = /^[A-Z0-9]{2,10}$/;
const STOCK_SECTIONS = new Set<StockSection>(["hisse", "teknik", "temel", "analiz"]);
const ALLOWED_WEB_HOSTS = new Set(["hisse-analizi.duckdns.org", "hisseanalizi.com", "www.hisseanalizi.com"]);

function cleanValue(value: string | null, maxLength: number): string {
  return (value ?? "").normalize("NFC").trim().slice(0, maxLength);
}

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

/**
 * Normalizes a BIST ticker using ASCII uppercasing so Turkish dotted/dotless `i`
 * never turns `sise` into `SİSE`.
 */
export function normalizeTicker(raw: string): string | null {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const candidate = decoded.trim().toUpperCase();
  return TICKER_RE.test(candidate) ? candidate : null;
}

/** True when `rawUrl` targets this app via custom scheme or an allowed Universal Link host. */
export function isAppUrl(rawUrl: string): boolean {
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH || hasControlChars(rawUrl)) return false;
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) return false;
    const protocol = url.protocol.toLowerCase();
    if (protocol === `${APP_SCHEME}:`) return true;
    if (protocol === "https:" && ALLOWED_WEB_HOSTS.has(url.hostname.toLowerCase())) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Parses and validates an incoming deep link or Universal Link.
 * Returns `null` only for empty strings or unrelated third-party URLs; malformed app URLs
 * return `{ rejected }` so the UI can explain why the link could not be opened.
 */
export function readExternalAppUrl(rawUrl: string): ExternalLinkReading | null {
  if (!rawUrl) return null;
  const looksLikeAppScheme = rawUrl.toLowerCase().startsWith(`${APP_SCHEME}://`);
  if (rawUrl.length > MAX_URL_LENGTH) {
    return looksLikeAppScheme ? { rejected: { reason: "tooLong" } } : null;
  }
  if (hasControlChars(rawUrl)) {
    return looksLikeAppScheme ? { rejected: { reason: "invalidUrl" } } : null;
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return looksLikeAppScheme ? { rejected: { reason: "invalidUrl" } } : null;
  }

  const protocol = url.protocol.toLowerCase();
  if (url.username || url.password) {
    return looksLikeAppScheme ? { rejected: { reason: "invalidUrl" } } : null;
  }

  let segments: string[];
  if (protocol === `${APP_SCHEME}:`) {
    const host = url.hostname.toLowerCase();
    const pathParts = url.pathname.split("/").filter(Boolean);
    segments = host ? [host, ...pathParts] : pathParts;
  } else if (protocol === "https:" && ALLOWED_WEB_HOSTS.has(url.hostname.toLowerCase())) {
    segments = url.pathname.split("/").filter(Boolean);
  } else if (looksLikeAppScheme) {
    return { rejected: { reason: "unsupportedOrigin", origin: url.origin } };
  } else {
    return null;
  }

  const fromNotification =
    url.searchParams.get("source") === "notification" || url.searchParams.get("from") === "reminder";
  const source = fromNotification ? "notification" : "external";

  if (segments.length === 0 || ["market", "markets", "home", "dashboard", "piyasa", "pano"].includes(segments[0])) {
    return { action: { kind: "markets" }, source };
  }

  const head = segments[0].toLowerCase();

  if (head === "pair" || head === "companion") {
    const rawServer = url.searchParams.get("server");
    const code = url.searchParams.get("code")?.replace(/-/g, "").toUpperCase();
    if (code && !/^[A-Z0-9]{8}$/.test(code)) return { rejected: { reason: "invalidUrl" } };
    if (rawServer) {
      try {
        const server = new URL(rawServer);
        if (server.protocol !== "https:" || server.username || server.password || server.search || server.hash) throw new Error();
      } catch { return { rejected: { reason: "invalidUrl" } }; }
    }
    return { action: { kind: "companion", server: rawServer ?? undefined, code }, source };
  }

  if (head === "watchlist" || head === "watchlists" || head === "takip") {
    const listId = cleanValue(segments[1] ?? url.searchParams.get("id"), 64) || undefined;
    if (listId && listId !== "default") return { action: { kind: "companion" }, source };
    return { action: { kind: "watchlists", listId }, source };
  }

  if (STOCK_SECTIONS.has(head as StockSection) || head === "stock") {
    const section: StockSection = head === "stock" ? "hisse" : (head as StockSection);
    const rawTicker = segments[1] ?? url.searchParams.get("ticker") ?? "";
    const ticker = normalizeTicker(rawTicker);
    if (!ticker) {
      return { rejected: { reason: "invalidTicker", ticker: cleanValue(rawTicker, 40) } };
    }
    return { action: { kind: "stock", ticker, section, fromNotification }, source };
  }

  if (head === "tarama" || head === "screener") {
    return {
      action: {
        kind: "tarama",
        preset: cleanValue(url.searchParams.get("preset") ?? url.searchParams.get("tarama"), 64) || undefined,
        sector: cleanValue(url.searchParams.get("sector") ?? url.searchParams.get("sektor"), 80) || undefined,
        index: cleanValue(url.searchParams.get("index") ?? url.searchParams.get("endeks"), 24) || undefined,
        q: cleanValue(url.searchParams.get("q"), 40) || undefined,
      },
      source,
    };
  }

  if (head === "event" || head === "olay") return { action: { kind: "companion", eventId: cleanValue(segments[1], 160) }, source };

  if (head === "events" || head === "kap" || head === "takvim") {
    const rawTicker = url.searchParams.get("ticker") ?? url.searchParams.get("hisse");
    const ticker = rawTicker ? normalizeTicker(rawTicker) : null;
    if (rawTicker && !ticker) {
      return { rejected: { reason: "invalidTicker", ticker: cleanValue(rawTicker, 40) } };
    }
    return {
      action: {
        kind: "events",
        ticker: ticker ?? undefined,
        severity: cleanValue(url.searchParams.get("severity"), 24) || undefined,
        category: cleanValue(url.searchParams.get("category"), 32) || undefined,
        fromNotification,
      },
      source,
    };
  }

  if (head === "makro" || head === "macro") {
    if (url.searchParams.get("event")) return { action: { kind: "companion", eventId: cleanValue(url.searchParams.get("event"), 160) }, source };
    return {
      action: {
        kind: "makro",
        piyasa: cleanValue(url.searchParams.get("piyasa") ?? url.searchParams.get("market"), 32) || undefined,
      },
      source,
    };
  }

  if (head === "search" || head === "ara") {
    return {
      action: {
        kind: "search",
        query: cleanValue(url.searchParams.get("q") ?? url.searchParams.get("query"), 64) || undefined,
      },
      source,
    };
  }

  return { rejected: { reason: "unknownRoute", path: `/${segments.join("/")}`.slice(0, 120) } };
}

export interface ResolvedRoute {
  pathname: string;
  params: Record<string, string>;
  /** True for tab root screens where dismissing back to the tab is preferred over stacking. */
  isTabRoot: boolean;
  /** True when opened from a notification so the stack ensures a tab home underneath. */
  ensureHomeUnderneath: boolean;
}

/** Maps a validated `AppDeepLinkAction` into an Expo Router href + stack behavior. */
export function routeForAction(action: AppDeepLinkAction): ResolvedRoute {
  switch (action.kind) {
    case "companion":
      return { pathname: "/companion", params: { ...(action.server ? { server: action.server } : {}), ...(action.code ? { code: action.code } : {}), ...(action.eventId ? { eventId: action.eventId } : {}) }, isTabRoot: false, ensureHomeUnderneath: false };
    case "markets":
      return { pathname: "/(tabs)/markets", params: {}, isTabRoot: true, ensureHomeUnderneath: false };
    case "watchlists":
      return {
        pathname: "/(tabs)/watchlists",
        params: action.listId ? { listId: action.listId } : {},
        isTabRoot: true,
        ensureHomeUnderneath: false,
      };
    case "tarama": {
      const params: Record<string, string> = {};
      if (action.preset) params.preset = action.preset;
      if (action.sector) params.sector = action.sector;
      if (action.index) params.index = action.index;
      if (action.q) params.q = action.q;
      return { pathname: "/(tabs)/tarama", params, isTabRoot: true, ensureHomeUnderneath: false };
    }
    case "events": {
      const params: Record<string, string> = {};
      if (action.ticker) params.ticker = action.ticker;
      if (action.severity) params.severity = action.severity;
      if (action.category) params.category = action.category;
      return {
        pathname: "/(tabs)/events",
        params,
        isTabRoot: true,
        ensureHomeUnderneath: Boolean(action.fromNotification),
      };
    }
    case "stock":
      return {
        pathname: `/stock/${action.ticker}`,
        params: { section: action.section },
        isTabRoot: false,
        ensureHomeUnderneath: Boolean(action.fromNotification),
      };
    case "makro":
      return {
        pathname: "/makro",
        params: action.piyasa ? { piyasa: action.piyasa } : {},
        isTabRoot: false,
        ensureHomeUnderneath: false,
      };
    case "search":
      return {
        pathname: "/search",
        params: action.query ? { q: action.query } : {},
        isTabRoot: false,
        ensureHomeUnderneath: false,
      };
  }
}

export function describeLinkRejection(rejection: ExternalLinkRejection): { title: string; message: string } {
  switch (rejection.reason) {
    case "tooLong":
      return { title: "Bağlantı açılamadı", message: "Gelen bağlantı adresi izin verilen uzunluğu aşıyor." };
    case "invalidTicker":
      return {
        title: "Geçersiz hisse kodu",
        message: rejection.ticker
          ? `"${rejection.ticker}" geçerli bir BIST hisse kodu değil.`
          : "Bağlantıda hisse kodu eksik.",
      };
    case "unknownRoute":
      return {
        title: "Ekran bulunamadı",
        message: `"${rejection.path}" adresi bu uygulamada desteklenmiyor.`,
      };
    default:
      return { title: "Bağlantı açılamadı", message: "Bağlantı biçimi geçersiz veya desteklenmiyor." };
  }
}
