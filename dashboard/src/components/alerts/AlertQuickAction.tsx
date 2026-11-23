"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellPlus, X } from "lucide-react";
import { toast } from "sonner";
import { buttonVariants } from "@/components/ui/button";
import { DeviceApiError } from "@/lib/device/device-api";
import { emptyAlertForm, type AlertRuleInput } from "@/lib/alerts/model";
import { useLocale } from "@/lib/locale-context";
import { AlertRuleForm } from "./AlertRuleForm";
import { useAlertMutations } from "./use-alerts";

/** "Alarm kur" on the stock page: a small dialog with the rule form, ticker fixed. */
export function AlertQuickAction({ ticker, currentPrice }: { ticker: string; currentPrice: number | null }) {
  const { t } = useLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const { create } = useAlertMutations();
  const router = useRouter();

  const show = () => {
    setFormKey((key) => key + 1);
    setOpen(true);
    dialogRef.current?.showModal();
  };
  const close = () => dialogRef.current?.close();

  const save = async (input: AlertRuleInput) => {
    try {
      await create(input);
      toast.success(t("alerts.saved"), {
        action: { label: t("alerts.manageAll"), onClick: () => router.push("/alarmlar") },
      });
      close();
    } catch (error) {
      toast.error(error instanceof DeviceApiError || error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <button type="button" onClick={show} aria-haspopup="dialog" className={buttonVariants({ variant: "outline", size: "sm" })}>
        <BellPlus aria-hidden="true" /> {t("alerts.quickAction")}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        {...({ closedby: "any" } as Record<string, string>)}
        className="card-surface m-auto w-[calc(100%-1.5rem)] max-w-lg p-0 text-left text-foreground backdrop:bg-black/45"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 id={titleId} className="text-base font-semibold">
            {t("alerts.quickTitle", { ticker })}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label={t("common.close")}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="text-[11px] text-muted-foreground">{t("alerts.delayNote")}</p>
          {open ? (
            <AlertRuleForm
              key={formKey}
              initial={emptyAlertForm(ticker)}
              lockTicker
              currentPrice={currentPrice}
              submitLabel={t("alerts.create")}
              onSubmit={save}
              onCancel={close}
            />
          ) : null}
          <Link href="/alarmlar" onClick={close} className="inline-block text-xs text-primary underline-offset-4 hover:underline">
            {t("alerts.manageAll")}
          </Link>
        </div>
      </dialog>
    </>
  );
}
