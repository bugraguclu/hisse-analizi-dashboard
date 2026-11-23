"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureDeviceKey, useDeviceKey } from "@/hooks/use-device-key";
import type { AlertDelivery, AlertRule, AlertRuleInput } from "@/lib/alerts/model";
import { deviceRequest, newIdempotencyKey } from "@/lib/device/device-api";
import { fetchPushConfig } from "@/lib/pwa/push";

export const alertRulesKey = (deviceKey: string | null) => ["me", "alerts", deviceKey] as const;
export const alertDeliveriesKey = (deviceKey: string | null) => ["me", "deliveries", deviceKey] as const;

export function useAlertRules() {
  const deviceKey = useDeviceKey();
  return useQuery({
    queryKey: alertRulesKey(deviceKey),
    queryFn: ({ signal }) => deviceRequest<AlertRule[]>("/me/alerts", { deviceKey, signal }),
    enabled: deviceKey !== null,
    staleTime: 30_000,
  });
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

/** Create / update / delete, keeping the cached list in step with the server's answer. */
export function useAlertMutations() {
  const queryClient = useQueryClient();

  const setRules = useCallback(
    (deviceKey: string, update: (rules: AlertRule[]) => AlertRule[]) => {
      queryClient.setQueryData<AlertRule[]>(alertRulesKey(deviceKey), (rules) => update(rules ?? []));
    },
    [queryClient],
  );

  const create = useCallback(
    async (input: AlertRuleInput): Promise<AlertRule> => {
      const deviceKey = ensureDeviceKey();
      if (!deviceKey) throw new Error("storage-unavailable");
      const id = crypto.randomUUID();
      const rule = await deviceRequest<AlertRule>("/me/alerts", {
        method: "POST",
        deviceKey,
        idempotencyKey: newIdempotencyKey("alert"),
        body: { id, ...input },
      });
      setRules(deviceKey, (rules) => [...rules.filter((r) => r.id !== rule.id), rule]);
      return rule;
    },
    [setRules],
  );

  const update = useCallback(
    async (previous: AlertRule, input: AlertRuleInput): Promise<AlertRule> => {
      const deviceKey = ensureDeviceKey();
      if (!deviceKey) throw new Error("storage-unavailable");
      const rule = await deviceRequest<AlertRule>(`/me/alerts/${previous.id}`, {
        method: "PUT",
        deviceKey,
        idempotencyKey: newIdempotencyKey("alert"),
        body: { ...input, version: previous.version },
      });
      setRules(deviceKey, (rules) => rules.map((r) => (r.id === rule.id ? rule : r)));
      return rule;
    },
    [setRules],
  );

  const remove = useCallback(
    async (rule: AlertRule): Promise<void> => {
      const deviceKey = ensureDeviceKey();
      if (!deviceKey) throw new Error("storage-unavailable");
      await deviceRequest<null>(`/me/alerts/${rule.id}?version=${rule.version}`, {
        method: "DELETE",
        deviceKey,
        idempotencyKey: newIdempotencyKey("alert"),
      });
      setRules(deviceKey, (rules) => rules.filter((r) => r.id !== rule.id));
    },
    [setRules],
  );

  return { create, update, remove };
}
