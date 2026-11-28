"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { ArrowUp, ExternalLink, Hourglass, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { useShell } from "@/components/layout/shell-context";
import { tickerFromPath } from "@/components/layout/nav";
import { buttonVariants } from "@/components/ui/button";
import { useOnlineStatus } from "@/hooks/use-network-status";
import { useWatchlists } from "@/hooks/use-watchlists";
import type { TranslationKey } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import { AssistantRequestError, askAssistant, useAssistantStatus } from "./client";
import {
  MAX_QUESTION_CHARS,
  buildAskBody,
  parseAnswer,
  suggestedQuestions,
  type AnswerBlock,
  type AssistantEvent,
  type Citation,
  type HistoryTurn,
  type InlineToken,
} from "./model";

type TurnState = "streaming" | "done" | "refused" | "error" | "stopped";

interface Turn {
  id: number;
  question: string;
  answer: string;
  state: TurnState;
  tool: string | null;
  citations: Citation[];
  disclaimer: string;
  error: string | null;
}

const TOOL_KEYS: Record<string, TranslationKey> = {
  methodology: "assistant.tool.methodology",
  quote: "assistant.tool.quote",
  ratios: "assistant.tool.ratios",
  statements: "assistant.tool.statements",
  scorecard: "assistant.tool.scorecard",
  technical: "assistant.tool.technical",
  kap: "assistant.tool.kap",
  news: "assistant.tool.news",
  macro: "assistant.tool.macro",
  calendar: "assistant.tool.calendar",
};

const KIND_KEYS: Record<Citation["kind"], TranslationKey> = {
  page: "assistant.kind.page",
  kap: "assistant.kind.kap",
  methodology: "assistant.kind.methodology",
  news: "assistant.kind.news",
  external: "assistant.kind.external",
};

const ICON_BUTTON = cn(buttonVariants({ variant: "ghost", size: "md" }), "w-8 px-0");
const isInternal = (url: string) => url.startsWith("/");

function SourceLink({
  citation,
  className,
  children,
  label,
  onNavigate,
}: {
  citation: Citation;
  className?: string;
  children: ReactNode;
  label?: string;
  onNavigate: () => void;
}) {
  const { t } = useLocale();
  if (isInternal(citation.url)) {
    return (
      <Link href={citation.url} className={className} aria-label={label} onClick={onNavigate}>
        {children}
      </Link>
    );
  }
  return (
    <a
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      aria-label={label ? `${label} ${t("assistant.opensNewTab")}` : undefined}
    >
      {children}
    </a>
  );
}

function Inline({
  tokens,
  byId,
  onNavigate,
}: {
  tokens: InlineToken[];
  byId: ReadonlyMap<number, Citation>;
  onNavigate: () => void;
}) {
  const { t } = useLocale();
  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === "text") return <span key={index}>{token.text}</span>;
        if (token.type === "strong") return <strong key={index} className="font-semibold text-foreground">{token.text}</strong>;
        const citation = byId.get(token.id);
        const chip = "ml-0.5 inline-flex h-4 min-w-4 -translate-y-1 items-center justify-center rounded-sm border border-border bg-muted px-1 font-mono text-[10px] font-semibold leading-none text-foreground no-underline";
        if (!citation) {
          return (
            <span key={index} className={chip} aria-hidden="true">
              {token.id}
            </span>
          );
        }
        return (
          <SourceLink
            key={index}
            citation={citation}
            onNavigate={onNavigate}
            label={t("assistant.sourceLabel", { n: token.id, title: citation.title })}
            className={cn(chip, "hover:border-foreground/40 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring")}
          >
            {token.id}
          </SourceLink>
        );
      })}
    </>
  );
}

function AnswerBody({ blocks, byId, onNavigate }: { blocks: AnswerBlock[]; byId: ReadonlyMap<number, Citation>; onNavigate: () => void }) {
  return (
    <div className="space-y-2.5 text-[13px] leading-relaxed text-foreground">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return (
            <p key={index} className="pt-1 text-[13px] font-semibold">
              <Inline tokens={block.tokens} byId={byId} onNavigate={onNavigate} />
            </p>
          );
        }
        if (block.type === "list") {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
              {block.items.map((item, i) => (
                <li key={i}>
                  <Inline tokens={item} byId={byId} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            <Inline tokens={block.tokens} byId={byId} onNavigate={onNavigate} />
          </p>
        );
      })}
    </div>
  );
}

