"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { Menu } from "@base-ui/react/menu";
import { Ellipsis, GripHorizontal, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useMediaQuery } from "@/components/charts/use-coarse-pointer";
import { Button } from "@/components/ui/button";
import { MotionMenuPopup, ReleaseMenu } from "@/components/ui/motion-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { motionScrollBehavior, useMotionAllowed } from "@/hooks/use-motion-allowed";
import type { TranslationKey } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { cubicBezier, motionCurve, motionDuration } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LIMITS,
  MAX_GRID_ROWS,
  WORKSPACE_COLUMNS,
  WORKSPACE_DESKTOP_QUERY,
  WORKSPACE_GAP,
  WORKSPACE_ROW_STEP,
  fitHeights,
  nudgeCard,
  packLayout,
  parseLayout,
  readingOrder,
  serializeLayout,
  type CardLimits,
  type LayoutChange,
  type LayoutItem,
  type WorkspaceLayout,
} from "./layout-model";
import { PanelProvider, TRANSIENT, type PanelState } from "./panel";
import { useLayoutGesture, type GesturePreview, type GestureRelease } from "./use-layout-gesture";
import styles from "./workspace.module.css";

/** A card a page offers for arranging. */
export type WorkspaceCard = Partial<CardLimits> & {
  /** Names the card in its move, resize and menu controls. */
  label: string;
  /**
   * The card keeps the height of its content instead of filling a slot: it
   * can be moved and made wider or narrower, and its height follows. For
   * strips of figures and other blocks whose content cannot scroll or stretch.
   */
  hug?: boolean;
};

const STORAGE_PREFIX = "hisse.layout.";
const SAVED_EVENT = "workspace-layout-saved";
const DESTINATION = "destination";
/** However little a card has to show, its slot keeps room for a title and a line. */
const MIN_CEILING = 3;
const GLIDE_EASING = cubicBezier(motionCurve.easeOut);
const GRID_STYLE = {
  "--grid-columns": WORKSPACE_COLUMNS,
  "--grid-gap": `${WORKSPACE_GAP}px`,
  "--row-step": `${WORKSPACE_ROW_STEP}px`,
} as CSSProperties;
const adjustments = [
  { label: "dashboard.moveUp", key: "ArrowUp", kind: "move", x: 0, y: -1 },
  { label: "dashboard.moveDown", key: "ArrowDown", kind: "move", x: 0, y: 1 },
  { label: "dashboard.moveLeft", key: "ArrowLeft", kind: "move", x: -1, y: 0 },
  { label: "dashboard.moveRight", key: "ArrowRight", kind: "move", x: 1, y: 0 },
  { label: "dashboard.narrower", key: "ArrowLeft", kind: "resize", x: -1, y: 0 },
  { label: "dashboard.wider", key: "ArrowRight", kind: "resize", x: 1, y: 0 },
  { label: "dashboard.shorter", key: "ArrowUp", kind: "resize", x: 0, y: -1 },
  { label: "dashboard.taller", key: "ArrowDown", kind: "resize", x: 0, y: 1 },
] as const satisfies readonly { label: TranslationKey; key: string; kind: LayoutChange; x: number; y: number }[];

type Control = LayoutChange | "options";
/** `layout` is null only while the page's default arrangement is being measured. */
type Edit = { layout: WorkspaceLayout | null; status: "unchanged" | "changed" | "reset" };
/** Layouts the browser refused to store stay usable until the page is left. */
const sessionLayouts = new Map<string, { raw: string | null; storageAtFailure: string | null }>();

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(SAVED_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SAVED_EVENT, onChange);
  };
}

