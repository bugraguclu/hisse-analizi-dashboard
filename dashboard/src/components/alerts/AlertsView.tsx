"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { DeviceApiError } from "@/lib/device/device-api";
import { formatMarketDate, formatNumber, formatPrice } from "@/lib/format";
import { useLocale } from "@/lib/locale-context";
import { emptyAlertForm, formFromRule, type AlertRule, type AlertRuleInput } from "@/lib/alerts/model";
import type { DisplayedRule } from "@/lib/alerts/overlay";
import { cn } from "@/lib/utils";
import { AlertRuleForm } from "./AlertRuleForm";
import { PushPermissionCard } from "./PushPermissionCard";
import { useAlertDeliveries, useAlertMutations, useAlertRules } from "./use-alerts";

export function useDescribeRule() {
  const { t } = useLocale();
  return (rule: Pick<AlertRule, "kind" | "threshold" | "direction" | "min_severity">): string => {
    if (rule.kind === "kap") return t("alerts.describe.kap", { severity: t(`alerts.severity.${rule.min_severity === "INFO" || !rule.min_severity ? "ALL" : rule.min_severity}`) });
    if (rule.kind === "change_pct") {
      return t("alerts.describe.change_pct", {
        direction: t(`alerts.describe.dir.${rule.direction ?? "both"}`),
        pct: formatNumber(rule.threshold, 1),
      });
    }
    return t(`alerts.describe.${rule.kind}`, { price: formatPrice(rule.threshold) });
  };
}

function errorText(error: unknown): string {
  return error instanceof DeviceApiError || error instanceof Error ? error.message : String(error);
}

export function AlertsView() {
  const { t, locale } = useLocale();
  const rules = useAlertRules();
  const deliveries = useAlertDeliveries();
  const { create, update, remove } = useAlertMutations();
  const describe = useDescribeRule();
  const [editing, setEditing] = useState<DisplayedRule | null>(null);
  const [formKey, setFormKey] = useState(0);

  const save = async (input: AlertRuleInput) => {
    try {
      if (editing) await update(editing, input);
      else await create(input);
      toast.success(t("alerts.saved"));
      setEditing(null);
      setFormKey((key) => key + 1);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const del = async (rule: DisplayedRule) => {
    if (!window.confirm(t("alerts.deleteConfirm", { ticker: rule.ticker }))) return;
    try {
      await remove(rule);
      toast.success(t("alerts.deleted"));
      if (editing?.id === rule.id) setEditing(null);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const list = rules.rules;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t("alerts.title")} description={t("alerts.description")} />
      <p className="text-xs text-muted-foreground">{t("alerts.delayNote")}</p>

      <PushPermissionCard />

      <section aria-labelledby="alerts-list-title" className="space-y-3">
        <h2 id="alerts-list-title" className="text-sm font-semibold text-foreground">
          {t("alerts.listTitle")}
        </h2>
        {rules.isError && list.length === 0 ? (
          <p role="alert" className="text-[13px] text-destructive">
            {t("alerts.loadError")}{" "}
            <button type="button" className="underline underline-offset-4" onClick={() => void rules.refetch()}>
              {t("common.retry")}
            </button>
          </p>
        ) : rules.isLoading && list.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("common.loading")}</p>
        ) : list.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("alerts.empty")}</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {list.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[13px] text-foreground">
                    <Link href={`/hisse/${rule.ticker}`} className="font-mono font-semibold underline-offset-4 hover:underline">
                      {rule.ticker}
                    </Link>
                    <span className="text-muted-foreground"> · </span>
                    {describe(rule)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    <span className={cn(rule.state === "armed" || rule.state === "active" ? "text-foreground" : undefined)}>
                      {t(`alerts.state.${rule.state}`)}
                    </span>
                    {rule.last_triggered_at ? ` · ${t("alerts.lastFired", { time: formatMarketDate(rule.last_triggered_at, "dayMonthTime") })}` : null}
                    {rule.sync !== "synced" ? (
                      <span className={cn("ml-1", rule.sync === "pending" ? "text-muted-foreground" : "text-warn")}>· {t(`outbox.state.${rule.sync}`)}</span>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(rule)} aria-label={`${t("alerts.edit")}: ${rule.ticker}`}>
                    {t("alerts.edit")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void del(rule)} aria-label={`${t("alerts.delete")}: ${rule.ticker}`}>
                    {t("alerts.delete")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="alerts-form-title" className="card-surface space-y-3 p-4">
        <h2 id="alerts-form-title" className="text-sm font-semibold text-foreground">
          {editing ? t("alerts.editRule") : t("alerts.newRule")}
        </h2>
        <AlertRuleForm
          key={editing ? `edit-${editing.id}-${editing.version}` : `new-${formKey}`}
          initial={editing ? formFromRule(editing, locale !== "en") : emptyAlertForm()}
          lockTicker={editing !== null}
          submitLabel={editing ? t("alerts.save") : t("alerts.create")}
          onSubmit={save}
          onCancel={editing ? () => setEditing(null) : undefined}
        />
      </section>

      <section aria-labelledby="alerts-deliveries-title" className="space-y-3">
        <h2 id="alerts-deliveries-title" className="text-sm font-semibold text-foreground">
          {t("alerts.deliveriesTitle")}
        </h2>
        {(deliveries.data ?? []).length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{t("alerts.deliveriesEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {(deliveries.data ?? []).map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0">
                  <Link href={delivery.url} className="text-[13px] text-foreground underline-offset-4 hover:underline">
                    {delivery.title}
                  </Link>
                  <p className="text-[11px] text-muted-foreground">{delivery.body}</p>
                </div>
                <p className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {t(`alerts.delivery.${delivery.status}`)} · {formatMarketDate(delivery.sent_at ?? delivery.created_at, "dayMonthTime")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] leading-relaxed text-muted-foreground">{t("alerts.keyNote")}</p>
    </div>
  );
}
