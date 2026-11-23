/**
 * The alert list as the user sees it: the server's rules with queued (not yet
 * synced) changes applied on top, each marked with its sync state.
 */

import type { OutboxEntry } from "../offline-outbox/core.ts";
import { provisionalRule, type AlertRule, type AlertRuleInput } from "./model.ts";

export type SyncState = "synced" | "pending" | "conflict" | "rejected";
export type DisplayedRule = AlertRule & { sync: SyncState; outboxId?: string };

export function overlayAlerts(server: readonly AlertRule[], entries: readonly OutboxEntry[], nowIso: string): DisplayedRule[] {
  const rules = new Map<string, DisplayedRule>(server.map((rule) => [rule.id, { ...rule, sync: "synced" }]));
  const deleted = new Map<string, DisplayedRule>();
  const order = [...entries].filter((entry) => entry.entity.startsWith("alert:")).sort((a, b) => a.seq - b.seq);
  for (const entry of order) {
    const sync: SyncState = entry.status === "pending" ? "pending" : entry.status;
    const previous = rules.get(entry.target) ?? null;
    if (entry.kind === "alert.delete") {
      if (previous) {
        rules.delete(entry.target);
        // A delete that cannot be applied (conflict) keeps the rule visible.
        if (sync !== "pending") deleted.set(entry.target, { ...previous, sync, outboxId: entry.id });
      }
      continue;
    }
    const input = entry.payload as unknown as AlertRuleInput | null;
    if (!input) continue;
    rules.set(entry.target, { ...provisionalRule(entry.target, input, previous, nowIso), sync, outboxId: entry.id });
  }
  for (const [id, rule] of deleted) if (!rules.has(id)) rules.set(id, rule);
  return [...rules.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