function Sources({ citations, onNavigate }: { citations: Citation[]; onNavigate: () => void }) {
  const { t } = useLocale();
  const byNumber = [...citations].sort((a, b) => a.id - b.id);
  const cited = byNumber.filter((c) => c.cited);
  const others = byNumber.filter((c) => !c.cited);
  if (citations.length === 0) return null;
  const row = (citation: Citation) => (
    <li key={citation.id} className="flex min-w-0 items-start gap-2">
      <span className="mt-px inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm border border-border bg-muted px-1 font-mono text-[10px] font-semibold">
        {citation.id}
      </span>
      <SourceLink
        citation={citation}
        onNavigate={onNavigate}
        className="group min-w-0 flex-1 text-xs text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="break-words">{citation.title}</span>
        {!isInternal(citation.url) ? (
          <ExternalLink aria-hidden="true" className="ml-1 inline h-3 w-3 align-[-1px] text-muted-foreground" />
        ) : null}
        {!isInternal(citation.url) ? <span className="sr-only"> {t("assistant.opensNewTab")}</span> : null}
      </SourceLink>
      <span className="shrink-0 rounded-sm border border-border px-1 py-px text-[10px] text-muted-foreground">{t(KIND_KEYS[citation.kind])}</span>
    </li>
  );
  return (
    <div className="mt-3 border-t border-border pt-2.5">
      {cited.length > 0 ? (
        <>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("assistant.sources")}</p>
          <ol className="space-y-1.5">{cited.map(row)}</ol>
        </>
      ) : null}
      {others.length > 0 ? (
        <details className={cn("group", cited.length > 0 && "mt-2")}>
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
            {cited.length > 0 ? t("assistant.moreSources", { count: others.length }) : t("assistant.consulted")}
          </summary>
          <ol className="mt-1.5 space-y-1.5">{others.map(row)}</ol>
        </details>
      ) : null}
    </div>
  );
}

function errorMessage(error: unknown, t: (key: TranslationKey, vars?: Record<string, string | number>) => string): string {
  if (error instanceof AssistantRequestError) {
    if (error.code === "rate_limited") {
      return error.retryAfter ? t("assistant.err.rateLimited", { seconds: error.retryAfter }) : t("assistant.err.rateLimitedShort");
    }
    if (error.code === "not_configured") return t("assistant.notConfigured");
    if (error.code === "network") return t("assistant.err.network");
    return error.detail ?? t("assistant.err.generic");
  }
  return t("assistant.err.generic");
}

/**
 * The AI explanation assistant: a modal sheet (right side on md+, full screen
 * below) opened from the header button or the site search. Answers stream in
 * and cite numbered sources (internal pages, KAP links, methodology pages).
 * The conversation lives for the browser session of this tab.
 */
