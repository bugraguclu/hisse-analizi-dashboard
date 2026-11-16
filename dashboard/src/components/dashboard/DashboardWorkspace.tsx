"use client";

import { memo, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Menu } from "@base-ui/react/menu";
import { Ellipsis, GripHorizontal, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useMediaQuery } from "@/components/charts/use-coarse-pointer";
import { Button } from "@/components/ui/button";
import { MotionMenuPopup, ReleaseMenu } from "@/components/ui/motion-surface";
import { motionScrollBehavior, prefersReducedMotion } from "@/hooks/use-motion-allowed";
import type { TranslationKey } from "@/lib/i18n";
import { useLocale } from "@/lib/locale-context";
import { cubicBezier, motionCurve, motionDuration } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { IndexChartCard } from "./IndexChartCard";
import { LatestEventsCard } from "./LatestEventsCard";
import { MarketBreadthCard } from "./MarketBreadthCard";
import { MarketHeader } from "./MarketHeader";
import { WatchlistCard } from "./WatchlistCard";
import {
  CARD_LIMITS,
  DASHBOARD_COLUMNS,
  DASHBOARD_DESKTOP_QUERY,
  DASHBOARD_GAP,
  DASHBOARD_ROW_STEP,
  DEFAULT_LAYOUT,
  nudgeCard,
  parseLayout,
  readingOrder,
  serializeLayout,
  type CardId,
  type DashboardLayout,
  type LayoutChange,
  type LayoutItem,
} from "./layout-model";
import { useLayoutGesture, type GestureRelease } from "./use-layout-gesture";
import styles from "./dashboard-workspace.module.css";

const STORAGE_KEY = "hisse.dashboard.layout";
const DESTINATION = "destination";
const GLIDE_EASING = cubicBezier(motionCurve.easeOut);
const GRID_STYLE = {
  "--grid-columns": DASHBOARD_COLUMNS,
  "--grid-gap": `${DASHBOARD_GAP}px`,
  "--row-step": `${DASHBOARD_ROW_STEP}px`,
} as CSSProperties;
// Memoized: a layout change repositions the cards without rendering their contents again.
const panels = {
  index: { Panel: memo(IndexChartCard), label: "BIST 100" },
  watchlist: { Panel: memo(WatchlistCard), label: "dashboard.watchlist" },
  breadth: { Panel: memo(MarketBreadthCard), label: "dashboard.breadth" },
  events: { Panel: memo(LatestEventsCard), label: "dashboard.latestDevelopments" },
} as const;
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
/** `layout` is null only while the default card heights are being measured. */
type Edit = { layout: DashboardLayout | null; status: "unchanged" | "changed" | "reset" };
let sessionLayout: { raw: string | null; storageAtFailure: string | null } | null = null;

function getBrowserLayout() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function getSavedLayout() {
  const stored = getBrowserLayout();
  return sessionLayout?.storageAtFailure === stored ? sessionLayout.raw : stored;
}

function subscribe(onChange: () => void) {
  function handleStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  }
  window.addEventListener("storage", handleStorage);
  window.addEventListener("dashboard-layout-saved", onChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("dashboard-layout-saved", onChange);
  };
}

function slotStyle({ x, y, w, h }: LayoutItem): CSSProperties {
  return { "--column": x + 1, "--row": y + 1, "--columns": w, "--rows": h } as CSSProperties;
}

/** The default arrangement, with every card tall enough for what it currently shows. */
function measureDefault(grid: HTMLDivElement | null): DashboardLayout {
  if (!grid) return DEFAULT_LAYOUT;
  const heights = new Map(DEFAULT_LAYOUT.map(({ id, h }) => {
    const panel = grid.querySelector<HTMLElement>(`[data-card="${id}"]`);
    const { minH, maxH } = CARD_LIMITS[id];
    const measured = panel ? Math.ceil((panel.offsetHeight + DASHBOARD_GAP) / DASHBOARD_ROW_STEP) : h;
    return [id, Math.max(minH, Math.min(measured, maxH))];
  }));
  return DEFAULT_LAYOUT.map((item) => ({
    ...item,
    h: heights.get(item.id) ?? item.h,
    y: item.id === "events" ? (heights.get("index") ?? item.y)
      : item.id === "breadth" ? (heights.get("watchlist") ?? item.y)
      : 0,
  }));
}

/** How far a glide still in flight has the element displaced. */
function displacement(element: HTMLElement): [number, number] {
  const [x = 0, y = 0] = getComputedStyle(element).translate.split(" ").map(Number.parseFloat);
  return [x || 0, y || 0];
}

