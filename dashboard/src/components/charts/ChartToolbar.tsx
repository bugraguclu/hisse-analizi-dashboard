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
  Keyboard,
  Maximize2,
  PenLine,
  RotateCcw,
  Ruler,
  Settings2,
  Table2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChartTypeIcon } from "./chart-icons";
import { ComparePicker, type CompareChoice, type CompareItem } from "./ComparePicker";
import { CheckMark, ChipButton, MENU_GROUP_LABEL_CLASS, MENU_ITEM_CLASS, POPUP_CLASS, RadioMark, ToolbarDivider, ToolButton } from "./controls";
import { useChartI18n, type ChartKey } from "./i18n";
import { IndicatorMenu } from "./IndicatorMenu";
import { CHART_TYPES, type ChartPrefs } from "./prefs";
import type { ChartType, PriceScaleKind } from "./types";

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

function MenuPopup({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end"; className?: string }) {
  return (
    <Menu.Portal>
      <Menu.Positioner side="bottom" align={align} sideOffset={6} collisionPadding={12} className="z-[90]">
        <Menu.Popup className={cn(POPUP_CLASS, "min-w-52 p-1", className)}>{children}</Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
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

export interface ChartToolbarProps {
  mode: "card" | "fullscreen";
  prefs: ChartPrefs;
  onPrefsChange: (next: ChartPrefs) => void;
  /** Stable defaults for "restore default setup". */
  defaults: ChartPrefs;
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
  } | null;
  /** The horizontal drawing strip is open (card, or full screen on phones). */
  drawOpen: boolean;
  /** Offer the strip toggle (full screen on wider screens has the drawing rail instead). */
  showDrawToggle: boolean;
  onDrawOpenChange: (open: boolean) => void;
  drawingCount: number;
  measureOn: boolean;
  onMeasureChange: (on: boolean) => void;
  tableOn: boolean;
  onTableChange: (on: boolean) => void;
  onFullscreen: () => void;
  zoomed: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onSnapshot: (action: "download" | "copy") => void;
  onShortcuts: () => void;
  /** Phone width: icon-only chips. */
  compact: boolean;
  className?: string;
}

/**
 * The chart's tool row: style, indicators, comparison, drawing and events on
 * the left (the things that change what is drawn), view commands, snapshot,
 * settings and full screen on the right. Wraps into two rows on phones.
 */
export function ChartToolbar({
  mode,
  prefs,
  onPrefsChange,
  defaults,
  features,
  intraday,
  hasVolume,
  indicatorsOpen,
  onIndicatorsOpenChange,
  compare,
  drawOpen,
  showDrawToggle,
  onDrawOpenChange,
  drawingCount,
  measureOn,
  onMeasureChange,
  tableOn,
  onTableChange,
  onFullscreen,
  zoomed,
  onZoomIn,
  onZoomOut,
  onReset,
  onSnapshot,
  onShortcuts,
  compact,
  className,
}: ChartToolbarProps) {
  const { t } = useChartI18n();
  const comparing = (compare?.items.length ?? 0) > 0;
  const set = <K extends keyof ChartPrefs>(key: K, value: ChartPrefs[K]) => onPrefsChange({ ...prefs, [key]: value });

  return (
    <div role="toolbar" aria-label={t("action.toolbar")} className={cn("flex flex-wrap items-center gap-x-1 gap-y-1.5", className)}>
      <TypeMenu value={prefs.type} onChange={(type) => set("type", type)} compact={compact} />
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
        />
      ) : null}
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
            <Menu.Item className={ITEM_CLASS} onClick={() => onSnapshot("download")}>
              <Download aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">{t("snapshot.download")}</span>
              <kbd className="font-mono text-[10px] text-muted-foreground">Alt+S</kbd>
            </Menu.Item>
            <Menu.Item className={ITEM_CLASS} onClick={() => onSnapshot("copy")}>
              <Copy aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">{t("snapshot.copy")}</span>
            </Menu.Item>
          </MenuPopup>
        </Menu.Root>
        <Menu.Root>
          <Menu.Trigger render={<ToolButton label={t("settings.button")}><Settings2 /></ToolButton>} />
          <MenuPopup className="min-w-60">
            <Menu.Group>
              <Menu.GroupLabel className={GROUP_LABEL_CLASS}>{t("settings.display")}</Menu.GroupLabel>
              {hasVolume ? (
                <Menu.CheckboxItem className={ITEM_CLASS} checked={prefs.volume} onCheckedChange={(on) => set("volume", on)} closeOnClick={false}>
                  <CheckMark checked={prefs.volume} />
                  {t("settings.volume")}
                </Menu.CheckboxItem>
              ) : null}
              {features.events ? (
                <Menu.CheckboxItem className={ITEM_CLASS} checked={prefs.events} onCheckedChange={(on) => set("events", on)} closeOnClick={false}>
                  <CheckMark checked={prefs.events} />
                  {t("settings.events")}
                </Menu.CheckboxItem>
              ) : null}
              <Menu.CheckboxItem className={ITEM_CLASS} checked={prefs.extremes} onCheckedChange={(on) => set("extremes", on)} closeOnClick={false}>
                <CheckMark checked={prefs.extremes} />
                {t("settings.extremes")}
              </Menu.CheckboxItem>
              <Menu.CheckboxItem className={ITEM_CLASS} checked={prefs.watermark} onCheckedChange={(on) => set("watermark", on)} closeOnClick={false}>
                <CheckMark checked={prefs.watermark} />
                {t("settings.watermark")}
              </Menu.CheckboxItem>
              <Menu.CheckboxItem className={ITEM_CLASS} checked={prefs.grid} onCheckedChange={(on) => set("grid", on)} closeOnClick={false}>
                <CheckMark checked={prefs.grid} />
                {t("settings.grid")}
              </Menu.CheckboxItem>
            </Menu.Group>
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.Group>
              <Menu.GroupLabel className={GROUP_LABEL_CLASS}>{t("settings.scale")}</Menu.GroupLabel>
              <Menu.RadioGroup value={comparing ? "percent" : prefs.scale} onValueChange={(scale: PriceScaleKind) => set("scale", scale)} disabled={comparing}>
                {(["normal", "log", "percent"] as const).map((scale) => (
                  <Menu.RadioItem key={scale} value={scale} className={ITEM_CLASS} closeOnClick={false}>
                    <RadioMark checked={(comparing ? "percent" : prefs.scale) === scale} />
                    <span className="flex-1">{t(SCALE_LABEL[scale])}</span>
                    {scale !== "normal" ? <kbd className="font-mono text-[10px] text-muted-foreground">{scale === "log" ? "Alt+L" : "Alt+P"}</kbd> : null}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
              {comparing ? <p className="px-2 pb-1 text-[10px] leading-3 text-muted-foreground">{t("scale.compareLocked")}</p> : null}
            </Menu.Group>
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.Item className={ITEM_CLASS} onClick={onShortcuts}>
              <Keyboard aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">{t("settings.shortcuts")}</span>
              <kbd className="font-mono text-[10px] text-muted-foreground">?</kbd>
            </Menu.Item>
            <Menu.Item className={ITEM_CLASS} onClick={() => onPrefsChange(defaults)}>
              <RotateCcw aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
              {t("settings.reset")}
            </Menu.Item>
          </MenuPopup>
        </Menu.Root>
        {mode === "card" ? (
          <ChipButton data-chart-action="fullscreen" onClick={onFullscreen} title={t("action.fullscreen")} className="ml-0.5 border-border px-2">
            <Maximize2 />
            <span className="hidden sm:inline">{t("action.fullscreenShort")}</span>
          </ChipButton>
        ) : null}
      </div>
    </div>
  );
}
