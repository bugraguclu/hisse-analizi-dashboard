"use client";

import { ChartCandlestick, Globe, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWidgetI18n } from "./i18n";
import type { WidgetScope } from "./widget-scope";

/** The two kinds of widgets offered when starting a blank page. */
export function WidgetScopeCards({ onPick }: { onPick?: (scope: WidgetScope) => void }) {
  const { t } = useWidgetI18n();
  return (
    <div className="grid w-full gap-3 text-left sm:grid-cols-2">
      {(["stock", "general"] as const).map((scope) => {
        const Icon = scope === "stock" ? ChartCandlestick : Globe;
        return (
          <div key={scope} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
              <Icon aria-hidden className="size-4 text-muted-foreground" />
              {t(`scope.${scope}`)}
            </div>
            <p className="grow text-xs leading-relaxed text-muted-foreground">{t(`scope.${scope}Hint`)}</p>
            {onPick ? (
              <Button variant="outline" size="sm" className="mt-1 self-start" onClick={() => onPick(scope)}>
                <Plus aria-hidden />
                {t(`scope.${scope}Add`)}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
