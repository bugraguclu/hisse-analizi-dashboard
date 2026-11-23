/**
 * Assistant client model (pure, unit-tested): the SSE wire format of
 * `POST /assistant/ask`, the answer's light markup with `[n]` citation markers,
 * and page-aware suggested questions.
 */
import type { Locale } from "@/lib/i18n";

export type CitationKind = "page" | "kap" | "methodology" | "news" | "external";

export interface Citation {
  id: number;
  title: string;
  url: string;
  kind: CitationKind;
  cited: boolean;
}

export type AssistantEvent =
  | { type: "meta"; model: string }
  | { type: "status"; tool: string }
  | { type: "delta"; text: string }
  | { type: "discard" }
  | { type: "done"; citations: Citation[]; disclaimer: string; refused: boolean }
  | { type: "error"; code: string; detail: string };

export const MAX_QUESTION_CHARS = 500;
export const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 2000;
const MAX_WATCHLIST = 40;
const TICKER_RE = /^[A-Z0-9]{2,10}$/;

// ---------------------------------------------------------------------------
// SSE parsing
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toCitation(raw: unknown): Citation | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "number" && Number.isInteger(item.id) ? item.id : null;
  const url = asString(item.url);
  // Same-origin paths or https links only (never javascript:, data:, //host).
  const safe = /^\/(?![/\\])/.test(url) || /^https:\/\/[^\s/\\]/.test(url);
  if (id === null || !safe) return null;
  const kind = asString(item.kind) as CitationKind;
  return {
    id,
    url,
    title: asString(item.title) || url,
    kind: ["page", "kap", "methodology", "news", "external"].includes(kind) ? kind : "external",
    cited: item.cited === true,
  };
}

/** One SSE message (`event:` + `data:` lines) → a typed event; unknown ones → null. */
export function toAssistantEvent(event: string, data: string): AssistantEvent | null {
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (event) {
    case "meta":
      return { type: "meta", model: asString(payload.model) };
    case "status":
      return { type: "status", tool: asString(payload.tool) || "data" };
    case "delta":
      return { type: "delta", text: asString(payload.text) };
    case "discard":
      return { type: "discard" };
    case "done": {
      const citations = Array.isArray(payload.citations)
        ? payload.citations.map(toCitation).filter((c): c is Citation => c !== null)
        : [];
      return { type: "done", citations, disclaimer: asString(payload.disclaimer), refused: payload.refused === true };
    }
    case "error":
      return { type: "error", code: asString(payload.code) || "internal", detail: asString(payload.detail) };
    default:
      return null;
  }
}

/**
 * Incremental SSE parser: feed decoded text chunks (any split), get events back.
 * Comment lines (`: ping`) are heartbeats and ignored.
 */
export function createSseParser(onEvent: (event: AssistantEvent) => void) {
  let buffer = "";
  function flushBlock(block: string) {
    let name = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") name = value;
      else if (field === "data") data.push(value);
    }
    if (data.length === 0) return;
    const event = toAssistantEvent(name, data.join("\n"));
    if (event) onEvent(event);
  }
  return {
    feed(chunk: string) {
      buffer += chunk.replace(/\r\n?/g, "\n");
      let index = buffer.indexOf("\n\n");
      while (index !== -1) {
        flushBlock(buffer.slice(0, index));
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
      }
    },
    end() {
      if (buffer.trim()) flushBlock(buffer);
      buffer = "";
    },
  };
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AskContext {
  locale: Locale;
  page: string;
  ticker: string | null;
  watchlist: readonly string[];
}

export function buildAskBody(question: string, context: AskContext, history: readonly HistoryTurn[]) {
  const watchlist: string[] = [];
  for (const raw of context.watchlist) {
    const ticker = raw.trim().toUpperCase();
    if (TICKER_RE.test(ticker) && !watchlist.includes(ticker)) watchlist.push(ticker);
    if (watchlist.length >= MAX_WATCHLIST) break;
  }
  return {
    question: question.trim().slice(0, MAX_QUESTION_CHARS),
    locale: context.locale,
    page: context.page.slice(0, 200),
    ticker: context.ticker,
    watchlist,
    history: history
      .slice(-MAX_HISTORY_TURNS * 2)
      .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_HISTORY_CHARS) }))
      .filter((turn) => turn.content.trim()),
  };
}

// ---------------------------------------------------------------------------
// Answer text → blocks (paragraphs, bullet lists) of inline tokens
// ---------------------------------------------------------------------------

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "cite"; id: number };

export type AnswerBlock =
  | { type: "paragraph"; tokens: InlineToken[] }
  | { type: "list"; items: InlineToken[][] }
  | { type: "heading"; tokens: InlineToken[] };

const MARKER_RE = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g;

