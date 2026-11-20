"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Bell, Check, Copy, ExternalLink, RefreshCw, Smartphone, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/lib/locale-context";
import { useWatchlists, type Watchlist } from "@/hooks/use-watchlists";
import { encodeQr, qrToSvgPath } from "@/lib/qr";
import {
  buildPairingLink,
  createPairingCode,
  formatPairingCode,
  isPairingExpired,
  listWidgetDevices,
  revokeWidgetDevice,
  updateWidgetDevice,
  type WidgetDevice,
  type WidgetPairingCode,
} from "@/lib/widget-pairing";
import { cn } from "@/lib/utils";

function isIosBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function formatStamp(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(locale === "en" ? "en-GB" : locale === "fr" ? "fr-FR" : "tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function QrSvg({ value, label }: { value: string; label: string }) {
  const { viewBoxSize, path } = useMemo(() => qrToSvgPath(encodeQr(value), 4), [value]);
  return (
    <div
      role="img"
      aria-label={label}
      className="inline-flex shrink-0 items-center justify-center rounded-xl border border-border bg-white p-3 shadow-xs"
    >
      <svg
        width={176}
        height={176}
        viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        <rect width={viewBoxSize} height={viewBoxSize} fill="#ffffff" />
        <path d={path} fill="#0f172a" />
      </svg>
    </div>
  );
}

export function WidgetPairingPanel() {
  const { t, locale } = useLocale();
  const { lists } = useWatchlists();

  const [selectedListId, setSelectedListId] = useState<string>(lists[0]?.id ?? "favorites");
  const [devices, setDevices] = useState<WidgetDevice[] | null>(null);
  const [pairing, setPairing] = useState<WidgetPairingCode | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [removing, setRemoving] = useState<WidgetDevice | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [ios, setIos] = useState(false);

  // Copy button state (follows modern-web-guidance `copy-button`: live region outside button,
  // never disables button, appends \u00A0 on repeat messages for VoiceOver).
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [copyStatusText, setCopyStatusText] = useState("");
  const copyTimerRef = useRef<number | null>(null);
  const lastAnnouncementRef = useRef("");
  const codeElementId = useId();

  useEffect(() => {
    setIos(isIosBrowser());
  }, []);

  const selectedList: Watchlist = lists.find((l) => l.id === selectedListId) ?? lists[0];
  const selectedListName = selectedList.name || t("watchlist.favorites");
  const expired = pairing ? isPairingExpired(pairing.expires_at, nowMs) : false;

  const loadDevices = useCallback(async (signal?: AbortSignal) => {
    const next = await listWidgetDevices(signal);
    setDevices(next);
    return next;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadDevices(controller.signal).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : t("common.loadError"));
    });
    return () => controller.abort();
  }, [loadDevices, t]);

  // Poll every 3 seconds while a pairing code is active so we notice the iPhone connecting.
  useEffect(() => {
    if (!pairing || expired) return;
    let known: Set<string> | null = devices ? new Set(devices.map((d) => d.id)) : null;

    const pollId = window.setInterval(async () => {
      setNowMs(Date.now());
      try {
        const next = await listWidgetDevices();
        if (!known) {
          known = new Set(next.map((d) => d.id));
        } else if (next.some((d) => !known!.has(d.id))) {
          setDevices(next);
          setPairing(null);
          toast.success(t("widgetPairing.pairedToast"));
        }
      } catch {
        // Retry on next tick
      }
    }, 3000);

    const remainingMs = Math.max(0, Date.parse(pairing.expires_at) - Date.now()) + 100;
    const expireTimer = window.setTimeout(() => setNowMs(Date.now()), remainingMs);

    return () => {
      window.clearInterval(pollId);
      window.clearTimeout(expireTimer);
    };
  }, [pairing, expired, devices, t]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  async function handleCreateCode() {
    setBusy("code");
    setError("");
    try {
      const created = await createPairingCode({
        watchlist_id: selectedList.id,
        watchlist_name: selectedListName,
        tickers: selectedList.tickers,
        dashboard_id: "home",
      });
      setNowMs(Date.now());
      setPairing(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.loadError"));
    } finally {
      setBusy("");
    }
  }

  async function handleSyncWatchlist(device: WidgetDevice) {
    setBusy(`sync:${device.id}`);
    setError("");
    try {
      const updated = await updateWidgetDevice(device.id, {
        watchlist_id: selectedList.id,
        watchlist_name: selectedListName,
        tickers: selectedList.tickers,
        dashboard_id: device.dashboard_id ?? "home",
      });
      setDevices((list) => (list ? list.map((d) => (d.id === updated.id ? updated : d)) : [updated]));
      toast.success(t("widgetPairing.syncedToast", { name: device.name, list: selectedListName }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.loadError"));
    } finally {
      setBusy("");
    }
  }

  async function handleRevoke(device: WidgetDevice) {
    setBusy(`remove:${device.id}`);
    setError("");
    setRemoving(null);
    try {
      await revokeWidgetDevice(device.id);
      setDevices((list) => (list ? list.filter((d) => d.id !== device.id) : []));
      toast.success(t("widgetPairing.revokedToast", { name: device.name }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.loadError"));
    } finally {
      setBusy("");
    }
  }

  async function handleCopyCode() {
    if (!pairing) return;
    const text = formatPairingCode(pairing.code);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);

    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }

    let message = ok ? t("widgetPairing.copied") : t("widgetPairing.copyFailed");
    if (message === lastAnnouncementRef.current) message += "\u00A0";
    lastAnnouncementRef.current = message;

    setCopyState(ok ? "copied" : "failed");
    setCopyStatusText(message);
    copyTimerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      setCopyStatusText("");
    }, 2200);
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const pairingLink = pairing && origin ? buildPairingLink(origin, pairing.code) : "";
  const formattedCode = pairing ? formatPairingCode(pairing.code) : "";

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Smartphone className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("widgetPairing.sectionTitle")}
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">{t("widgetPairing.sectionDesc")}</p>
          </div>
        </div>

        {/* Watchlist selector */}
        <div className="mt-5 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t("widgetPairing.selectList")}</p>
          <div role="group" aria-label={t("watchlist.lists")} className="flex flex-wrap gap-2">
            {lists.map((list) => {
              const active = list.id === selectedList.id;
              const label = list.name || t("watchlist.favorites");
              return (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => setSelectedListId(list.id)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-foreground hover:bg-muted",
                  )}
                >
                  <span>{label}</span>
                  <span className={cn("font-mono text-[11px]", active ? "text-background/75" : "text-muted-foreground")}>
                    {list.tickers.length}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {selectedList.tickers.slice(0, 12).map((ticker) => (
              <span
                key={ticker}
                className="rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-foreground"
              >
                {ticker}
              </span>
            ))}
            {selectedList.tickers.length > 12 && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                +{selectedList.tickers.length - 12}
              </span>
            )}
          </div>
        </div>

        {/* Active pairing QR & code OR generate action */}
        <div className="mt-6">
          {pairing && !expired ? (
            <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface/60 p-4 sm:flex-row sm:items-center">
              {!ios && pairingLink && <QrSvg value={pairingLink} label={t("widgetPairing.qrAlt")} />}
              <div className="min-w-0 flex-1 space-y-3">
                <p className="text-sm text-foreground">
                  {ios ? t("widgetPairing.iosHint") : t("widgetPairing.desktopHint")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      {t("widgetPairing.codeLabel")}
                    </span>
                    <code id={codeElementId} className="font-mono text-lg font-semibold tracking-wider text-foreground">
                      {formattedCode}
                    </code>
                  </div>
                  <span className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyCode()}
                      aria-label={t("widgetPairing.copyCode")}
                      data-copied={copyState === "copied" ? "" : undefined}
                      data-failed={copyState === "failed" ? "" : undefined}
                      className="inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {copyState === "copied" ? (
                        <Check className="h-3.5 w-3.5 text-positive" aria-hidden="true" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>{t("widgetPairing.copy")}</span>
                    </button>
                    <span
                      role="status"
                      className={cn(
                        "text-xs transition-opacity",
                        copyState === "idle" ? "opacity-0" : "opacity-100",
                        copyState === "failed" ? "text-destructive" : "text-muted-foreground",
                      )}
                    >
                      {copyStatusText}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{t("widgetPairing.codeMeta")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {ios && pairingLink && (
                    <a
                      href={pairingLink}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-xs font-medium text-background hover:opacity-90"
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("widgetPairing.openInApp")}
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={busy === "code"}
                    onClick={() => void handleCreateCode()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", busy === "code" && "animate-spin")} aria-hidden="true" />
                    {t("widgetPairing.newCode")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={busy === "code"}
                onClick={() => void handleCreateCode()}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-foreground px-4 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                {t("widgetPairing.generateCode")}
              </button>
              {expired && <span className="text-xs text-muted-foreground">{t("widgetPairing.codeExpired")}</span>}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        {/* Paired devices list */}
        <div className="mt-6 border-t border-border pt-5">
          <h3 className="text-sm font-semibold text-foreground">{t("widgetPairing.devicesTitle")}</h3>
          {devices === null ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("common.loading")}</p>
          ) : devices.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("widgetPairing.noDevices")}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
              {devices.map((device) => (
                <li key={device.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{device.name}</span>
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {device.watchlist_name || t("watchlist.favorites")} ({device.tickers.length})
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {device.last_seen_at
                        ? t("widgetPairing.lastSeen", { time: formatStamp(device.last_seen_at, locale) })
                        : t("widgetPairing.pairedAt", { time: formatStamp(device.created_at, locale) })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy === `sync:${device.id}`}
                      onClick={() => void handleSyncWatchlist(device)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <RefreshCw className={cn("h-3 w-3", busy === `sync:${device.id}` && "animate-spin")} aria-hidden="true" />
                      {t("widgetPairing.syncSelectedList")}
                    </button>
                    <button
                      type="button"
                      disabled={busy === `remove:${device.id}`}
                      onClick={() => setRemoving(device)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-destructive/30 px-2.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      {t("widgetPairing.revoke")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {removing && (
            <div
              role="alertdialog"
              aria-label={t("widgetPairing.revokeConfirmTitle")}
              className="mt-3 flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-xs text-foreground">
                {t("widgetPairing.revokeConfirmMessage", { name: removing.name })}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRemoving(null)}
                  className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
                >
                  {t("dashboard.cancelLayout")}
                </button>
                <button
                  type="button"
                  disabled={busy === `remove:${removing.id}`}
                  onClick={() => void handleRevoke(removing)}
                  className="inline-flex h-8 items-center rounded-md bg-destructive px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {t("widgetPairing.revoke")}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Companion capabilities overview: Widgets, Local Reminders, Siri Shortcuts */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Bell className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("widgetPairing.remindersTitle")}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t("widgetPairing.remindersDesc")}
          </p>
          <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {t("widgetPairing.remindersCaveat")}
          </p>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("widgetPairing.shortcutsTitle")}
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {t("widgetPairing.shortcutsDesc")}
          </p>
          <ul className="mt-2.5 space-y-1 text-xs text-foreground">
            <li>• “THYAO analizini aç”</li>
            <li>• “Takip listemi aç”</li>
            <li>• “Sabah panomu aç”</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
