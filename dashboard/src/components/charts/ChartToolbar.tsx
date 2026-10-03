"use client";

import type { ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  CalendarClock,
  Camera,
  Check,
  ChevronDown,
  Copy,
  Download,
  Ellipsis,
  Keyboard,
  Maximize2,
  PenLine,
  RotateCcw,
  Ruler,
  Settings2,
  Table2,
  Target,
  Wallet,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartPeriod } from "@/types";
import { ChartTypeIcon } from "./chart-icons";
import { ComparePicker, type CompareChoice, type CompareItem, type CompareSuggestion } from "./ComparePicker";
import { CheckMark, ChipButton, MENU_GROUP_LABEL_CLASS, MENU_ITEM_CLASS, POPUP_CLASS, RadioMark, ToolbarDivider, ToolButton } from "./controls";
import { useChartI18n, type ChartKey } from "./i18n";
import { IndicatorMenu } from "./IndicatorMenu";
import { CHART_TYPES, type ChartPrefs } from "./prefs";
import type { ChartType, PriceScaleKind } from "./types";
import { UnitMenu } from "./UnitMenu";

export interface ToolbarFeatures {
  indicators: boolean;
  compare: boolean;
  drawings: boolean;
  events: boolean;
}

const TYPE_LABEL: Record<ChartType, { label: ChartKey; title: ChartKey }> = {
  area: { label: "type.area", title: "type.area.title" },
  line: { label: "type.line", title: "type.line.title" },
  baseline: { label: "type.baseline", title: "type.baseline.title" },
  candles: { label: "type.candles", title: "type.candles.title" },
  hollow: { label: "type.hollow", title: "type.hollow.title" },
  heikin: { label: "type.heikin", title: "type.heikin.title" },
  bars: { label: "type.bars", title: "type.bars.title" },
};

const SCALE_LABEL: Record<PriceScaleKind, ChartKey> = { normal: "scale.normal", log: "scale.log", percent: "scale.percent" };

const ITEM_CLASS = MENU_ITEM_CLASS;
const GROUP_LABEL_CLASS = MENU_GROUP_LABEL_CLASS;
const ITEM_ICON_CLASS = "h-3.5 w-3.5 text-muted-foreground";

type SetPref = <K extends keyof ChartPrefs>(key: K, value: ChartPrefs[K]) => void;

