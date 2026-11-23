"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ensureDeviceKey, useDeviceKey } from "@/hooks/use-device-key";
import { useOutbox } from "@/hooks/use-outbox";
import type { AlertDelivery, AlertRule, AlertRuleInput } from "@/lib/alerts/model";
import { overlayAlerts, type DisplayedRule } from "@/lib/alerts/overlay";
import { deviceRequest } from "@/lib/device/device-api";
import { createBrowserStorage } from "@/lib/local-store/storage";
import { enqueueMutation } from "@/lib/offline-outbox/runtime";
import { fetchPushConfig } from "@/lib/pwa/push";

export const alertRulesKey = (deviceKey: string | null) => ["me", "alerts", deviceKey] as const;
export const alertDeliveriesKey = (deviceKey: string | null) => ["me", "deliveries", deviceKey] as const;

/** Last server list per device, so the Alarmlar page opens offline too (not part of backups). */
const ALERTS_CACHE_KEY = "hisse.alerts.cache.v1";

function readCachedRules(deviceKey: string | null): AlertRule[] | undefined {
  if (!deviceKey) return undefined;
  try {
    const raw = createBrowserStorage()?.getItem(ALERTS_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { deviceKey?: string; rules?: AlertRule[] }) : null;
    return parsed?.deviceKey === deviceKey && Array.isArray(parsed.rules) ? parsed.rules : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedRules(deviceKey: string, rules: AlertRule[]): void {
  try {
    createBrowserStorage()?.setItem(ALERTS_CACHE_KEY, JSON.stringify({ deviceKey, rules }));
  } catch {
    // Quota / private mode: the page still works online.
  }
}

/** Server rules with queued offline changes applied on top (each marked with its sync state). */
export function useAlertRules() {
  const deviceKey = useDeviceKey();
  const { entries } = useOutbox();
  const query = useQuery({
    queryKey: alertRulesKey(deviceKey),
    queryFn: async ({ signal }) => {
      const rules = await deviceRequest<AlertRule[]>("/me/alerts", { deviceKey, signal });
      if (deviceKey) writeCachedRules(deviceKey, rules);
      return rules;
    },
    enabled: deviceKey !== null,
    staleTime: 30_000,
    initialData: () => readCachedRules(deviceKey),
    initialDataUpdatedAt: 0,
  });
  const rules: DisplayedRule[] = useMemo(
    () => overlayAlerts(query.data ?? [], entries, new Date().toISOString()),
    [query.data, entries],
  );
  return { ...query, rules };
}

export function useAlertDeliveries() {
  const deviceKey = useDeviceKey();
  return useQuery({
    queryKey: alertDeliveriesKey(deviceKey),
    queryFn: ({ signal }) => deviceRequest<AlertDelivery[]>("/me/alerts/deliveries?limit=20", { deviceKey, signal }),
    enabled: deviceKey !== null,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function usePushConfig() {
  return useQuery({ queryKey: ["push", "config"], queryFn: fetchPushConfig, staleTime: 10 * 60_000 });
}

/**
 * Create / update / delete through the offline outbox: the change shows up at
 * once (marked as waiting) and is sent now, or as soon as the connection returns.
 */
export function useAlertMutations() {
  const queue = useCallback(
    async (kind: "alert.create" | "alert.update" | "alert.delete", id: string, payload: AlertRuleInput | null, base: number | null, label: string) => {
      const deviceKey = ensureDeviceKey();
      if (!deviceKey) throw new Error("storage-unavailable");
      await enqueueMutation({
        entity: `alert:${id}`,
        kind,
        target: id,
        payload: payload as unknown as Record<string, unknown> | null,
        base,
        deviceKey,
        label,
      });
    },
    [],
  );

  const create = useCallback((input: AlertRuleInput) => queue("alert.create", crypto.randomUUID(), input, null, input.ticker), [queue]);
  // version 0 = created offline and not confirmed yet: the update chains on the create.
  const update = useCallback(
    (previous: AlertRule, input: AlertRuleInput) => queue("alert.update", previous.id, input, previous.version || null, input.ticker),
    [queue],
  );
  const remove = useCallback((rule: AlertRule) => queue("alert.delete", rule.id, null, rule.version || null, rule.ticker), [queue]);

  return { create, update, remove };
}
