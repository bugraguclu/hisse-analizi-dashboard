"use client";

/**
 * Filter bar — the belif.tr catalogue filter bar (Pureko/Website,
 * src/components/CatalogFilters.astro) ported to React with its mechanisms:
 *
 * - One bar between two hairlines: an optional open facet (label + chips) on
 *   the left, dropdown menus on the right (FİLTRELE, SIRALA, …). Below the
 *   `stackBelow` breakpoint the facet takes its own row and the menus share
 *   the row under it; on phones the chip row scrolls edge to edge.
 * - A menu's summary names what is picked — one name, or "N seçili" — so a
 *   filtered link reads without opening anything. There is no separate strip
 *   of "active filter" chips: the summary and the panel are the only places a
 *   choice is shown and removed.
 * - One menu open at a time. A click outside or Escape closes it (Escape and
 *   the panel's own buttons hand focus back to the summary); while a panel is
 *   open, the first tap on a link or button outside the bar only closes it.
 * - Groups panel (FİLTRELE): head with ✕, one scrolling body of collapsible
 *   groups (sticky headers, per-group selection count, "select all" with an
 *   indeterminate state, options dimmed — never hidden — when they would
 *   return nothing, the count each option would return), in a two-axis panel
 *   the second axis folded under its header until the body is first scrolled,
 *   and a foot with the panel's own Clear and a "show N results" button.
 * - Choice lists (SIRALA) close on a pointer pick but not while the keyboard
 *   arrows through them.
 * - An option may carry a description line under its label (the rule a preset
 *   applies, say), and a checkbox option that replaces its alternatives gets a
 *   round mark instead of a box. A panel with many groups can lay them out in
 *   columns on wide screens (`columns`), so the whole menu reads at a glance.
 * - An opening panel scrolls the page just enough to fit below the site
 *   header; keyboard focus keeps the focused row in view; on first open the
 *   first picked option is brought into view; the chip row starts at the
 *   picked chip when it overflows.
 *
 * Colours and corners follow this site's tokens (ink for filled marks,
 * `primary` for the accent text belif sets in cyan).
 *
 * Panels are absolutely positioned under the bar: an `overflow-hidden` (or
 * `overflow-auto`) ancestor clips them — leave the bar's containers visible.
 */

import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Check, Loader2, X } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { formatNumber } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const TEXT = {
  tr: {
    filter: "Filtrele",
    sort: "Sırala",
    clear: "Temizle",
    selectAll: "Tümünü seç",
    selected: (count: number) => `${count} seçili`,
    closePanel: "Filtre panelini kapat",
    clearPanel: "Bu paneldeki seçimleri temizle",
    clearFacet: (label: string) => `${label} seçimini temizle`,
    noResults: "Sonuç yok",
    loading: "Yükleniyor",
  },
  en: {
    filter: "Filter",
    sort: "Sort",
    clear: "Clear",
    selectAll: "Select all",
    selected: (count: number) => `${count} selected`,
    closePanel: "Close the filter panel",
    clearPanel: "Clear the selections in this panel",
    clearFacet: (label: string) => `Clear the ${label.toLocaleLowerCase("en")} selection`,
    noResults: "No results",
    loading: "Loading",
  },
  fr: {
    filter: "Filtrer",
    sort: "Trier",
    clear: "Effacer",
    selectAll: "Tout sélectionner",
    selected: (count: number) => `${count} sélectionnés`,
    closePanel: "Fermer le panneau de filtres",
    clearPanel: "Effacer les sélections de ce panneau",
    clearFacet: (label: string) => `Effacer la sélection « ${label} »`,
    noResults: "Aucun résultat",
    loading: "Chargement",
  },
} satisfies Record<Locale, unknown>;

export type FilterBarText = (typeof TEXT)["tr"];

export function useFilterBarText(): FilterBarText {
  const { locale } = useLocale();
  return TEXT[locale] ?? TEXT.tr;
}

/** What a closed menu shows next to its name: nothing, the one pick, or "N seçili". */
export function summarizePicks(labels: readonly string[], text: FilterBarText): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return text.selected(labels.length);
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export interface FilterOption<V extends string = string> {
  value: V;
  label: ReactNode;
  /** Plain text for summaries and titles when `label` is not a string. */
  text?: string;
  /** Results this option would return (the facet count); omitted = not shown. */
  count?: number | null;
  /** Shown in place of the count while the option's data loads. */
  loading?: boolean;
  /** Always disabled. Otherwise an unpicked option at count 0 is dimmed and disabled. */
  disabled?: boolean;
  /** Keeps the option enabled at count 0 (e.g. picking it fetches more data). */
  alwaysEnabled?: boolean;
  /** Mark before the label (a severity rule, a flag). */
  marker?: ReactNode;
  mono?: boolean;
  title?: string;
  lang?: string;
  /** Second line under the label (e.g. the rule a preset applies); read out as the option's description. */
  description?: ReactNode;
  /**
   * Checkbox groups: picking this option replaces the alternatives it excludes (the
   * page enforces that), so it is drawn with a round mark instead of a box.
   */
  exclusive?: boolean;
}

export function optionText(option: FilterOption): string {
  return option.text ?? (typeof option.label === "string" ? option.label : option.value);
}

function isDimmed(option: FilterOption, picked: boolean): boolean {
  if (picked) return false;
  if (option.disabled) return true;
  return !option.alwaysEnabled && option.count === 0;
}

const MICRO = "text-[10px] font-semibold uppercase tracking-[0.18em]";

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The inputs are visually hidden (1px, clipped), so the browser does not scroll
 * a focused row into view by itself: without this, Tab walks down a long list
 * off screen.
 */