function MenuPopup({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end"; className?: string }) {
  return (
    <Menu.Portal>
      <Menu.Positioner side="bottom" align={align} sideOffset={6} collisionPadding={12} className="z-[90]">
        {/* Long menus scroll inside the viewport (landscape phones, short windows). */}
        <Menu.Popup className={cn(POPUP_CLASS, "max-h-[var(--available-height)] min-w-52 overflow-y-auto overscroll-contain p-1 scrollbar-thin", className)}>
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

function MenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}

function TypeMenu({ value, onChange, compact }: { value: ChartType; onChange: (type: ChartType) => void; compact: boolean }) {
  const { t } = useChartI18n();
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <ChipButton aria-label={`${t("type.label")}: ${t(TYPE_LABEL[value].label)}`} title={t("type.label")} className="border-border">
            <ChartTypeIcon type={value} />
            {compact ? null : <span>{t(TYPE_LABEL[value].label)}</span>}
            <ChevronDown className="!h-3 !w-3 text-muted-foreground" />
          </ChipButton>
        }
      />
      <MenuPopup align="start">
        <Menu.Group>
          <Menu.GroupLabel className={GROUP_LABEL_CLASS}>{t("type.label")}</Menu.GroupLabel>
          <Menu.RadioGroup value={value} onValueChange={(next: ChartType) => onChange(next)}>
            {CHART_TYPES.map((type) => (
              <Menu.RadioItem key={type} value={type} className={ITEM_CLASS} closeOnClick>
                <ChartTypeIcon type={type} className="text-muted-foreground" />
                <span className="flex-1">
                  <span className="block">{t(TYPE_LABEL[type].label)}</span>
                  <span className="block text-[10px] leading-3 text-muted-foreground">{t(TYPE_LABEL[type].title)}</span>
                </span>
                {type === value ? <Check aria-hidden className="h-3.5 w-3.5" /> : null}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.Group>
      </MenuPopup>
    </Menu.Root>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <Menu.CheckboxItem className={ITEM_CLASS} checked={checked} onCheckedChange={onChange} closeOnClick={false}>
      <CheckMark checked={checked} />
      {children}
    </Menu.CheckboxItem>
  );
}

/** What is drawn besides the series: volume, events, analyst targets, high/low labels, (watermark), grid. */
function DisplayGroup({
  prefs,
  set,
  hasVolume,
  events,
  targets,
  watermark,
  label,
}: {
  prefs: ChartPrefs;
  set: SetPref;
  hasVolume: boolean;
  events: boolean;
  targets: ChartToolbarProps["targets"];
  watermark: boolean;
  label: ChartKey;
}) {
  const { t } = useChartI18n();
  return (
    <Menu.Group>
      <Menu.GroupLabel className={GROUP_LABEL_CLASS}>{t(label)}</Menu.GroupLabel>
      {hasVolume ? (
        <Toggle checked={prefs.volume} onChange={(on) => set("volume", on)}>
          {t("settings.volume")}
        </Toggle>
      ) : null}
      {events ? (
        <Toggle checked={prefs.events} onChange={(on) => set("events", on)}>
          {t("settings.events")}
        </Toggle>
      ) : null}
      {targets ? (
        <Toggle checked={targets.on} onChange={targets.onChange}>
          <span className="flex-1">{t("targets.toggle")}</span>
          <Target aria-hidden className={ITEM_ICON_CLASS} />
        </Toggle>
      ) : null}
      <Toggle checked={prefs.extremes} onChange={(on) => set("extremes", on)}>
        {t("settings.extremes")}
      </Toggle>
      {watermark ? (
        <Toggle checked={prefs.watermark} onChange={(on) => set("watermark", on)}>
          {t("settings.watermark")}
        </Toggle>
      ) : null}
      <Toggle checked={prefs.grid} onChange={(on) => set("grid", on)}>
        {t("settings.grid")}
      </Toggle>
    </Menu.Group>
  );
}

/** Price axis: normal, logarithmic or % (locked to % while comparing). */
function ScaleGroup({ prefs, set, comparing }: { prefs: ChartPrefs; set: SetPref; comparing: boolean }) {
  const { t } = useChartI18n();
  const value = comparing ? "percent" : prefs.scale;
  return (
    <Menu.Group>
      <Menu.GroupLabel className={GROUP_LABEL_CLASS}>{t("settings.scale")}</Menu.GroupLabel>
      <Menu.RadioGroup value={value} onValueChange={(scale: PriceScaleKind) => set("scale", scale)} disabled={comparing}>
        {(["normal", "log", "percent"] as const).map((scale) => (
          <Menu.RadioItem key={scale} value={scale} className={ITEM_CLASS} closeOnClick={false}>
            <RadioMark checked={value === scale} />
            <span className="flex-1">{t(SCALE_LABEL[scale])}</span>
            {scale !== "normal" ? <kbd className="font-mono text-[10px] text-muted-foreground">{scale === "log" ? "Alt+L" : "Alt+P"}</kbd> : null}
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
      {comparing ? <p className="px-2 pb-1 text-[10px] leading-3 text-muted-foreground">{t("scale.compareLocked")}</p> : null}
    </Menu.Group>
  );
}

function SnapshotItems({ onSnapshot }: { onSnapshot: (action: "download" | "copy") => void }) {
  const { t } = useChartI18n();
  return (
    <>
      <Menu.Item className={ITEM_CLASS} onClick={() => onSnapshot("download")}>
        <Download aria-hidden className={ITEM_ICON_CLASS} />
        <span className="flex-1">{t("snapshot.download")}</span>
        <kbd className="font-mono text-[10px] text-muted-foreground">Alt+S</kbd>
      </Menu.Item>
      <Menu.Item className={ITEM_CLASS} onClick={() => onSnapshot("copy")}>
        <Copy aria-hidden className={ITEM_ICON_CLASS} />
        <span className="flex-1">{t("snapshot.copy")}</span>
      </Menu.Item>
    </>
  );
}

/** The viewer's average cost, keyboard shortcuts and "restore the default setup". */
function SetupItems({ onCostEdit, onShortcuts, onReset }: { onCostEdit: (() => void) | null; onShortcuts: () => void; onReset: () => void }) {
  const { t } = useChartI18n();
  return (
    <>
      {onCostEdit ? (
        <Menu.Item className={ITEM_CLASS} onClick={onCostEdit}>
          <Wallet aria-hidden className={ITEM_ICON_CLASS} />
          <span className="flex-1">{t("cost.edit")}</span>
        </Menu.Item>
      ) : null}
      <Menu.Item className={ITEM_CLASS} onClick={onShortcuts}>
        <Keyboard aria-hidden className={ITEM_ICON_CLASS} />
        <span className="flex-1">{t("settings.shortcuts")}</span>
        <kbd className="font-mono text-[10px] text-muted-foreground">?</kbd>
      </Menu.Item>
      <Menu.Item className={ITEM_CLASS} onClick={onReset}>
        <RotateCcw aria-hidden className={ITEM_ICON_CLASS} />
        {t("settings.reset")}
      </Menu.Item>
    </>
  );
}

export interface ChartToolbarProps {
  mode: "card" | "fullscreen";
  /**
   * The card's row: style, unit, indicators, comparison and a "Diğer" menu with everything
   * else (display, scale, drawing, table, snapshot). Full screen keeps every control in view.
   */
  simple: boolean;
  prefs: ChartPrefs;
  onPrefsChange: (next: ChartPrefs) => void;
  /** Stable defaults for "restore default setup". */
  defaults: ChartPrefs;
  /** Units are offered per period (euros, gold and real lira need daily or weekly bars). */
  period: ChartPeriod;
  features: ToolbarFeatures;
  intraday: boolean;
  hasVolume: boolean;
  indicatorsOpen: boolean;
  onIndicatorsOpenChange: (open: boolean) => void;
  compare: {
    items: readonly CompareItem[];
    onAdd: (choice: CompareChoice) => void;
    onRemove: (symbol: string) => void;
    onClear: () => void;
    exclude: string;
    suggestions?: ReadonlyArray<CompareSuggestion>;
  } | null;
  /** The horizontal drawing strip is open (card, or full screen on phones). */
  drawOpen: boolean;
  /** Offer the strip toggle (full screen on wider screens has the drawing rail instead). */
  showDrawToggle: boolean;
  onDrawOpenChange: (open: boolean) => void;
  drawingCount: number;
  measureOn: boolean;
  onMeasureChange: (on: boolean) => void;
  /** A plain drag measures already (cards): no separate measure entry. */
  dragMeasure: boolean;
  tableOn: boolean;
  onTableChange: (on: boolean) => void;
  onFullscreen: () => void;
  zoomed: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onSnapshot: (action: "download" | "copy") => void;
  onShortcuts: () => void;
  /** Analyst target fan on/off; null when the chart has none. */
  targets: { on: boolean; onChange: (on: boolean) => void } | null;
  /** Opens the viewer's average-cost editor; null when the chart has no cost line. */
  onCostEdit: (() => void) | null;
  /** Phone width: icon-only chips. */
  compact: boolean;
  className?: string;
}

type RestProps = ChartToolbarProps & { set: SetPref; fullscreenButton: ReactNode };

/**
 * The chart's tool row: style, unit, indicators, comparison, drawing and events on the
 * left (the things that change what is drawn), view commands, snapshot, settings and
 * full screen on the right; wraps into two rows on phones. Cards get the `simple` row.
 */
export function ChartToolbar(props: ChartToolbarProps) {
  const { mode, simple, prefs, onPrefsChange, period, features, intraday, hasVolume, indicatorsOpen, onIndicatorsOpenChange, compare, compact, onFullscreen, className } =
    props;
  const { t } = useChartI18n();
  const set: SetPref = (key, value) => onPrefsChange({ ...prefs, [key]: value });
  const fullscreenButton =
    mode === "card" ? (
      <ChipButton data-chart-action="fullscreen" onClick={onFullscreen} title={t("action.fullscreen")} className="ml-0.5 border-border px-2">
        <Maximize2 />
        <span className="hidden sm:inline">{t("action.fullscreenShort")}</span>
      </ChipButton>
    ) : null;

  return (
    <div role="toolbar" aria-label={t("action.toolbar")} className={cn("flex items-center gap-x-1", !simple && "flex-wrap gap-y-1.5", className)}>
      <TypeMenu value={prefs.type} onChange={(type) => set("type", type)} compact={compact} />
      <UnitMenu value={prefs.unit} onChange={(unit) => set("unit", unit)} period={period} compact={compact} />
      {features.indicators ? (
        <IndicatorMenu
          indicators={prefs.indicators}
          onChange={(indicators) => set("indicators", indicators)}
          intraday={intraday}
          hasVolume={hasVolume}
          volume={prefs.volume}
          onVolumeChange={(on) => set("volume", on)}
          open={indicatorsOpen}
          onOpenChange={onIndicatorsOpenChange}
          compact={compact}
        />
      ) : null}
      {compare ? (
        <ComparePicker
          items={compare.items}
          onAdd={compare.onAdd}
          onRemove={compare.onRemove}
          onClear={compare.onClear}
          exclude={compare.exclude}
          compact={compact}
          suggestions={compare.suggestions}
        />
      ) : null}
      {simple ? <SimpleRest {...props} set={set} fullscreenButton={fullscreenButton} /> : <FullRest {...props} set={set} fullscreenButton={fullscreenButton} />}
    </div>
  );
}

/** Card: the drawing chip only while drawings exist, the measure chip only while measuring; the rest under "Diğer". */
function SimpleRest({
  prefs,
  onPrefsChange,
  defaults,
  features,
  hasVolume,
  compare,
  drawOpen,
  showDrawToggle,
  onDrawOpenChange,
  drawingCount,
  measureOn,
  onMeasureChange,
  dragMeasure,
  tableOn,
  onTableChange,
  onSnapshot,
  onShortcuts,
  targets,
  onCostEdit,
  compact,
  set,
  fullscreenButton,
}: RestProps) {
  const { t } = useChartI18n();
  const comparing = (compare?.items.length ?? 0) > 0;
  return (
    <>
      {showDrawToggle && (drawOpen || drawingCount > 0) ? (
        <ChipButton pressed={drawOpen} onClick={() => onDrawOpenChange(!drawOpen)} title={t("draw.title")} aria-label={compact ? t("draw.button") : undefined}>
          <PenLine />
          {compact ? null : t("draw.button")}
          {drawingCount > 0 ? <span className="rounded-sm bg-muted px-1 font-mono text-[10px] leading-4 text-foreground tabular-nums">{drawingCount}</span> : null}
        </ChipButton>
      ) : null}
      {measureOn ? (
        <ChipButton pressed onClick={() => onMeasureChange(false)} title={t("action.measureOn")} aria-label={compact ? t("action.measure") : undefined}>
          <Ruler />
          {compact ? null : t("action.measure")}
        </ChipButton>
      ) : null}
      <div className="ml-auto flex items-center gap-0.5">
        <Menu.Root>
          <Menu.Trigger
            render={
              <ChipButton title={t("more.title")} aria-label={t("more.title")} className="px-1.5">
                <Ellipsis />
                {compact ? null : <span>{t("more.button")}</span>}
              </ChipButton>
            }
          />
          <MenuPopup className="min-w-64">
            <DisplayGroup prefs={prefs} set={set} hasVolume={hasVolume} events={features.events} targets={targets} watermark={false} label="more.view" />
            <MenuSeparator />
            <ScaleGroup prefs={prefs} set={set} comparing={comparing} />
            <MenuSeparator />
            <Menu.Group>
              <Menu.GroupLabel className={GROUP_LABEL_CLASS}>{t("more.tools")}</Menu.GroupLabel>
              {showDrawToggle ? (
                <Menu.Item className={ITEM_CLASS} onClick={() => onDrawOpenChange(!drawOpen)}>
                  <PenLine aria-hidden className={ITEM_ICON_CLASS} />
                  <span className="flex-1">{t("more.draw")}</span>
                </Menu.Item>
              ) : null}
              {dragMeasure ? null : (
                <Menu.Item className={ITEM_CLASS} onClick={() => onMeasureChange(!measureOn)}>
                  <Ruler aria-hidden className={ITEM_ICON_CLASS} />
                  <span className="flex-1">{t("more.measure")}</span>
                </Menu.Item>
              )}
              <Toggle checked={tableOn} onChange={onTableChange}>
                <span className="flex-1">{t("more.table")}</span>
                <Table2 aria-hidden className={ITEM_ICON_CLASS} />
              </Toggle>
            </Menu.Group>
            <MenuSeparator />
            <SnapshotItems onSnapshot={onSnapshot} />
            <MenuSeparator />
            <SetupItems onCostEdit={onCostEdit} onShortcuts={onShortcuts} onReset={() => onPrefsChange(defaults)} />
          </MenuPopup>
        </Menu.Root>
        {fullscreenButton}
      </div>
    </>
  );
}

/** Full screen: every tool in view. */
function FullRest({
  prefs,
  onPrefsChange,
  defaults,
  features,
  hasVolume,
  compare,
  drawOpen,
  showDrawToggle,
  onDrawOpenChange,
  drawingCount,
  measureOn,
  onMeasureChange,
  tableOn,
  onTableChange,
  zoomed,
  onZoomIn,
  onZoomOut,
  onReset,
  onSnapshot,
  onShortcuts,
  targets,
  onCostEdit,
  compact,
  set,
  fullscreenButton,
}: RestProps) {
  const { t } = useChartI18n();
  const comparing = (compare?.items.length ?? 0) > 0;
  return (
    <>
      {showDrawToggle ? (
        <ChipButton pressed={drawOpen} onClick={() => onDrawOpenChange(!drawOpen)} title={t("draw.title")} aria-label={compact ? t("draw.button") : undefined}>
          <PenLine />
          {compact ? null : t("draw.button")}
          {drawingCount > 0 ? <span className="rounded-sm bg-muted px-1 font-mono text-[10px] leading-4 text-foreground tabular-nums">{drawingCount}</span> : null}
        </ChipButton>
      ) : null}
      {features.events ? (
        <ChipButton pressed={prefs.events} onClick={() => set("events", !prefs.events)} title={t("events.title")} aria-label={compact ? t("events.button") : undefined}>
          <CalendarClock />
          {compact ? null : t("events.button")}
        </ChipButton>
      ) : null}

      <div className="ml-auto flex items-center gap-0.5">
        {showDrawToggle || !features.drawings ? (
          <ToolButton label={measureOn ? t("action.measureOn") : t("action.measure")} pressed={measureOn} onClick={() => onMeasureChange(!measureOn)}>
            <Ruler />
          </ToolButton>
        ) : null}
        <ToolButton label={t("action.zoomOut")} onClick={onZoomOut}>
          <ZoomOut />
        </ToolButton>
        <ToolButton label={t("action.zoomIn")} onClick={onZoomIn}>
          <ZoomIn />
        </ToolButton>
        <ToolButton label={t("action.reset")} onClick={onReset} disabled={!zoomed}>
          <RotateCcw />
        </ToolButton>
        <ToolbarDivider />
        <ToolButton label={tableOn ? t("action.hideTable") : t("action.table")} pressed={tableOn} onClick={() => onTableChange(!tableOn)}>
          <Table2 />
        </ToolButton>
        <Menu.Root>
          <Menu.Trigger render={<ToolButton label={t("snapshot.button")}><Camera /></ToolButton>} />
          <MenuPopup>
            <SnapshotItems onSnapshot={onSnapshot} />
          </MenuPopup>
        </Menu.Root>
        <Menu.Root>
          <Menu.Trigger render={<ToolButton label={t("settings.button")}><Settings2 /></ToolButton>} />
          <MenuPopup className="min-w-60">
            <DisplayGroup prefs={prefs} set={set} hasVolume={hasVolume} events={features.events} targets={targets} watermark label="settings.display" />
            <MenuSeparator />
            <ScaleGroup prefs={prefs} set={set} comparing={comparing} />
            <MenuSeparator />
            <SetupItems onCostEdit={onCostEdit} onShortcuts={onShortcuts} onReset={() => onPrefsChange(defaults)} />
          </MenuPopup>
        </Menu.Root>
        {fullscreenButton}
      </div>
    </>
  );
}