function slotStyle({ x, y, w, h }: LayoutItem, order: number): CSSProperties {
  return { "--column": x + 1, "--row": y + 1, "--columns": w, "--rows": h, "--order": order } as CSSProperties;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/** How far a glide still in flight has the element displaced. */
function displacement(element: HTMLElement): [number, number] {
  const [x = 0, y = 0] = getComputedStyle(element).translate.split(" ").map(Number.parseFloat);
  return [x || 0, y || 0];
}

type WorkspaceState = {
  cards: Readonly<Record<string, WorkspaceCard>>;
  grid: RefObject<HTMLDivElement | null>;
  /** A saved or draft layout is in effect, on any screen. */
  customized: boolean;
  /** That layout is laid out on the desktop grid (below it the cards stack in reading order). */
  positioned: boolean;
  editing: boolean;
  base: WorkspaceLayout | null;
  preview: GesturePreview | null;
  /** Where each card is drawn; a card being dragged stays in its starting slot. */
  slots: ReadonlyMap<string, LayoutItem>;
  order: ReadonlyMap<string, number>;
  landing: LayoutItem | undefined;
  helpId: string;
  limits: (id: string) => CardLimits;
  gesture: ReturnType<typeof useLayoutGesture>;
  nudge: (id: string, kind: LayoutChange, x: number, y: number, control: Control) => void;
  canNudge: (id: string, kind: LayoutChange, x: number, y: number) => boolean;
  reportHeight: (id: string, rows: number) => void;
  /** The height at which a card shows all it has; `null` when it can use any height. */
  reportCeiling: (id: string, rows: number | null) => void;
  absent: ReadonlySet<string>;
  reportPresence: (id: string, present: boolean) => void;
  startEditing: () => void;
  closeEditor: () => void;
  resetLayout: () => void;
  saveLayout: () => void;
  customizeButton: RefObject<HTMLButtonElement | null>;
  saveButton: RefObject<HTMLButtonElement | null>;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

function useWorkspace(): WorkspaceState {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("Workspace parts must be rendered inside <Workspace>.");
  return workspace;
}

/**
 * Lets a page's cards be moved and resized, Shopify-dashboard style. The page
 * keeps its own markup: every card sits in a `<Tile>`, wrappers that only
 * arrange tiles are `<TileGroup>`s, and all of it is inside a `<WorkspaceGrid>`.
 * Until the visitor saves a layout the page renders exactly as written. With a
 * layout the same elements are placed on a grid (the groups dissolve), so cards
 * keep their state when the mode changes.
 *
 * `page` names the saved layout; views that share a name share a layout.
 */
export function Workspace({
  page,
  cards,
  children,
  storageKey = STORAGE_PREFIX + page,
}: {
  page: string;
  cards: Readonly<Record<string, WorkspaceCard>>;
  children: ReactNode;
  storageKey?: string;
}) {
  const { t } = useLocale();
  const desktop = useMediaQuery(WORKSPACE_DESKTOP_QUERY);
  const motionAllowed = useMotionAllowed();
  const stored = useSyncExternalStore(
    subscribe,
    () => {
      const value = readStorage(storageKey);
      const session = sessionLayouts.get(storageKey);
      return session?.storageAtFailure === value ? session.raw : value;
    },
    () => null,
  );
  const [edit, setEdit] = useState<Edit | null>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [ceilings, setCeilings] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [absent, setAbsent] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const customizeButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const measuring = useRef(false);
  const shown = useRef<{ width: number; slots: Map<string, LayoutItem> } | null>(null);
  const glides = useRef(new Map<string, Animation>());
  const released = useRef<GestureRelease | null>(null);
  const control = useRef<{ id: string; kind: Control; reveal: boolean } | null>(null);
  const helpId = useId();

  const ids = useMemo(() => Object.keys(cards), [cards]);
  const limits = (id: string): CardLimits => {
    const card = cards[id];
    // A card that hugs its content is as tall as that content, whatever it is.
    if (card?.hug) return { minW: card.minW ?? DEFAULT_LIMITS.minW, minH: 1, maxH: MAX_GRID_ROWS, hug: true };
    // A card with a finite list stops growing where the list ends, however short that is.
    const maxH = Math.min(card?.maxH ?? DEFAULT_LIMITS.maxH, ceilings.get(id) ?? MAX_GRID_ROWS);
    return { minW: card?.minW ?? DEFAULT_LIMITS.minW, minH: Math.min(card?.minH ?? DEFAULT_LIMITS.minH, maxH), maxH };
  };
  const saved = parseLayout(stored, ids, limits);
  const editing = desktop && edit !== null;
  const draft = editing ? edit.layout : saved;
  // A card with nothing to show (no sector to compare with, say) gives up its slot until it has.
  const missing = draft && absent.size > 0 ? draft.filter(({ id }) => absent.has(id)) : [];
  const present = draft && packLayout(missing.length > 0 ? draft.filter(({ id }) => !absent.has(id)) : draft);
  // Cards that hug their content report their height once they are on screen;
  // the others are no taller than what they have to show.
  function fit(layout: WorkspaceLayout): WorkspaceLayout {
    const fitted = new Map([...heights].filter(([id]) => cards[id]?.hug));
    for (const { id, h } of layout) {
      const ceiling = cards[id]?.hug ? undefined : ceilings.get(id);
      if (ceiling !== undefined && h > ceiling) fitted.set(id, ceiling);
    }
    return fitHeights(layout, fitted);
  }
  const base = present && fit(present);

  function commit(layout: WorkspaceLayout, id: string, kind: Control, reveal: boolean) {
    control.current = { id, kind, reveal };
    // Cards the layout does not place (hidden now, or shown since it was worked out) keep their slots.
    const placed = new Set(layout.map((item) => item.id));
    setEdit({ layout: [...layout, ...(draft ?? []).filter((item) => !placed.has(item.id))], status: "changed" });
    const item = layout.find((entry) => entry.id === id);
    if (item) {
      setAnnouncement(t("dashboard.layoutPosition", {
        card: cards[id]?.label ?? id,
        column: item.x + 1,
        row: item.y + 1,
        width: item.w,
        height: item.h,
      }));
    }
  }

  const gesture = useLayoutGesture(grid, editing, limits, (release) => {
    released.current = release;
    if (release.changed) commit(release.layout, release.id, release.kind, false);
  });
  const preview = base ? gesture.preview : null;
  // The gesture works from the heights the cards had when it began. They are
  // measured again as a card is reshaped, so the outline shows the slot the
  // card will really take and its neighbours make room for exactly that.
  const layout = preview ? fit(preview.layout) : base;
  const customized = layout !== null;
  const positioned = desktop && customized;
  const slots = new Map<string, LayoutItem>();
  const order = new Map<string, number>();
  if (customized) {
    for (const item of layout) slots.set(item.id, preview?.id === item.id ? base?.find(({ id }) => id === item.id) ?? item : item);
    readingOrder(base ?? layout).forEach((item, index) => order.set(item.id, index));
  }
  const landing = positioned && preview ? layout.find(({ id }) => id === preview.id) : undefined;
  if (landing) slots.set(DESTINATION, landing);

  // Runs after every render: cards glide from where they were on screen to their new slots.
  useLayoutEffect(() => {
    const container = grid.current;
    if (!container || measuring.current) return;
    const before = shown.current;
    const release = released.current;
    const focus = control.current;
    released.current = null;
    control.current = null;
    const width = container.offsetWidth;
    shown.current = positioned ? { width, slots } : null;

    const used = focus && container.querySelector<HTMLElement>(`[data-tile="${focus.id}"] [data-control="${focus.kind}"]`);
    if (used) {
      if (document.activeElement !== used) used.focus({ preventScroll: true });
      if (focus.reveal) used.closest("[data-tile]")?.scrollIntoView({ block: "nearest", behavior: motionScrollBehavior() });
    }

    if (!positioned || !motionAllowed || (before && before.width !== width)) {
      for (const glide of glides.current.values()) glide.cancel();
      glides.current.clear();
      return;
    }
    if (!before) return;
    const columnStep = (width + WORKSPACE_GAP) / WORKSPACE_COLUMNS;
    // A card that hugs its content is never given a height: the content sets it.
    const pixels = ({ w, h }: LayoutItem, hug = false) => ({
      width: `${w * columnStep - WORKSPACE_GAP}px`,
      ...(!hug && { height: `${h * WORKSPACE_ROW_STEP - WORKSPACE_GAP}px` }),
    });
    for (const [key, slot] of slots) {
      const previous = before.slots.get(key);
      if (!previous) continue;

      const dropped = release?.id === key ? release : null;
      const needsResize = key === DESTINATION && (previous.w !== slot.w || previous.h !== slot.h);
      if (!dropped && !needsResize && previous.x === slot.x && previous.y === slot.y) continue;

      const element = container.querySelector<HTMLElement>(`[data-tile="${key}"]`);
      if (!element) continue;

      const flight = glides.current.get(key);
      const flying = flight?.playState === "running";
      let [x, y] = flying ? displacement(element) : [0, 0];
      x += (previous.x - slot.x) * columnStep;
      y += (previous.y - slot.y) * WORKSPACE_ROW_STEP;
      if (dropped?.kind === "move") {
        x += dropped.dx;
        y += dropped.dy;
      }
      const hug = Boolean(cards[key]?.hug);
      const resized = dropped?.kind === "resize"
        ? { width: `${dropped.width}px`, ...(!hug && { height: `${dropped.height}px` }) }
        // An outline still changing size carries on from the size it has reached.
        : needsResize ? (flying ? { width: `${element.offsetWidth}px`, height: `${element.offsetHeight}px` } : pixels(previous)) : null;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && !resized) continue;

      flight?.cancel();
      const lifted = dropped ? { zIndex: 3 } : null;
      const glide = element.animate(
        [
          { translate: `${x}px ${y}px`, ...resized, ...lifted },
          { translate: "0px 0px", ...(resized && pixels(slot, hug)), ...lifted },
        ],
        {
          duration: key === DESTINATION ? motionDuration.press : dropped ? motionDuration.popover : motionDuration.move,
          easing: GLIDE_EASING,
        },
      );
      glides.current.set(key, glide);
      glide.onfinish = () => {
        if (glides.current.get(key) === glide) glides.current.delete(key);
      };
    }
  });

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (editing ? saveButton : customizeButton).current?.focus({ preventScroll: true });
  }, [editing]);

  /** The page's own arrangement, read from the screen: each card where it is and as large as it is. */
  function measureDefault(): WorkspaceLayout | null {
    const container = grid.current;
    const bounds = container?.getBoundingClientRect();
    if (!container || !bounds || bounds.width === 0) return null;
    const columnStep = (bounds.width + WORKSPACE_GAP) / WORKSPACE_COLUMNS;
    const boxes: LayoutItem[] = [];
    for (const id of ids) {
      const box = container.querySelector<HTMLElement>(`[data-tile="${id}"]`)?.getBoundingClientRect();
      if (!box || box.width === 0) continue;
      const { minW, minH, maxH } = limits(id);
      const x = clamp(Math.round((box.left - bounds.left) / columnStep), 0, WORKSPACE_COLUMNS - 1);
      const rows = Math.ceil((box.height + WORKSPACE_GAP) / WORKSPACE_ROW_STEP);
      boxes.push({
        id,
        x,
        y: Math.max(0, Math.round((box.top - bounds.top) / WORKSPACE_ROW_STEP)),
        w: clamp(Math.round((box.width + WORKSPACE_GAP) / columnStep), Math.min(minW, WORKSPACE_COLUMNS - x), WORKSPACE_COLUMNS - x),
        h: clamp(rows, minH, maxH),
      });
    }
    // Reading it back appends any card that is not on screen and applies the size limits.
    return boxes.length > 0 ? parseLayout(serializeLayout(packLayout(boxes)), ids, limits) : null;
  }

  function startEditing() {
    const start = saved ?? measureDefault();
    if (!start) return;
    moveFocus.current = true;
    setEdit({ layout: start, status: "unchanged" });
  }

  function closeEditor() {
    gesture.cancel();
    moveFocus.current = true;
    setEdit(null);
    setAnnouncement("");
  }

  function resetLayout() {
    gesture.cancel();
    // Lay the page out as written for a moment to learn where its cards go by default.
    measuring.current = true;
    flushSync(() => setEdit({ layout: null, status: "reset" }));
    const natural = measureDefault();
    measuring.current = false;
    setEdit(natural ? { layout: natural, status: "reset" } : null);
    setAnnouncement("");
  }

  function saveLayout() {
    if (!edit) return;
    if (edit.status === "unchanged" || base === null) {
      closeEditor();
      return;
    }
    const raw = edit.status === "reset" ? null : serializeLayout([...base, ...missing]);
    try {
      if (raw === null) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, raw);
      sessionLayouts.delete(storageKey);
      toast.success(t("dashboard.layoutSaved"));
    } catch {
      sessionLayouts.set(storageKey, { raw, storageAtFailure: readStorage(storageKey) });
      toast.warning(t("dashboard.layoutSaveError"));
    }
    window.dispatchEvent(new Event(SAVED_EVENT));
    closeEditor();
  }

  const workspace: WorkspaceState = {
    cards,
    grid,
    customized,
    positioned,
    editing,
    base,
    preview,
    slots,
    order,
    landing,
    helpId,
    limits,
    gesture,
    nudge(id, kind, x, y, used) {
      if (!base || preview) return;
      const next = nudgeCard(base, id, kind, x, y, limits);
      if (next !== base) commit(next, id, used, true);
    },
    canNudge: (id, kind, x, y) => base !== null && nudgeCard(base, id, kind, x, y, limits) !== base,
    reportHeight(id, rows) {
      setHeights((current) => (current.get(id) === rows ? current : new Map(current).set(id, rows)));
    },
    reportCeiling(id, rows) {
      setCeilings((current) => {
        if (rows === null ? !current.has(id) : current.get(id) === rows) return current;
        const next = new Map(current);
        if (rows === null) next.delete(id);
        else next.set(id, rows);
        return next;
      });
    },
    absent,
    reportPresence(id, shown) {
      setAbsent((current) => {
        if (current.has(id) !== shown) return current;
        const next = new Set(current);
        if (shown) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    startEditing,
    closeEditor,
    resetLayout,
    saveLayout,
    customizeButton,
    saveButton,
  };

  return (
    <WorkspaceContext.Provider value={workspace}>
      <div className="sr-only" role="status">{announcement}</div>
      {children}
    </WorkspaceContext.Provider>
  );
}

/**
 * The Customize button, and Reset / Cancel / Save while arranging. Place it in
 * the page's header. Arranging needs a wide screen, so it is hidden below `lg`.
 * `compact` leaves out the written hint, for rows without room for it.
 */
export function WorkspaceControls({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { t } = useLocale();
  const { editing, helpId, startEditing, closeEditor, resetLayout, saveLayout, customizeButton, saveButton } = useWorkspace();
  return (
    <div className={cn("hidden items-center gap-4 lg:flex", className)}>
      {editing ? (
        <>
          {compact ? null : (
            <p className="max-w-80 text-right text-xs leading-4 text-pretty text-muted-foreground xl:max-w-[30rem]">
              {t("dashboard.layoutHint")}
            </p>
          )}
          <span className="sr-only" id={helpId}>{t("dashboard.layoutKeyboard")}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={resetLayout}>{t("dashboard.resetLayout")}</Button>
            <Button variant="outline" size="sm" onClick={closeEditor}>{t("dashboard.cancelLayout")}</Button>
            <Button ref={saveButton} size="sm" onClick={saveLayout}>{t("dashboard.saveLayout")}</Button>
          </div>
        </>
      ) : (
        <Button ref={customizeButton} variant="outline" size="sm" onClick={startEditing}>
          <Pencil aria-hidden="true" />
          {t("dashboard.customize")}
        </Button>
      )}
    </div>
  );
}

/**
 * Holds the page's tiles. `className` lays them out by default; once a layout
 * is in effect the grid takes over and that class is dropped.
 */
export function WorkspaceGrid({ className, children }: { className?: string; children: ReactNode }) {
  const { grid, customized, positioned, editing, preview, landing } = useWorkspace();
  return (
    <div
      ref={grid}
      style={GRID_STYLE}
      className={cn(customized ? styles.custom : className, positioned && styles.positioned, editing && styles.editing)}
      data-gesture={preview?.kind}
    >
      {landing && <div className={styles.destination} data-tile={DESTINATION} style={slotStyle(landing, 0)} aria-hidden="true" />}
      {children}
    </div>
  );
}

/**
 * A wrapper that only arranges tiles (a row, a column, a titled section). It
 * dissolves once a layout is in effect, so its tiles land on the grid.
 */
export function TileGroup({
  as: Element = "div",
  className,
  children,
  ...props
}: {
  as?: "div" | "section";
  className?: string;
  children: ReactNode;
  id?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <Element {...props} data-tile-group="" className={className}>
      {children}
    </Element>
  );
}

/** Spread on headings and other chrome that belongs to the default layout only. */
export const DEFAULT_LAYOUT_ONLY = { "data-default-layout-only": "" } as const;

/** Card-shaped stand-in for a tile that has not been scrolled near yet. */
function TilePlaceholder({ minHeight }: { minHeight: number }) {
  return (
    <div aria-hidden {...TRANSIENT} className="card-surface flex flex-col overflow-hidden" style={{ minHeight }}>
      <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="space-y-3.5 p-4">
        {[46, 62, 38, 56].map((width) => (
          <div key={width} className="flex items-center justify-between gap-6">
            <Skeleton className="h-3" style={{ width: `${width}%` }} />
            <Skeleton className="h-3 w-14 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One card of the page. By default it is an invisible box around the card
 * (`className` places it in the page's own layout, and the card fills it).
 * On a customized page it is the card's slot, with the handles while arranging.
 *
 * `lazy` mounts the card only once it nears the viewport, holding its place
 * with a placeholder `placeholderHeight` tall until then.
 */
export function Tile({
  id,
  className,
  lazy = false,
  placeholderHeight = 320,
  children,
}: {
  id: string;
  className?: string;
  lazy?: boolean;
  placeholderHeight?: number;
  children: ReactNode;
}) {
  const { t } = useLocale();
  const workspace = useWorkspace();
  const { cards, customized, positioned, editing, base, preview, gesture, helpId, reportHeight, reportCeiling, reportPresence } = workspace;
  const element = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(!lazy);
  const card = cards[id];
  const title = card?.label ?? id;
  const hug = Boolean(card?.hug);
  const slot = workspace.slots.get(id);
  const item = base?.find((entry) => entry.id === id);
  // A hugging card that must span the page has nothing left to resize.
  const resizable = !hug || workspace.limits(id).minW < WORKSPACE_COLUMNS;
  const fill = positioned && !hug && slot !== undefined;
  const columns = slot?.w ?? 0;
  const rows = slot?.h ?? 0;
  const reportSpare = useCallback((spare: number | null) => {
    const height = element.current?.offsetHeight ?? 0;
    reportCeiling(id, spare === null || height === 0 ? null : Math.max(MIN_CEILING, Math.ceil((height - spare + WORKSPACE_GAP) / WORKSPACE_ROW_STEP)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reportCeiling only forwards to a state setter
  }, [id]);
  const panel = useMemo<PanelState>(() => ({ fill, columns, rows, reportSpare }), [fill, columns, rows, reportSpare]);

  useEffect(() => {
    const tile = element.current;
    if (!tile || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(tile);
    return () => observer.disconnect();
  }, [seen]);

  // Whether the card rendered anything: the tile's other children are its own controls.
  useLayoutEffect(() => {
    const tile = element.current;
    if (!tile) return;
    const check = () => reportPresence(id, Array.from(tile.children).some((child) => !child.hasAttribute("data-tile-chrome")));
    check();
    const observer = new MutationObserver(check);
    observer.observe(tile, { childList: true });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reportPresence only forwards to a state setter
  }, [id]);

  const measured = positioned && hug;
  const held = useRef(rows);
  useLayoutEffect(() => {
    held.current = rows;
  }, [rows]);
  useLayoutEffect(() => {
    const tile = element.current;
    if (!tile || !measured) return;
    const report = () => {
      if (tile.offsetHeight === 0) return;
      const height = Math.ceil((tile.offsetHeight + WORKSPACE_GAP) / WORKSPACE_ROW_STEP);
      // A placeholder keeps the height the card had (it may need more, never less);
      // only real content makes the card shorter.
      if (height <= held.current && tile.querySelector("[data-transient]")) return;
      reportHeight(id, height);
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(tile);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reportHeight only forwards to a state setter
  }, [id, measured]);

  const handle = (kind: LayoutChange) => {
    if (!item || !base) return null;
    const name = t(kind === "move" ? "dashboard.moveCard" : "dashboard.resizeCard", { card: title });
    return (
      <button
        type="button"
        className={cn(styles.handle, kind === "move" ? styles.move : styles.resize)}
        data-control={kind}
        data-tile-chrome=""
        aria-label={name}
        aria-describedby={helpId}
        title={name}
        // The press belongs to the gesture: it must not select text or start a native drag.
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event: PointerEvent<HTMLButtonElement>) => gesture.start(event, item, kind, base)}
        onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
          const adjustment = adjustments.find(({ key, kind: target }) => key === event.key && target === kind);
          if (!adjustment) return;
          event.preventDefault();
          workspace.nudge(id, kind, adjustment.x, adjustment.y, kind);
        }}
      >
        {kind === "move" ? <GripHorizontal aria-hidden="true" size={15} /> : (
          <svg aria-hidden="true" width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M22.5 9v6.5a7 7 0 0 1-7 7H9" />
          </svg>
        )}
      </button>
    );
  };

  return (
    <div
      ref={element}
      data-tile={id}
      data-hug={hug ? "" : undefined}
      data-absent={workspace.absent.has(id) ? "" : undefined}
      data-gesture={preview?.id === id ? preview.kind : undefined}
      className={cn(styles.tile, !customized && className)}
      style={slot ? slotStyle(slot, workspace.order.get(id) ?? 0) : undefined}
    >
      <PanelProvider value={panel}>{seen ? children : <TilePlaceholder minHeight={customized ? 0 : placeholderHeight} />}</PanelProvider>
      {editing && item && base && (
        <>
          <div className={styles.grabber} data-tile-chrome="">
            {handle("move")}
            <ReleaseMenu trigger={
              <button
                type="button"
                className={styles.handle}
                data-control="options"
                aria-label={t("dashboard.cardOptions", { card: title })}
                title={t("dashboard.cardOptions", { card: title })}
              >
                <Ellipsis aria-hidden="true" size={15} />
              </button>
            }>
              <Menu.Portal>
                <Menu.Positioner align="center" sideOffset={6} className="z-[90]">
                  <MotionMenuPopup className="min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                    {adjustments.filter(({ kind, y }) => kind === "move" || (resizable && (!hug || y === 0))).map((adjustment) => (
                      <Menu.Item
                        key={adjustment.label}
                        disabled={!workspace.canNudge(id, adjustment.kind, adjustment.x, adjustment.y)}
                        className="cursor-default rounded-sm px-2 py-1.5 text-xs outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-muted"
                        onClick={() => workspace.nudge(id, adjustment.kind, adjustment.x, adjustment.y, "options")}
                      >
                        {t(adjustment.label)}
                      </Menu.Item>
                    ))}
                  </MotionMenuPopup>
                </Menu.Positioner>
              </Menu.Portal>
            </ReleaseMenu>
          </div>
          {resizable && handle("resize")}
        </>
      )}
    </div>
  );
}