export function AssistantPanel() {
  const { assistantOpen, closeAssistant, assistantSeed, clearAssistantSeed, assistantOpenerRef } = useShell();
  const { t, locale } = useLocale();
  const pathname = usePathname();
  const ticker = tickerFromPath(pathname);
  const { lists } = useWatchlists();
  const online = useOnlineStatus();
  const statusQ = useAssistantStatus();
  const disabled = statusQ.data?.enabled === false;

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputId = useId();
  const hintId = useId();

  const watchlist = useMemo(() => [...new Set(lists.flatMap((list) => list.tickers))], [lists]);
  const streaming = turns.some((turn) => turn.state === "streaming");
  const suggestions = useMemo(
    () => suggestedQuestions(pathname, ticker, locale, watchlist.length > 0),
    [pathname, ticker, locale, watchlist.length],
  );

  const update = useCallback((id: number, change: (turn: Turn) => Turn) => {
    setTurns((previous) => previous.map((turn) => (turn.id === id ? change(turn) : turn)));
  }, []);

  const ask = useCallback(
    (raw: string) => {
      const question = raw.trim().slice(0, MAX_QUESTION_CHARS);
      if (!question || abortRef.current) return;
      const id = nextId.current++;
      const history: HistoryTurn[] = turns
        .filter((turn) => turn.state === "done" && turn.answer)
        .flatMap((turn) => [
          { role: "user" as const, content: turn.question },
          { role: "assistant" as const, content: turn.answer },
        ]);
      const body = buildAskBody(question, { locale, page: pathname, ticker, watchlist }, history);
      setTurns((previous) => [
        ...previous,
        { id, question, answer: "", state: "streaming", tool: null, citations: [], disclaimer: "", error: null },
      ]);
      setInput("");
      setAnnouncement("");
      stickRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;
      const onEvent = (event: AssistantEvent) => {
        switch (event.type) {
          case "status":
            update(id, (turn) => ({ ...turn, tool: event.tool }));
            break;
          case "delta":
            update(id, (turn) => ({ ...turn, answer: turn.answer + event.text }));
            break;
          case "discard":
            update(id, (turn) => ({ ...turn, answer: "" }));
            break;
          case "done":
            update(id, (turn) => ({
              ...turn,
              state: event.refused ? "refused" : "done",
              tool: null,
              citations: event.citations,
              disclaimer: event.disclaimer,
            }));
            setAnnouncement(t("assistant.answerReady", { count: event.citations.filter((c) => c.cited).length }));
            break;
          case "error":
            update(id, (turn) => ({ ...turn, state: "error", tool: null, error: event.detail || t("assistant.err.generic") }));
            setAnnouncement(event.detail || t("assistant.err.generic"));
            break;
        }
      };
      askAssistant(body, { signal: controller.signal, onEvent })
        .then(() => {
          // A stream that ended without "done"/"error" (connection cut mid-answer).
          update(id, (turn) =>
            turn.state === "streaming" ? { ...turn, state: "error", tool: null, error: t("assistant.err.network") } : turn,
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            update(id, (turn) => (turn.state === "streaming" ? { ...turn, state: "stopped", tool: null } : turn));
            return;
          }
          const message = errorMessage(error, t);
          update(id, (turn) => ({ ...turn, state: "error", tool: null, error: message }));
          setAnnouncement(message);
        })
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null;
        });
    },
    [turns, locale, pathname, ticker, watchlist, update, t],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setInput("");
    setAnnouncement("");
    inputRef.current?.focus();
  }, []);

  // A question handed over by the site search ("Ask the assistant: …").
  useEffect(() => {
    if (!assistantOpen || !assistantSeed || abortRef.current || disabled) return;
    const { question } = assistantSeed;
    clearAssistantSeed();
    ask(question);
  }, [assistantOpen, assistantSeed, clearAssistantSeed, ask, disabled]);

  // Follow the streaming answer unless the reader scrolled up. Instant: repeated updates.
  useEffect(() => {
    const node = scrollRef.current;
    if (node && stickRef.current) node.scrollTop = node.scrollHeight;
  }, [turns]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function onScroll() {
    const node = scrollRef.current;
    if (!node) return;
    stickRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    ask(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      ask(input);
    }
  }

  function retry(turn: Turn) {
    setTurns((previous) => previous.filter((item) => item.id !== turn.id));
    ask(turn.question);
  }

  const finalFocus = useCallback(() => {
    const opener = assistantOpenerRef.current;
    return opener && opener.isConnected && opener !== document.body ? opener : true;
  }, [assistantOpenerRef]);

  const inputDisabled = disabled || !online;
  const notice = disabled ? t("assistant.notConfigured") : !online ? t("assistant.err.offline") : null;

  return (
    <Dialog.Root open={assistantOpen} onOpenChange={(next) => (next ? undefined : closeAssistant())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 motion-panel" />
        <Dialog.Popup
          initialFocus={inputRef}
          finalFocus={finalFocus}
          className={cn(
            "fixed inset-0 z-50 flex flex-col bg-card text-foreground outline-none",
            "motion-panel motion-panel-slide motion-panel-responsive",
            "md:inset-y-0 md:left-auto md:right-0 md:w-full md:max-w-[30rem] md:border-l md:border-border",
          )}
        >
          <div className="flex items-center gap-1 border-b border-border py-2 pl-4 pr-2">
            <Sparkles aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
            <Dialog.Title className="ml-1.5 flex-1 truncate text-sm font-semibold">{t("assistant.title")}</Dialog.Title>
            <span className="mr-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t("assistant.beta")}
            </span>
            {turns.length > 0 ? (
              <button type="button" onClick={reset} className={ICON_BUTTON} aria-label={t("assistant.newChat")} title={t("assistant.newChat")}>
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : null}
            <Dialog.Close className="close-icon-btn" aria-label={t("assistant.close")} title={`${t("assistant.close")} (Esc)`}>
              <X aria-hidden="true" className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 scrollbar-thin scrollbar-thin">
            {turns.length === 0 ? (
              <div className="space-y-4">
                <Dialog.Description className="text-[13px] leading-relaxed text-muted-foreground">{t("assistant.intro")}</Dialog.Description>
                {notice ? (
                  <p role="status" className="rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-foreground">
                    {notice}{" "}
                    {disabled ? (
                      <Link href="/rehber" onClick={closeAssistant} className="font-medium underline underline-offset-4">
                        {t("nav.guide")}
                      </Link>
                    ) : null}
                  </p>
                ) : (
                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("assistant.suggestions")}</p>
                    <ul className="space-y-1.5">
                      {suggestions.map((question) => (
                        <li key={question}>
                          <button
                            type="button"
                            onClick={() => ask(question)}
                            className="motion-press w-full rounded-md border border-border bg-background px-3 py-2 text-left text-[13px] text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            {question}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <ol className="space-y-5" aria-label={t("assistant.title")}>
                {turns.map((turn) => {
                  const byId = new Map(turn.citations.map((c) => [c.id, c]));
                  const known = turn.state === "streaming" ? undefined : new Set(byId.keys());
                  const blocks = parseAnswer(turn.answer, known);
                  return (
                    <li key={turn.id} className="space-y-2">
                      <div className="ml-auto w-fit max-w-[85%] rounded-lg bg-muted px-3 py-2 text-[13px] text-foreground">
                        <span className="sr-only">{t("assistant.you")}: </span>
                        {turn.question}
                      </div>
                      <div aria-busy={turn.state === "streaming"}>
                        <span className="sr-only">{t("assistant.answer")}: </span>
                        {turn.state === "streaming" && !turn.answer ? (
                          <p className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Hourglass aria-hidden="true" className="h-3.5 w-3.5 skeleton-pulse" />
                            {turn.tool ? t(TOOL_KEYS[turn.tool] ?? "assistant.tool.data") : t("assistant.thinking")}
                          </p>
                        ) : null}
                        {blocks.length > 0 ? (
                          <AnswerBody blocks={blocks} byId={byId} onNavigate={closeAssistant} />
                        ) : null}
                        {turn.state === "stopped" ? <p className="mt-1 text-xs text-muted-foreground">{t("assistant.stopped")}</p> : null}
                        {turn.state === "error" ? (
                          <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-down/30 bg-down/5 px-3 py-2 text-xs text-foreground">
                            <span className="flex-1">{turn.error}</span>
                            <button type="button" onClick={() => retry(turn)} disabled={streaming} className={buttonVariants({ variant: "outline", size: "sm" })}>
                              <RotateCcw aria-hidden="true" />
                              {t("assistant.retry")}
                            </button>
                          </div>
                        ) : null}
                        {turn.state === "done" || turn.state === "refused" ? (
                          <>
                            <Sources citations={turn.citations} onNavigate={closeAssistant} />
                            {turn.disclaimer ? <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{turn.disclaimer}</p> : null}
                          </>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="sr-only" role="status" aria-live="polite">
              {announcement}
            </p>
          </div>

          <form onSubmit={submit} className="border-t border-border px-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-3">
            {notice && turns.length > 0 ? <p className="mb-2 text-xs text-muted-foreground">{notice}</p> : null}
            <label htmlFor={inputId} className="sr-only">
              {t("assistant.inputLabel")}
            </label>
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                id={inputId}
                value={input}
                onChange={(event) => setInput(event.target.value.slice(0, MAX_QUESTION_CHARS))}
                onKeyDown={onKeyDown}
                rows={2}
                maxLength={MAX_QUESTION_CHARS}
                disabled={inputDisabled}
                placeholder={t("assistant.placeholder")}
                aria-describedby={hintId}
                enterKeyHint="send"
                className="max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-ring disabled:opacity-50 md:text-[13px]"
              />
              {streaming ? (
                <button type="button" onClick={stop} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-9 px-0")} aria-label={t("assistant.stop")} title={t("assistant.stop")}>
                  <Square aria-hidden="true" className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={inputDisabled || !input.trim()}
                  className={cn(buttonVariants({ variant: "default", size: "lg" }), "w-9 px-0")}
                  aria-label={t("assistant.send")}
                  title={t("assistant.send")}
                >
                  <ArrowUp aria-hidden="true" className="h-4 w-4" />
                </button>
              )}
            </div>
            <p id={hintId} className="mt-1.5 flex justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="hidden md:inline">{t("assistant.inputHint")}</span>
              <span className="ml-auto font-mono tabular-nums">
                {t("assistant.charCount", { count: input.length, max: MAX_QUESTION_CHARS })}
              </span>
            </p>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
