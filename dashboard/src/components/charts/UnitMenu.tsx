"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartPeriod } from "@/types";
import { ChipButton, MENU_GROUP_LABEL_CLASS, MENU_ITEM_CLASS, POPUP_CLASS } from "./controls";
import { useChartI18n } from "./i18n";
import type { ChartUnit } from "./types";
import { CHART_UNITS, effectiveUnit, unitAvailable } from "./units";

/**
 * "TL ▾" chip: TL · USD · EUR · Altın · Reel. The chip names the unit on screen; units a
 * period can't show (euros, gold and real lira on 1D, 5D and Tümü) are listed but disabled,
 * and the choice comes back on the periods that have them.
 */
export function UnitMenu({
  value,
  onChange,
  period,
  compact,
}: {
  value: ChartUnit;
  onChange: (unit: ChartUnit) => void;
  period: ChartPeriod;
  compact: boolean;
}) {
  const { t } = useChartI18n();
  const shown = effectiveUnit(value, period);
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <ChipButton pressed={shown !== "TRY"} title={t("unit.title")} aria-label={`${t("unit.label")}: ${t(`unit.long.${shown}`)}`}>
            <span className={cn("font-mono text-[11px]", compact && "text-[10px]")}>{t(`unit.short.${shown}`)}</span>
            <ChevronDown className="!h-3 !w-3 text-muted-foreground" />
          </ChipButton>
        }
      />
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={12} className="z-[90]">
          <Menu.Popup className={cn(POPUP_CLASS, "max-h-[var(--available-height)] min-w-64 overflow-y-auto overscroll-contain p-1 scrollbar-thin")}>
            <Menu.Group>
              <Menu.GroupLabel className={MENU_GROUP_LABEL_CLASS}>{t("unit.label")}</Menu.GroupLabel>
              <Menu.RadioGroup value={shown} onValueChange={(next: ChartUnit) => onChange(next)}>
                {CHART_UNITS.map((unit) => {
                  const available = unitAvailable(unit, period);
                  return (
                    <Menu.RadioItem key={unit} value={unit} className={MENU_ITEM_CLASS} closeOnClick disabled={!available}>
                      <span className="w-9 shrink-0 font-mono text-[11px] text-muted-foreground">{t(`unit.short.${unit}`)}</span>
                      <span className="flex-1">
                        <span className="block">{t(`unit.long.${unit}`)}</span>
                        <span className="block text-[10px] leading-3 text-muted-foreground">
                          {available ? t(`unit.hint.${unit}`) : t("unit.unavailable")}
                        </span>
                      </span>
                      {unit === shown ? <Check aria-hidden className="h-3.5 w-3.5" /> : null}
                    </Menu.RadioItem>
                  );
                })}
              </Menu.RadioGroup>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