function keepRowInView(event: { currentTarget: HTMLElement }) {
  const row = event.currentTarget.closest("label");
  if (row) row.scrollIntoView({ block: "nearest" });
}

function CountText({ option, picked }: { option: FilterOption; picked: boolean }) {
  const text = useFilterBarText();
  if (option.loading) {
    return <Loader2 aria-label={text.loading} className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />;
  }
  if (option.count === undefined || option.count === null) return null;
  // aria-hidden: the count changes on every pick and would otherwise become part of
  // the checkbox's accessible name ("Temettü 12").
  return (
    <span aria-hidden="true" className={cn("shrink-0 font-mono text-[11px] tabular-nums", picked ? "text-primary" : "text-muted-foreground")}>
      {formatNumber(option.count, 0)}
    </span>
  );
}

/**
 * Checkbox rows get a real box, choice rows a tick: combinable vs. replacing. A
 * checkbox that replaces its alternatives (`exclusive`) gets a round box.
 */
function Box({ state, round = false, className }: { state: "off" | "on" | "mixed"; round?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-3.5 w-3.5 shrink-0 place-items-center border transition-colors",
        round && "rounded-full",
        state === "off" ? "border-foreground/30 bg-card" : "border-foreground bg-foreground",
        className,
      )}
    >
      {state === "on" ? (
        round ? (
          <span className="h-1.5 w-1.5 rounded-full bg-background" />
        ) : (
          <span className="h-1 w-[7px] -translate-y-px -rotate-45 border-b-[1.5px] border-l-[1.5px] border-background" />
        )
      ) : state === "mixed" ? (
        <span className="h-0 w-2 border-b-[1.5px] border-background" />
      ) : null}
    </span>
  );
}

function hasDescription(option: FilterOption): boolean {
  return option.description !== undefined && option.description !== null && option.description !== "";
}

/**
 * A described row is a small grid — mark | label | count, then the description
 * under the label and count — so the mark and the count line up with the label's
 * first line however the description wraps.
 */
const DESCRIBED_ROW =
  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-y-px py-2.5 sm:py-1.5 sm:leading-[18px] pointer-coarse:py-2.5";
/** Puts a row's mark on the label's first line (20px, 18px from sm): a 14px box, a 12px tick. */
const DESCRIBED_BOX = "mt-[3px] sm:mt-[2px]";
const DESCRIBED_TICK = "mt-1 sm:mt-[3px]";

/** What follows a row's mark: the label, the count and, when given, the description line. */
function OptionBody({ option, picked, descriptionId }: { option: FilterOption; picked: boolean; descriptionId: string }) {
  if (!hasDescription(option)) {
    return (
      <>
        {option.marker}
        <span lang={option.lang} className={cn("min-w-0 flex-1", option.mono && "font-mono")}>
          {option.label}
        </span>
        <CountText option={option} picked={picked} />
      </>
    );
  }
  return (
    <>
      <span className="flex min-w-0 items-center gap-[0.6rem]">
        {option.marker}
        <span lang={option.lang} className={cn("min-w-0", option.mono && "font-mono")}>
          {option.label}
        </span>
      </span>
      <CountText option={option} picked={picked} />
      {/* Hidden from the label's name; the input points at it as its description. */}
      <span id={descriptionId} aria-hidden="true" className="col-start-2 col-end-4 text-[11px] font-normal leading-[14px] text-muted-foreground">
        {option.description}
      </span>
    </>
  );
}

function FilterIcon() {
  return (
    <svg className="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h11M19 7h1M4 17h4M12 17h8" />
      <circle cx="17" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg className="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6h16M4 12h10M4 18h5" />
    </svg>
  );
}

