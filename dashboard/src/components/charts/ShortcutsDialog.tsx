"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { useChartI18n, type ChartKey } from "./i18n";
import { isApplePlatform } from "./use-coarse-pointer";

type Row = [keys: string[], label: ChartKey];

/** Keyboard reference of the chart (TradingView's "?" sheet). */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useChartI18n();
  const mod = isApplePlatform() ? "⌘" : "Ctrl";
  const groups: Array<[ChartKey, Row[]]> = [
    [
      "keys.group.navigate",
      [
        [["←", "→"], "keys.bars"],
        [["Home", "End"], "keys.ends"],
        [["+", "−"], "keys.zoom"],
        [["0", "Alt+R"], "keys.reset"],
        [["Esc"], "keys.escape"],
      ],
    ],
    [
      "keys.group.view",
      [
        [["F"], "keys.fullscreen"],
        [["/"], "keys.indicators"],
        [["Alt+L"], "keys.log"],
        [["Alt+P"], "keys.percent"],
        [["Alt+U"], "keys.currency"],
        [["Alt+S"], "keys.snapshot"],
        [["?"], "keys.help"],
      ],
    ],
    [
      "keys.group.draw",
      [
        [["Alt+T", "Alt+H", "Alt+V", "Alt+F", "Alt+B"], "keys.tools"],
        [["Alt+M"], "keys.measure"],
        [["Delete"], "keys.delete"],
        [[`${mod}+Z`], "keys.undo"],
      ],
    ],
  ];
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[95] bg-black/40 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-[96] max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-[0_24px_64px_-24px_rgb(0_0_0/0.5)] outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-foreground">{t("keys.title")}</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-muted-foreground">{t("keys.intro")}</Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={t("event.close")}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            {groups.map(([title, rows]) => (
              <section key={title} className={title === "keys.group.draw" ? "sm:col-span-2" : undefined}>
                <h3 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t(title)}</h3>
                <dl className="mt-1.5 space-y-1.5">
                  {rows.map(([keys, label]) => (
                    <div key={`${keys.join()}-${label}`} className="flex items-baseline justify-between gap-3 text-xs">
                      <dt className="text-foreground">{t(label)}</dt>
                      <dd className="flex shrink-0 flex-wrap justify-end gap-1">
                        {keys.map((key) => (
                          <kbd key={key} className="rounded-[3px] border border-border bg-muted/60 px-1.5 py-px font-mono text-[10px] text-foreground">
                            {key}
                          </kbd>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