export function DashboardWorkspace() {
  const { t } = useLocale();
  const desktop = useMediaQuery(DASHBOARD_DESKTOP_QUERY);
  const stored = useSyncExternalStore(subscribe, getSavedLayout, () => null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const customize = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const measuring = useRef(false);
  const shown = useRef<{ width: number; slots: Map<string, LayoutItem> } | null>(null);
  const glides = useRef(new Map<string, Animation>());
  const released = useRef<GestureRelease | null>(null);
  const control = useRef<{ id: CardId; kind: Control; reveal: boolean } | null>(null);
  const helpId = useId();
  const saved = parseLayout(stored);
  const editing = desktop && edit !== null;

  function describe(item: LayoutItem) {
    const { label } = panels[item.id];
    return t("dashboard.layoutPosition", {
      card: label === "BIST 100" ? label : t(label),
      column: item.x + 1,
      row: item.y + 1,
      width: item.w,
      height: item.h,
    });
  }

  function commit(layout: DashboardLayout, id: CardId, kind: Control, reveal: boolean) {
    control.current = { id, kind, reveal };
    setEdit({ layout, status: "changed" });
    const item = layout.find((entry) => entry.id === id);
    if (item) setAnnouncement(describe(item));
  }

  const gesture = useLayoutGesture(grid, editing, (release) => {
    released.current = release;
    if (release.changed) commit(release.layout, release.id, release.kind, false);
  });
  const base = editing ? edit.layout : saved;
  const preview = base ? gesture.preview : null;
  const layout = preview?.layout ?? base;
  // Keep the DOM order stable during a gesture so focus and pointer capture stay on the original handle.
  const items = base ? readingOrder(base) : DEFAULT_LAYOUT;
  const positioned = desktop && layout !== null;
  const naturalDesktop = desktop && !layout;
  // A card being dragged stays in its starting slot and floats from there; the outline marks where it will land.
  const slots = new Map<string, LayoutItem>();
  if (positioned) {
    for (const item of layout) slots.set(item.id, preview?.id === item.id ? base?.find(({ id }) => id === item.id) ?? item : item);
  }
  const landing = positioned && preview ? layout.find(({ id }) => id === preview.id) : undefined;
  if (landing) slots.set(DESTINATION, landing);

  useLayoutEffect(() => {
    const container = grid.current;
    const index = container?.querySelector<HTMLElement>('[data-card="index"]');
    if (!naturalDesktop || !container || !index) return;
    // The two default stacks grow independently, even with a very long watchlist.
    const placeEvents = () => container.style.setProperty("--index-end", `${index.getBoundingClientRect().height + DASHBOARD_GAP}px`);
    placeEvents();
    container.dataset.naturalStacks = "true";
    const observer = new ResizeObserver(placeEvents);
    observer.observe(index);
    return () => {
      observer.disconnect();
      delete container.dataset.naturalStacks;
      container.style.removeProperty("--index-end");
    };
  }, [naturalDesktop]);

  // Runs after every render: cards glide from where they were on screen to their new slots.
  useLayoutEffect(() => {
    const container = grid.current;
    if (!container || measuring.current) return;
    const before = shown.current;
    const release = released.current;
    const focus = control.current;
    released.current = null;
    control.current = null;
    shown.current = slots.size > 0 ? { width: container.offsetWidth, slots } : null;

    // Reordering the cards in the DOM can drop focus from the control that was just used.
    const used = focus && container.querySelector<HTMLElement>(`[data-card="${focus.id}"] [data-control="${focus.kind}"]`);
    if (used) {
      if (document.activeElement !== used) used.focus({ preventScroll: true });
      if (focus.reveal) used.closest("[data-card]")?.scrollIntoView({ block: "nearest", behavior: motionScrollBehavior() });
    }

    if (!before || before.width !== container.offsetWidth || prefersReducedMotion()) return;
    const columnStep = (container.offsetWidth + DASHBOARD_GAP) / DASHBOARD_COLUMNS;
    const pixels = ({ w, h }: LayoutItem) => ({ width: `${w * columnStep - DASHBOARD_GAP}px`, height: `${h * DASHBOARD_ROW_STEP - DASHBOARD_GAP}px` });
    for (const [key, slot] of slots) {
      const previous = before.slots.get(key);
      const element = container.querySelector<HTMLElement>(`[data-slot="${key}"]`);
      if (!previous || !element) continue;

      const dropped = release?.id === key ? release : null;
      const flight = glides.current.get(key);
      let [x, y] = flight?.playState === "running" ? displacement(element) : [0, 0];
      x += (previous.x - slot.x) * columnStep;
      y += (previous.y - slot.y) * DASHBOARD_ROW_STEP;
      if (dropped?.kind === "move") {
        x += dropped.dx;
        y += dropped.dy;
      }
      const resized = dropped?.kind === "resize"
        ? { width: `${dropped.width}px`, height: `${dropped.height}px` }
        : key === DESTINATION && (previous.w !== slot.w || previous.h !== slot.h) ? pixels(previous) : null;
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && !resized) continue;

      flight?.cancel();
      const lifted = dropped ? { zIndex: 3 } : null;
      const glide = element.animate(
        [
          { translate: `${x}px ${y}px`, ...resized, ...lifted },
          { translate: "0px 0px", ...(resized && pixels(slot)), ...lifted },
        ],
        {
          duration: key === DESTINATION ? motionDuration.press : dropped ? motionDuration.popover : motionDuration.move,
          easing: GLIDE_EASING,
        },
      );
      glides.current.set(key, glide);
    }
  });

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (editing ? saveButton : customize).current?.focus({ preventScroll: true });
  }, [editing]);

  function startEditing() {
    moveFocus.current = true;
    setEdit({ layout: saved ?? measureDefault(grid.current), status: "unchanged" });
  }

  function closeEditor() {
    gesture.cancel();
    moveFocus.current = true;
    setEdit(null);
    setAnnouncement("");
  }

  function resetLayout() {
    gesture.cancel();
    // Lay the cards out at their natural heights for a moment to learn how tall the defaults are.
    measuring.current = true;
    flushSync(() => setEdit({ layout: null, status: "reset" }));
    const natural = measureDefault(grid.current);
    measuring.current = false;
    setEdit({ layout: natural, status: "reset" });
    setAnnouncement("");
  }

  function saveLayout() {
    if (!edit) return;
    if (edit.status === "unchanged" || edit.layout === null) {
      closeEditor();
      return;
    }
    const raw = edit.status === "reset" ? null : serializeLayout(edit.layout);
    try {
      if (raw === null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, raw);
      sessionLayout = null;
      toast.success(t("dashboard.layoutSaved"));
    } catch {
      sessionLayout = { raw, storageAtFailure: getBrowserLayout() };
      toast.warning(t("dashboard.layoutSaveError"));
    }
    window.dispatchEvent(new Event("dashboard-layout-saved"));
    closeEditor();
  }

  function adjustWithKeys(event: KeyboardEvent<HTMLButtonElement>, id: CardId, kind: LayoutChange) {
    const adjustment = adjustments.find(({ key, kind: target }) => key === event.key && target === kind);
    if (!adjustment || !base || preview) return;
    event.preventDefault();
    const next = nudgeCard(base, id, kind, adjustment.x, adjustment.y);
    if (next !== base) commit(next, id, kind, true);
  }

  return (
    <>
      <MarketHeader actions={
        <div className="hidden items-center gap-4 lg:flex">
          {editing ? (
            <>
              <p className="max-w-80 text-right text-xs leading-4 text-pretty text-muted-foreground xl:max-w-[30rem]">
                {t("dashboard.layoutHint")}
                <span className="sr-only" id={helpId}>{t("dashboard.layoutKeyboard")}</span>
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={resetLayout}>{t("dashboard.resetLayout")}</Button>
                <Button variant="outline" size="sm" onClick={closeEditor}>{t("dashboard.cancelLayout")}</Button>
                <Button ref={saveButton} size="sm" onClick={saveLayout}>{t("dashboard.saveLayout")}</Button>
              </div>
            </>
          ) : (
            <Button ref={customize} variant="outline" size="sm" onClick={startEditing}>
              <Pencil aria-hidden="true" />
              {t("dashboard.customize")}
            </Button>
          )}
        </div>
      } />

      <div className="sr-only" role="status">{announcement}</div>

      <div
        ref={grid}
        style={GRID_STYLE}
        className={cn(styles.grid, positioned && styles.positioned, editing && styles.editing)}
        data-gesture={preview?.kind}
      >
        {landing && <div className={styles.destination} data-slot={DESTINATION} style={slotStyle(landing)} aria-hidden="true" />}
        {items.map(({ id }) => {
          const { Panel, label } = panels[id];
          const title = label === "BIST 100" ? label : t(label);
          const slot = slots.get(id);
          const item = base?.find((entry) => entry.id === id);

          const handle = (kind: LayoutChange) => {
            if (!item || !base) return null;
            const name = t(kind === "move" ? "dashboard.moveCard" : "dashboard.resizeCard", { card: title });
            return (
              <button
                type="button"
                className={cn(styles.handle, kind === "move" ? styles.move : styles.resize)}
                data-control={kind}
                aria-label={name}
                aria-describedby={helpId}
                title={name}
                onPointerDown={(event) => gesture.start(event, item, kind, base)}
                onPointerMove={gesture.move}
                onPointerUp={gesture.end}
                onPointerCancel={gesture.cancelPointer}
                onLostPointerCapture={gesture.cancelPointer}
                onKeyDown={(event) => adjustWithKeys(event, id, kind)}
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
              key={id}
              data-card={id}
              data-slot={id}
              className={styles.tile}
              data-gesture={preview?.id === id ? preview.kind : undefined}
              style={slot ? slotStyle(slot) : undefined}
            >
              <Panel fillPanel={positioned} />
              {editing && item && base && (
                <>
                  <div className={styles.grabber}>
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
                            {adjustments.map((adjustment) => {
                              const next = nudgeCard(base, id, adjustment.kind, adjustment.x, adjustment.y);
                              return (
                                <Menu.Item
                                  key={adjustment.label}
                                  disabled={next === base}
                                  className="cursor-default rounded-sm px-2 py-1.5 text-xs outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-muted"
                                  onClick={() => commit(next, id, "options", true)}
                                >
                                  {t(adjustment.label)}
                                </Menu.Item>
                              );
                            })}
                          </MotionMenuPopup>
                        </Menu.Positioner>
                      </Menu.Portal>
                    </ReleaseMenu>
                  </div>
                  {handle("resize")}
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