/** `**bold**` and `[n]` / `[1, 2]` markers; markers with unknown ids stay plain text. */
export function parseInline(text: string, knownIds?: ReadonlySet<number>): InlineToken[] {
  const tokens: InlineToken[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = tokens.at(-1);
    if (last?.type === "text") last.text += value;
    else tokens.push({ type: "text", text: value });
  };
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      tokens.push({ type: "strong", text: part.slice(2, -2) });
      continue;
    }
    let last = 0;
    for (const match of part.matchAll(MARKER_RE)) {
      const ids = match[1].split(",").map((s) => Number(s.trim()));
      const known = knownIds ? ids.every((id) => knownIds.has(id)) : true;
      if (!known) continue;
      pushText(part.slice(last, match.index).replace(/\s+$/, (ws) => (ws.includes("\n") ? ws : "")));
      for (const id of ids) tokens.push({ type: "cite", id });
      last = (match.index ?? 0) + match[0].length;
    }
    pushText(part.slice(last));
  }
  return tokens;
}

/** Paragraphs, `- ` / `* ` / `1. ` lists and `#` headings; everything else is plain text. */
export function parseAnswer(text: string, knownIds?: ReadonlySet<number>): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let paragraph: string[] = [];
  let list: InlineToken[][] | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", tokens: parseInline(paragraph.join(" "), knownIds) });
    paragraph = [];
  };
  const flushList = () => {
    if (list?.length) blocks.push({ type: "list", items: list });
    list = null;
  };
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = /^(?:[-*•]|\d{1,2}[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      list ??= [];
      list.push(parseInline(bullet[1], knownIds));
      continue;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", tokens: parseInline(heading[1], knownIds) });
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

// ---------------------------------------------------------------------------
// Suggested questions for the current page
// ---------------------------------------------------------------------------

type Localized = Record<Locale, string>;

const ASK: Record<string, Localized> = {
  ratio: {
    tr: "{t} için F/K ve FD/FAVÖK nasıl hesaplandı?",
    en: "How were {t}'s P/E and EV/EBITDA calculated?",
    fr: "Comment le PER et la VE/EBITDA de {t} sont-ils calculés ?",
  },
  balance: {
    tr: "{t} için son bilanço ne söylüyor?",
    en: "What does {t}'s latest balance sheet say?",
    fr: "Que dit le dernier bilan de {t} ?",
  },
  score: {
    tr: "{t} analiz karnesi puanı neden bu?",
    en: "Why does {t} get this scorecard rating?",
    fr: "Pourquoi le bulletin de {t} a-t-il cette note ?",
  },
  kapTicker: {
    tr: "{t} için son KAP bildirimleri neler?",
    en: "What are {t}'s latest KAP disclosures?",
    fr: "Quelles sont les dernières publications KAP de {t} ?",
  },
  technical: {
    tr: "{t} teknik özeti hangi göstergelere dayanıyor?",
    en: "Which indicators drive {t}'s technical summary?",
    fr: "Sur quels indicateurs repose le résumé technique de {t} ?",
  },
  watchlistKap: {
    tr: "Takip listemde bugün hangi KAP'lar var?",
    en: "Which KAP disclosures are there for my watchlist today?",
    fr: "Quelles publications KAP pour ma liste de suivi aujourd'hui ?",
  },
  macro: {
    tr: "Politika faizi ve son enflasyon verisi ne?",
    en: "What are the policy rate and the latest inflation figure?",
    fr: "Quels sont le taux directeur et la dernière inflation ?",
  },
  calendar: {
    tr: "Bu hafta ekonomik takvimde önemli neler var?",
    en: "What's important on the economic calendar this week?",
    fr: "Qu'y a-t-il d'important au calendrier économique cette semaine ?",
  },
  ttm: {
    tr: "TTM nedir, oranlarda nasıl kullanılıyor?",
    en: "What is TTM and how is it used in the ratios?",
    fr: "Qu'est-ce que le TTM et comment est-il utilisé ?",
  },
  scorecard: {
    tr: "Analiz karnesi nasıl hesaplanıyor?",
    en: "How is the stock scorecard calculated?",
    fr: "Comment le bulletin de l'action est-il calculé ?",
  },
};

const TICKER_SECTIONS = new Set(["hisse", "teknik", "temel", "analiz"]);

/** Up to four questions that fit the open page. */
export function suggestedQuestions(pathname: string, ticker: string | null, locale: Locale, hasWatchlist: boolean): string[] {
  const section = pathname.split("/")[1] ?? "";
  const fill = (key: string) => ASK[key][locale].replace("{t}", ticker ?? "THYAO");
  let keys: string[];
  if (ticker && TICKER_SECTIONS.has(section)) {
    keys =
      section === "teknik"
        ? ["technical", "kapTicker", "ratio", "score"]
        : section === "temel"
          ? ["ratio", "balance", "score", "kapTicker"]
          : ["ratio", "balance", "kapTicker", "score"];
  } else if (section === "makro") {
    keys = ["macro", "calendar", "watchlistKap", "ttm"];
  } else if (section === "events") {
    keys = ["watchlistKap", "kapTicker", "macro", "scorecard"];
  } else if (section === "atlas" || section === "rehber") {
    keys = ["ttm", "scorecard", "ratio", "watchlistKap"];
  } else {
    keys = ["watchlistKap", "macro", "ratio", "scorecard"];
  }
  if (!hasWatchlist) keys = keys.filter((key) => key !== "watchlistKap");
  return keys.slice(0, 4).map(fill);
}