function DateIcon() {
  return (
    <svg className="shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("shrink-0", className)} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

const ICONS = { filter: FilterIcon, sort: SortIcon, date: DateIcon, list: ChevronIcon } as const;
export type FilterMenuIcon = keyof typeof ICONS;

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

type Stack = "lg" | "xl";

interface BarContextValue {
  openId: string | null;
  stack: Stack;
  hasFacet: boolean;
  toggle: (id: string) => void;
  close: (id: string, focusSummary: boolean) => void;
  registerSummary: (id: string, element: HTMLElement | null) => void;
  /** The last interaction with the bar was a pointer (not the keyboard). */
  pointerPick: RefObject<boolean>;
}

const BarContext = createContext<BarContextValue | null>(null);

/** Where a menu sits in the bar: borders, paddings and panel anchoring depend on it. */
const MenuSlot = createContext<{ index: number; total: number }>({ index: 0, total: 1 });

function useBar(): BarContextValue {
  const context = useContext(BarContext);
  if (!context) throw new Error("FilterBar parts must be rendered inside <FilterBar>.");
  return context;
}

/**
 * The bar. `facet` is the open axis (a <FilterFacet>); `children` are the menus.
 * `status` is announced politely whenever it changes (e.g. "12 of 340 results") —
 * leave it out when the page already announces its result count.
 */
export function FilterBar({
  facet,
  children,
  status,
  stackBelow = "lg",
  label,
  className,
}: {
  facet?: ReactNode;
  children: ReactNode;
  status?: string;
  /** Up to this breakpoint the facet sits on its own row above the menus. */
  stackBelow?: Stack;
  /** Accessible name of the bar (a group). */
  label?: string;
  className?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const summaries = useRef(new Map<string, HTMLElement>());
  const pointerPick = useRef(false);

  const focusSummary = useCallback((id: string) => {
    summaries.current.get(id)?.focus({ preventScroll: true });
  }, []);

  const toggle = useCallback((id: string) => setOpenId((current) => (current === id ? null : id)), []);
  const close = useCallback(
    (id: string, focus: boolean) => {
      setOpenId((current) => (current === id ? null : current));
      if (focus) focusSummary(id);
    },
    [focusSummary],
  );
  const registerSummary = useCallback((id: string, element: HTMLElement | null) => {
    if (element) summaries.current.set(id, element);
    else summaries.current.delete(id);
  }, []);

  useEffect(() => {
    if (openId === null) return;
    // Capture phase: runs before React's own listeners, so a link or button outside
    // the bar can be stopped before it acts (the first tap only closes the panel —
    // on a phone the panel covers the list and that tap was meant for the panel).
    function onClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const bar = barRef.current;
      const menu = bar?.querySelector(`[data-fb-menu="${CSS.escape(openId ?? "")}"]`);
      if (!menu || (target && menu.contains(target))) return;
      setOpenId(null);
      if (target && !bar?.contains(target) && target.closest("a[href], button, summary, [role='button'], [role='link']")) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || openId === null) return;
      setOpenId(null);
      // Focus goes back to the summary — unless the visitor is typing elsewhere (a search
      // box outside the bar): closing the panel must not pull them out of their field.
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typingElsewhere =
        target !== null &&
        !barRef.current?.contains(target) &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (!typingElsewhere) focusSummary(openId);
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [openId, focusSummary]);

  const hasFacet = Boolean(facet);
  const menus = Children.toArray(children).filter(isValidElement);
  const value = useMemo<BarContextValue>(
    () => ({ openId, stack: stackBelow, hasFacet, toggle, close, registerSummary, pointerPick }),
    [openId, stackBelow, hasFacet, toggle, close, registerSummary],
  );

  return (
    <BarContext.Provider value={value}>
      <div
        ref={barRef}
        role="group"
        aria-label={label}
        data-fb-bar=""
        onPointerDownCapture={() => {
          pointerPick.current = true;
        }}
        onKeyDownCapture={() => {
          pointerPick.current = false;
        }}
        className={cn(
          "relative flex flex-col border-y border-border",
          hasFacet && (stackBelow === "lg" ? "lg:flex-row lg:items-stretch" : "xl:flex-row xl:items-stretch"),
          className,
        )}
      >
        {facet}
        <div
          className={cn(
            "grid min-w-0 grid-cols-2 sm:flex",
            hasFacet && "border-t border-border",
            hasFacet && (stackBelow === "lg" ? "lg:ml-auto lg:flex-[0_50_auto] lg:border-t-0" : "xl:ml-auto xl:flex-[0_50_auto] xl:border-t-0"),
          )}
        >
          {menus.map((menu, index) => (
            <MenuSlot.Provider key={menu.key ?? index} value={{ index, total: menus.length }}>
              {menu}
            </MenuSlot.Provider>
          ))}
        </div>
        {status !== undefined ? (
          <span className="sr-only" role="status" aria-live="polite">
            {status}
          </span>
        ) : null}
      </div>
    </BarContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Facet (the open axis)
// ---------------------------------------------------------------------------

/**
 * The axis every visitor reaches in one click: a label and one row of chips.
 * The row never wraps (the bar keeps its height); when it does not fit it
 * scrolls sideways, edge to edge on phones. Its Clear clears this axis only.
 */
export function FilterFacet<V extends string>({
  label,
  options,
  selected,
  onChange,
  onClear,
}: {
  label: string;
  options: readonly FilterOption<V>[];
  selected: readonly V[];
  onChange: (next: V[]) => void;
  /** Defaults to `onChange([])`. */
  onClear?: () => void;
}) {
  const bar = useBar();
  const text = useFilterBarText();
  const labelId = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  const picked = new Set(selected);

  // Arriving on a filtered link, the picked chip may sit outside a row that scrolls.
  useEffect(() => {
    const row = rowRef.current;
    if (!row || row.scrollWidth <= row.clientWidth) return;
    const chip = row.querySelector<HTMLElement>("input:checked")?.closest("label");
    if (!chip) return;
    const pad = parseFloat(getComputedStyle(row).paddingLeft) || 0;
    row.scrollLeft += chip.getBoundingClientRect().left - row.getBoundingClientRect().left - pad;
    // Mount only: afterwards the visitor's own chip is already where they touched it.
  }, []);

  const toggle = (value: V) => {
    const next = picked.has(value) ? selected.filter((item) => item !== value) : [...selected, value];
    // Keep the options' order, not the click order.
    onChange(options.map((option) => option.value).filter((item) => next.includes(item)));
  };

  const lg = bar.stack === "lg";
  return (
    <>
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2 pb-2 pt-3 sm:flex-row sm:items-center sm:gap-4 sm:py-3",
          lg ? "lg:flex-[1_0.01_auto] lg:py-[11px]" : "xl:flex-[1_0.01_auto] xl:py-[11px]",
        )}
      >
        <span id={labelId} className={cn(MICRO, "shrink-0 text-primary")}>
          {label}
        </span>
        <div
          ref={rowRef}
          role="group"
          aria-labelledby={labelId}
          className="fb-fade-x -mx-4 flex flex-nowrap gap-[0.4rem] overflow-x-auto overflow-y-hidden px-4 py-[5px] scrollbar-none scroll-px-4 sm:mx-0 sm:px-0 sm:[mask-image:none] sm:[animation:none]"
        >
          {options.map((option) => {
            const on = picked.has(option.value);
            const dimmed = isDimmed(option, on);
            return (
              <label
                key={option.value}
                title={option.title}
                className={cn(
                  // relative: the visually hidden input is positioned against the chip, not
                  // against a distant ancestor it would otherwise widen the page from.
                  "relative inline-flex shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-md border px-3.5 py-2 text-sm transition-colors",
                  "sm:px-[11px] sm:py-[5px] sm:text-[13px] pointer-coarse:px-3.5 pointer-coarse:py-2",
                  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                  on
                    ? "border-foreground bg-muted font-semibold text-foreground"
                    : dimmed
                      ? "cursor-default border-border text-foreground/75 opacity-35"
                      : "cursor-pointer border-border text-foreground/75 hover:border-foreground/40 hover:text-foreground",
                )}
              >
                <input type="checkbox" className="sr-only" checked={on} disabled={dimmed} onChange={() => toggle(option.value)} />
                {option.marker}
                <span lang={option.lang} className={cn(option.mono && "font-mono")}>
                  {option.label}
                </span>
              </label>
            );
          })}
        </div>
      </div>
      {/* Clears this axis only — a menu's choices are cleared inside its panel. Shown only
          when there is something to clear: permanent chrome for an unavailable action is noise. */}
      {selected.length > 0 ? (
        <button
          type="button"
          onClick={onClear ?? (() => onChange([]))}
          aria-label={text.clearFacet(label)}
          className={cn(
            "flex min-h-11 items-center self-start pb-1 text-[10px] uppercase tracking-[0.18em] text-primary transition-colors hover:text-foreground",
            "outline-none focus-visible:underline focus-visible:underline-offset-4",
            lg ? "lg:min-h-0 lg:self-center lg:px-2.5 lg:py-1.5" : "xl:min-h-0 xl:self-center xl:px-2.5 xl:py-1.5",
          )}
        >
          {text.clear}
        </button>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

interface MenuContextValue {
  close: (focusSummary?: boolean) => void;
  /** Closes when the pick came from a pointer; keyboard users keep arrowing. */
  closeAfterPick: () => void;
  open: boolean;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export function useFilterMenu(): MenuContextValue {
  const context = useContext(MenuContext);
  if (!context) throw new Error("useFilterMenu must be called inside a FilterMenu panel.");
  return context;
}

/** Scroll the page just enough for an opening panel (and its folded growth) to fit. */
function nudgeIntoView(menu: HTMLElement, panel: HTMLElement) {
  const folded = panel.querySelector<HTMLElement>("[data-fb-folded='true']");
  const cap = folded ? parseFloat(getComputedStyle(panel).maxHeight) || 0 : 0;
  const grow = folded ? Math.max(0, Math.min(folded.scrollHeight - folded.clientHeight, cap - panel.offsetHeight)) : 0;
  const overflow = panel.getBoundingClientRect().bottom + grow - window.innerHeight + 16;
  if (overflow <= 0) return;
  const summary = menu.querySelector("summary");
  const header = document.querySelector("header");
  const room = (summary?.getBoundingClientRect().top ?? 0) - (header ? header.getBoundingClientRect().bottom : 0) - 8;
  const by = Math.min(overflow, Math.max(room, 0));
  if (by > 0) window.scrollBy({ top: by, behavior: reducedMotion() ? "auto" : "smooth" });
}

/**
 * A panel hangs from its own cell; one wider than the room beside it (a columns
 * panel) is shifted sideways so it never runs past the bar's edges.
 */
function keepInsideBar(panel: HTMLElement) {
  panel.style.left = "";
  panel.style.right = "";
  const bar = panel.closest<HTMLElement>("[data-fb-bar]");
  const cell = panel.offsetParent;
  if (!bar || !(cell instanceof HTMLElement)) return;
  const box = panel.getBoundingClientRect();
  const edges = bar.getBoundingClientRect();
  let shift = box.right > edges.right ? edges.right - box.right : 0;
  if (box.left + shift < edges.left) shift = edges.left - box.left;
  if (Math.abs(shift) < 1) return;
  // An offset, not a transform: the unshifted box must not count as page overflow.
  panel.style.left = `${Math.round(box.left + shift - cell.getBoundingClientRect().left - cell.clientLeft)}px`;
  panel.style.right = "auto";
}

/**
 * A dropdown in the bar: its summary shows the name, the current pick and an
 * icon; the panel holds a choice list (`variant="list"`) or the groups layout
 * (use <FilterGroupsMenu>).
 */
export function FilterMenu({
  label,
  value,
  icon = "filter",
  variant = "list",
  wide = false,
  panelClassName,
  children,
}: {
  label: string;
  /** Current pick shown after the name; "" when nothing is picked. */
  value?: string;
  icon?: FilterMenuIcon;
  variant?: "list" | "groups";
  /** Room for a groups panel in columns: two columns wide from md, three from lg. */
  wide?: boolean;
  panelClassName?: string;
  children: ReactNode;
}) {
  const bar = useBar();
  const id = useId();
  const open = bar.openId === id;
  const menuRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const aligned = useRef(false);
  const Icon = ICONS[icon];
  const { registerSummary, close: closeMenu, pointerPick } = bar;

  useEffect(() => {
    registerSummary(id, summaryRef.current);
    return () => registerSummary(id, null);
  }, [id, registerSummary]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !panelRef.current) return;
    // Arriving on a filtered link: the first open shows the visitor's own pick.
    if (!aligned.current) {
      aligned.current = true;
      panelRef.current.querySelector("input:checked")?.closest("label")?.scrollIntoView({ block: "nearest" });
    }
    keepInsideBar(panelRef.current);
    nudgeIntoView(menuRef.current, panelRef.current);
  }, [open]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const onResize = () => keepInsideBar(panel);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const menuValue = useMemo<MenuContextValue>(
    () => ({
      open,
      close: (focusSummary = true) => closeMenu(id, focusSummary),
      closeAfterPick: () => {
        if (pointerPick.current) closeMenu(id, true);
      },
    }),
    [open, closeMenu, id, pointerPick],
  );

  const { index, total } = useContext(MenuSlot);
  const lg = bar.stack === "lg";
  const facet = bar.hasFacet;
  // Phones: two columns; a last menu left alone takes the whole row.
  const rightColumn = index % 2 === 1;
  const spansRow = index === total - 1 && total % 2 === 1;
  // Tablets: menus share one row; the right half's panels hang from their right edge
  // so a 250px panel under a narrow cell never runs off the screen.
  const anchorRight = total > 1 && index >= Math.ceil(total / 2);
  return (
    <MenuContext.Provider value={menuValue}>
      <details
        ref={menuRef}
        open={open}
        data-fb-menu={id}
        className={cn(
          // Phones: static, so the panel hangs from the whole bar (full width), not this cell.
          "static min-w-0 border-border sm:relative sm:flex-1 sm:basis-0 sm:border-t-0",
          rightColumn && "border-l",
          index >= 2 && "border-t",
          spansRow && "col-span-2",
          index > 0 ? "sm:border-l" : "sm:border-l-0",
          facet && (lg ? "lg:flex-[0_1_auto] lg:basis-auto lg:border-l" : "xl:flex-[0_1_auto] xl:basis-auto xl:border-l"),
        )}
      >
        <summary
          ref={summaryRef}
          onClick={(event: ReactMouseEvent) => {
            event.preventDefault();
            bar.toggle(id);
          }}
          className={cn(
            "relative flex h-full min-h-[38px] cursor-pointer list-none items-center gap-[0.35rem] whitespace-nowrap py-[9px] pr-1.5 transition-colors [&::-webkit-details-marker]:hidden",
            "text-[10px] font-semibold uppercase tracking-[0.14em] sm:min-h-12 sm:gap-[0.55rem] sm:py-3.5 sm:pr-3 sm:tracking-[0.18em]",
            rightColumn ? "pl-3" : "pl-0",
            index > 0 ? "sm:pl-4" : "sm:pl-0",
            facet && (lg ? "lg:min-h-0 lg:pl-5 lg:pr-1" : "xl:min-h-0 xl:pl-5 xl:pr-1"),
            "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
            open ? "text-primary" : "text-foreground hover:text-primary",
          )}
        >
          <span className="shrink-0">{label}</span>
          {/* The pick's name is capped so a long one takes room from itself, not the chips. */}
          <span
            title={value || undefined}
            className="min-w-0 flex-[0_1_auto] truncate text-[10px] font-normal normal-case tracking-[0.02em] text-muted-foreground empty:hidden sm:max-w-[12rem] sm:uppercase sm:tracking-[0.08em]"
          >
            {value}
          </span>
          <span className="ml-auto flex shrink-0 items-center pl-1">
            <Icon />
          </span>
        </summary>
        <div
          ref={panelRef}
          className={cn(
            "absolute inset-x-0 top-full z-30 border border-border bg-popover text-popover-foreground",
            // Two-layer shadow: one layer disappeared over the rows it covers.
            "shadow-[0_18px_36px_-12px_rgb(0_0_0/0.18),0_4px_10px_-4px_rgb(0_0_0/0.06)]",
            anchorRight ? "sm:left-auto sm:right-0" : "sm:left-0 sm:right-auto",
            "sm:w-[max(100%,250px)]",
            variant === "list"
              ? "max-h-[min(22rem,60vh)] overflow-y-auto overflow-x-hidden overscroll-contain py-1 sm:max-h-[22rem]"
              : "flex max-h-[min(26rem,64vh)] flex-col overflow-hidden sm:max-h-[min(26rem,70vh)] sm:max-w-[420px]",
            facet &&
              (lg
                ? cn("lg:left-auto lg:right-0", variant === "list" ? "lg:w-[250px]" : "lg:w-[264px]")
                : cn("xl:left-auto xl:right-0", variant === "list" ? "xl:w-[250px]" : "xl:w-[264px]")),
            // Columns panel: 2 × 17rem from md, 3 × 15rem from lg (useColumnCount uses the same
            // breakpoints); wider than its cell, it is kept inside the bar by keepInsideBar.
            wide && "md:w-[34rem] md:max-w-[calc(100vw-2rem)] md:max-h-[min(48rem,calc(100dvh-9rem))] lg:w-[45rem]",
            panelClassName,
          )}
        >
          {children}
        </div>
      </details>
    </MenuContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Choice list (single pick: SIRALA, TARİH, …)
// ---------------------------------------------------------------------------

export function FilterChoiceList<V extends string>({
  label,
  showLabel = false,
  value,
  options,
  onChange,
  keepOpen,
}: {
  label: string;
  /** Print the list's name above it (for a panel with several lists). */
  showLabel?: boolean;
  value: V;
  options: readonly FilterOption<V>[];
  onChange: (value: V) => void;
  /** Picks that leave the menu open (e.g. "custom range" reveals more controls). */
  keepOpen?: (value: V) => boolean;
}) {
  const menu = useFilterMenu();
  const name = useId();
  const labelId = useId();
  return (
    <div role="radiogroup" aria-label={showLabel ? undefined : label} aria-labelledby={showLabel ? labelId : undefined}>
      {showLabel ? (
        <div id={labelId} className="px-[18px] pb-1 pt-2.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {label}
        </div>
      ) : null}
      {options.map((option, index) => {
        const on = option.value === value;
        const dimmed = isDimmed(option, on);
        const described = hasDescription(option);
        const descriptionId = `${name}-d${index}`;
        return (
          <label
            key={option.value}
            title={option.title}
            className={cn(
              "relative flex items-center gap-[0.6rem] px-[18px] py-3 text-sm transition-colors sm:py-2 sm:text-[13px] pointer-coarse:py-3",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring",
              on ? "font-semibold text-foreground" : "text-foreground/70",
              dimmed ? "cursor-default opacity-35" : "cursor-pointer hover:bg-muted/60 hover:text-foreground",
              described && DESCRIBED_ROW,
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              className="sr-only"
              checked={on}
              disabled={dimmed}
              aria-describedby={described ? descriptionId : undefined}
              onFocus={keepRowInView}
              onChange={() => onChange(option.value)}
              onClick={() => {
                if (!keepOpen?.(option.value)) menu.closeAfterPick();
              }}
            />
            <Check
              aria-hidden="true"
              strokeWidth={2.5}
              className={cn("h-3 w-3 shrink-0 text-primary", on ? "opacity-100" : "opacity-0", described && DESCRIBED_TICK)}
            />
            <OptionBody option={option} picked={on} descriptionId={descriptionId} />
          </label>
        );
      })}
    </div>
  );
}

/**
 * A small titled section inside a list panel (custom date fields, notes). `actions`
 * sit at the end of the title row (e.g. ‹ › to shift a range); `labelId` lets the
 * fields below name their group after the title.
 */
export function FilterPanelSection({
  label,
  labelId,
  actions,
  children,
  className,
}: {
  label?: string;
  labelId?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-t border-border px-[18px] py-3", className)}>
      {label || actions ? (
        <div className="flex min-h-5 items-center justify-between gap-2 pb-2">
          <span id={labelId} className="text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {label}
          </span>
          {actions ? <span className="flex shrink-0 items-center gap-1">{actions}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Groups panel (FİLTRELE)
// ---------------------------------------------------------------------------

export interface FilterGroupSpec<V extends string = string> {
  id: string;
  label: string;
  /** "checkbox" rows combine (box); "radio" rows replace each other (tick). */
  type?: "checkbox" | "radio";
  options?: readonly FilterOption<V>[];
  selected?: readonly V[];
  // Method syntax on purpose: groups of different value types share one array.
  onChange?(next: V[]): void;
  /** Adds a "select all" row driving every option of the group. */
  selectAll?: boolean;
  /**
   * Picks that must stay (checkbox groups): at this many, the picked options are
   * locked — e.g. the last country, when data is fetched per picked country.
   */
  minSelected?: number;
  /** Custom body instead of option rows (e.g. range inputs). */
  content?: ReactNode;
  /** Header badge; defaults to the number of selected options. */
  count?: number;
  /** Shown above the rows (or alone when there are none). */
  note?: ReactNode;
}

function OptionRows<V extends string>({ group }: { group: FilterGroupSpec<V> }) {
  const text = useFilterBarText();
  const menu = useFilterMenu();
  const radioName = useId();
  const allRef = useRef<HTMLInputElement>(null);
  const options = group.options ?? [];
  const selected = group.selected ?? [];
  const picked = new Set(selected);
  const type = group.type ?? "checkbox";
  const pickedCount = options.filter((option) => picked.has(option.value)).length;
  const allState = pickedCount === 0 ? "off" : pickedCount === options.length ? "on" : "mixed";
  const minSelected = type === "checkbox" ? (group.minSelected ?? 0) : 0;
  const locked = minSelected > 0 && pickedCount <= minSelected;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = allState === "mixed";
  }, [allState]);

  const change = (next: V[]) => {
    if (next.length < minSelected) return;
    group.onChange?.(options.map((option) => option.value).filter((value) => next.includes(value)));
  };
  const rowClass = (on: boolean, dimmed: boolean) =>
    cn(
      "relative flex items-center gap-[0.6rem] px-[18px] py-3 text-sm transition-colors sm:py-2 sm:text-[13px] pointer-coarse:py-3",
      "has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring",
      on ? "font-semibold text-foreground" : "text-foreground/70",
      dimmed ? "cursor-default opacity-35" : "cursor-pointer hover:bg-muted/60 hover:text-foreground",
    );

  return (
    <>
      {group.selectAll && type === "checkbox" && options.length > 1 ? (
        // Text first, box last, at the row's right end: it drives the values, it is not one of them.
        <label
          className={cn(
            "relative flex items-center gap-[0.6rem] border-b border-border/60 px-[18px] py-[13px] text-[13px] leading-[18px] transition-colors sm:py-[5px] sm:text-xs pointer-coarse:py-[13px]",
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-ring",
            allState === "on" && minSelected > 0 ? "cursor-default" : "cursor-pointer hover:bg-muted/60",
          )}
        >
          <input
            ref={allRef}
            type="checkbox"
            className="sr-only"
            checked={allState === "on"}
            // Unticking would clear the group below its minimum.
            disabled={allState === "on" && minSelected > 0}
            onFocus={keepRowInView}
            // Includes dimmed options: "all" does not narrow its scope, and a ticked option
            // is enabled again on the next count anyway.
            onChange={(event) => change(event.target.checked ? options.map((option) => option.value) : [])}
          />
          <span className={cn("flex-1 text-right", allState === "off" ? "text-muted-foreground" : "text-foreground")}>{text.selectAll}</span>
          <Box state={allState} />
        </label>
      ) : null}
      {options.map((option, index) => {
        const on = picked.has(option.value);
        const dimmed = isDimmed(option, on);
        // A locked pick keeps its full weight — it is chosen, just not removable.
        const fixed = on && locked;
        const described = hasDescription(option);
        const descriptionId = `${radioName}-d${index}`;
        return (
          <label
            key={option.value}
            title={option.title}
            className={cn(rowClass(on, dimmed), described && DESCRIBED_ROW, fixed && "cursor-default hover:bg-transparent")}
          >
            <input
              type={type}
              name={type === "radio" ? radioName : undefined}
              value={option.value}
              className="sr-only"
              checked={on}
              disabled={dimmed || fixed}
              aria-describedby={described ? descriptionId : undefined}
              onFocus={keepRowInView}
              onChange={() => {
                if (type === "radio") change([option.value]);
                else change(on ? selected.filter((value) => value !== option.value) : [...selected, option.value]);
              }}
              onClick={type === "radio" ? () => menu.closeAfterPick() : undefined}
            />
            {type === "checkbox" ? (
              <Box state={on ? "on" : "off"} round={option.exclusive} className={described ? DESCRIBED_BOX : undefined} />
            ) : (
              <Check
                aria-hidden="true"
                strokeWidth={2.5}
                className={cn("h-3 w-3 shrink-0 text-primary", on ? "opacity-100" : "opacity-0", described && DESCRIBED_TICK)}
              />
            )}
            <OptionBody option={option} picked={on} descriptionId={descriptionId} />
          </label>
        );
      })}
    </>
  );
}

function GroupSection<V extends string>({
  group,
  index,
  folded,
  onUnfold,
  headRef,
  onToggle,
}: {
  group: FilterGroupSpec<V>;
  index: number;
  /** Looks closed while open: its list hangs below the header, out of the flow. */
  folded: boolean;
  onUnfold: (section: HTMLElement) => void;
  headRef?: (element: HTMLElement | null) => void;
  onToggle: () => void;
}) {
  const count = group.count ?? group.selected?.length ?? 0;
  return (
    <details
      open
      onToggle={onToggle}
      className={cn("fb-group group/fg", index > 0 && "border-t border-border", folded && "relative")}
    >
      <summary
        ref={headRef}
        onClick={(event) => {
          // Folded, the group is open underneath: the default would close it.
          if (!folded) return;
          event.preventDefault();
          onUnfold(event.currentTarget.parentElement as HTMLElement);
        }}
        className={cn(
          // Sticky while its list scrolls under it; opaque so the rows do not show through.
          "sticky top-0 z-[1] flex min-h-11 cursor-pointer list-none items-center gap-2 bg-popover px-[18px] transition-colors sm:min-h-0 [&::-webkit-details-marker]:hidden",
          MICRO,
          "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          folded
            ? "py-2 text-foreground hover:text-primary"
            : "py-3 text-foreground hover:text-primary group-open/fg:pb-1 group-open/fg:text-primary",
        )}
      >
        <span>{group.label}</span>
        {count > 0 ? (
          <span className="grid h-4 min-w-4 place-items-center bg-muted px-1 font-mono text-[10px] font-medium tracking-normal text-foreground tabular-nums">
            {count}
          </span>
        ) : null}
        <ChevronIcon
          className={cn("ml-auto text-muted-foreground transition-transform duration-200", !folded && "group-open/fg:rotate-180")}
        />
      </summary>
      <div role="group" aria-label={group.label} className={cn("pb-1.5", folded && "absolute inset-x-0 top-full")}>
        {group.note ? <div className="px-[18px] pb-2 pt-1 text-xs leading-snug text-muted-foreground">{group.note}</div> : null}
        {group.content ?? <OptionRows group={group} />}
      </div>
    </details>
  );
}

/**
 * FİLTRELE: several axes in one panel. Picks apply at once; the foot's button
 * only closes the panel — it names the result count so the visitor knows what
 * closing will show ("4.133 bildirimi göster").
 */
export function FilterGroupsMenu({
  label,
  title,
  value,
  groups,
  onClear,
  clearDisabled,
  applyLabel,
  empty = false,
  icon = "filter",
  columns = false,
  panelClassName,
}: {
  label: string;
  /** Panel head; defaults to `label`. */
  title?: string;
  value?: string;
  groups: readonly FilterGroupSpec[];
  /** Clears this panel's axes only. */
  onClear: () => void;
  clearDisabled: boolean;
  applyLabel: string;
  /** Nothing matches: the button stays (it still closes) but loses its weight. */
  empty?: boolean;
  icon?: FilterMenuIcon;
  /**
   * Many groups: side by side on wide screens (two columns from md, three from lg,
   * in reading order), so the panel reads at a glance instead of scrolling.
   */
  columns?: boolean;
  panelClassName?: string;
}) {
  return (
    <FilterMenu label={label} value={value} icon={icon} variant="groups" wide={columns} panelClassName={panelClassName}>
      <GroupsPanel
        title={title ?? label}
        groups={groups}
        onClear={onClear}
        clearDisabled={clearDisabled}
        applyLabel={applyLabel}
        empty={empty}
        columns={columns}
      />
    </FilterMenu>
  );
}

// Same breakpoints as the columns panel's width (FilterMenu `wide`): lg, md.
const COLUMN_QUERIES = [
  [3, "(min-width: 64rem)"],
  [2, "(min-width: 48rem)"],
] as const;

function subscribeColumns(onChange: () => void): () => void {
  const lists = COLUMN_QUERIES.map(([, query]) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}

function readColumns(): number {
  return COLUMN_QUERIES.find(([, query]) => window.matchMedia(query).matches)?.[0] ?? 1;
}

const oneColumn = () => 1;
const noSubscription = () => () => {};

function useColumnCount(enabled: boolean): number {
  // One column on the server and while hydrating; the real count right after.
  return useSyncExternalStore(enabled ? subscribeColumns : noSubscription, enabled ? readColumns : oneColumn, oneColumn);
}

/** Rough height of a group, to balance the columns. */
function groupWeight(group: FilterGroupSpec): number {
  const options = group.options ?? [];
  const rows = options.length * 36 + options.filter(hasDescription).length * 13;
  return 40 + (group.note ? 40 : 0) + (group.options ? rows : 160);
}

/** Cuts the groups, in order, into `count` columns whose tallest is as short as possible. */
function splitColumns<T>(items: readonly T[], count: number, weight: (item: T) => number): T[][] {
  const parts = Math.min(count, items.length);
  let best: T[][] = [items.slice()];
  let bestHeight = Infinity;
  // A handful of groups: trying every set of cut points is cheap.
  const search = (start: number, left: number, done: T[][]) => {
    if (left === 1) {
      const columns = [...done, items.slice(start)];
      const height = Math.max(...columns.map((column) => column.reduce((sum, item) => sum + weight(item), 0)));
      if (height < bestHeight) {
        bestHeight = height;
        best = columns;
      }
      return;
    }
    for (let end = start + 1; end <= items.length - (left - 1); end++) search(end, left - 1, [...done, items.slice(start, end)]);
  };
  if (parts > 1) search(0, parts, []);
  return best;
}

function GroupsPanel({
  title,
  groups,
  onClear,
  clearDisabled,
  applyLabel,
  empty,
  columns: columnsWanted,
}: {
  title: string;
  groups: readonly FilterGroupSpec[];
  onClear: () => void;
  clearDisabled: boolean;
  applyLabel: string;
  empty: boolean;
  columns: boolean;
}) {
  const text = useFilterBarText();
  const menu = useFilterMenu();
  const bodyRef = useRef<HTMLDivElement>(null);
  const secondHead = useRef<HTMLElement | null>(null);
  const columnCount = useColumnCount(columnsWanted);
  const columns = columnCount > 1 ? splitColumns(groups, columnCount, groupWeight) : null;
  // Two axes (belif's case): the first opens, the second starts folded — open, but
  // looking closed, its list hanging under its header out of the flow — so the panel
  // is short and yet already scrollable: the first wheel tick or swipe is the
  // browser's own scroll, and the moment the body moves the fold lifts for good.
  // With more axes every list is in the flow from the start (sticky headers keep
  // the reader oriented): a fold would have to hide the middle ones and pop them in.
  const [folded, setFolded] = useState(groups.length === 2);
  const [cut, setCut] = useState(false);
  const foldable = folded && groups.length === 2 && !columns;

  const unfold = useCallback(() => {
    setFolded(false);
    setCut(false);
  }, []);

  // Folded header cut off by the panel's floor (a long first group on a phone): the
  // fade comes back so the half-shown header ends softly.
  useEffect(() => {
    const body = bodyRef.current;
    if (!foldable || !body || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const head = secondHead.current;
      if (head) setCut(head.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + 1);
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [foldable, menu.open]);

  const nudge = () => {
    const panel = bodyRef.current?.parentElement;
    const details = panel?.closest("details");
    if (panel && details && menu.open) nudgeIntoView(details, panel);
  };

  return (
    <>
      <div className="flex shrink-0 items-center justify-between border-b border-border py-1 pl-[18px] pr-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <span>{title}</span>
        <button
          type="button"
          onClick={() => menu.close(true)}
          aria-label={text.closePanel}
          className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-11 pointer-coarse:w-11"
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
      <div
        ref={bodyRef}
        data-fb-folded={foldable ? "true" : undefined}
        data-fb-cut={foldable && cut ? "true" : undefined}
        onScroll={(event) => {
          if (foldable && event.currentTarget.scrollTop > 0) unfold();
        }}
        className="fb-fade-y min-h-0 flex-1 overflow-y-auto overscroll-contain [scroll-padding-block-start:44px]"
      >
        {columns ? (
          // Columns stretch to the tallest, so the hairlines between them run the full height.
          <div className="grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
            {columns.map((column, columnIndex) => (
              <div key={column[0]?.id ?? columnIndex} className={cn("min-w-0", columnIndex > 0 && "border-l border-border")}>
                {column.map((group, index) => (
                  <GroupSection key={group.id} group={group} index={index} folded={false} onToggle={nudge} onUnfold={() => {}} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          groups.map((group, index) => (
            <GroupSection
              key={group.id}
              group={group}
              index={index}
              folded={foldable && index === 1}
              headRef={
                index === 1
                  ? (element) => {
                      secondHead.current = element;
                    }
                  : undefined
              }
              onToggle={nudge}
              onUnfold={(section) => {
                unfold();
                const body = bodyRef.current;
                if (!body) return;
                // After the fold lifts, bring the clicked axis to the top of the body.
                requestAnimationFrame(() => {
                  const top = section.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
                  body.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
                });
              }}
            />
          ))
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2.5 border-t border-border px-3.5 pb-3 pt-2.5 sm:pb-3.5 sm:pt-3">
        {/* Clears this panel's axes only; kept (dimmed) when there is nothing to clear, so
            the button beside it does not change width on the first pick. */}
        <button
          type="button"
          onClick={onClear}
          disabled={clearDisabled}
          aria-label={text.clearPanel}
          className={cn(
            MICRO,
            "min-h-11 shrink-0 px-1.5 text-primary transition-colors hover:text-foreground disabled:cursor-default disabled:text-muted-foreground/50 sm:min-h-[42px]",
            "outline-none focus-visible:underline focus-visible:underline-offset-4",
          )}
        >
          {text.clear}
        </button>
        <button
          type="button"
          onClick={() => menu.close(true)}
          className={cn(
            "min-h-11 min-w-0 flex-1 truncate rounded-md px-3.5 text-sm font-medium transition-colors sm:min-h-[42px] sm:text-[13px]",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-popover",
            empty ? "bg-muted text-muted-foreground hover:bg-muted/70" : "bg-foreground text-background hover:bg-foreground/85",
            // Across columns a full-width button would be a bar of its own: one column wide, at the end.
            columns && "ml-auto max-w-[16rem]",
          )}
        >
          {empty ? text.noResults : applyLabel}
        </button>
      </div>
    </>
  );
}
