"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Download,
  History,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ChangePill } from "@/components/dashboard/ui";
import { useShell, type WorkspaceManagerTab } from "@/components/layout/shell-context";
import { Button } from "@/components/ui/button";
import { useIsDisconnected, useOfflineSummary, useOnlineStatus } from "@/hooks/use-network-status";
import { useNow } from "@/hooks/use-now";
import { DEFAULT_WATCHLIST_ID, useWatchlists, type Watchlist } from "@/hooks/use-watchlists";
import { formatMarketDate, formatNumber, formatRelativeTime, parseDate } from "@/lib/format";
import type { TranslationKey } from "@/lib/i18n";
import {
  BackupValidationError,
  createLocalRestorePoint,
  deleteRestorePoint,
  exportWorkspaceBackup,
  importWorkspaceBackup,
  listRestorePoints,
  readRestorePoint,
  restoreFromArchive,
  summarizeWorkspaceData,
  validateWorkspaceBackup,
  type BackupPreview,
  type BackupValidationErrorCode,
} from "@/lib/local-store/backup";
import type { RestorePointMeta } from "@/lib/local-store/idb";
import {
  clearOfflineSummary,
  evaluateOfflineFreshness,
  hasOfflineSummaryData,
} from "@/lib/local-store/offline-cache";
import { MAX_BACKUP_BYTES, readWorkspaceData } from "@/lib/local-store/schema";
import { createBrowserStorage, subscribeWorkspaceStorage } from "@/lib/local-store/storage";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";

const HEADLINE_INDICES = [
  { symbol: "XU100", label: "BIST 100" },
  { symbol: "XU030", label: "BIST 30" },
  { symbol: "XBANK", label: "BIST Banka" },
  { symbol: "XUSIN", label: "BIST Sınai" },
] as const;

function errorTranslationKey(code: BackupValidationErrorCode): TranslationKey {
  switch (code) {
    case "empty":
      return "workspace.err.empty";
    case "too-large":
      return "workspace.err.too-large";
    case "invalid-json":
      return "workspace.err.invalid-json";
    case "unknown-format":
      return "workspace.err.unknown-format";
    case "newer-version":
      return "workspace.err.newer-version";
    default:
      return "workspace.err.invalid-data";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(2)} MB`;
}

function downloadJsonFile(contents: string, fileName: string): void {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Native modal <dialog> for:
 * 1. Validated personal workspace backup, preview, restore and pre-restore rollback (Work #03).
 * 2. Persistent offline market summary & personal watchlist quotes with BIST session timestamps (Work #09 + #13).
 */
export function WorkspaceBackupDialog() {
  const { workspaceManagerOpen, workspaceManagerTab, closeWorkspaceManager } = useShell();
  const { t, setLocale } = useLocale();
  const { setTheme } = useTheme();
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const disconnected = useIsDisconnected();
  const offlineSummary = useOfflineSummary();
  const now = useNow();
  const { lists } = useWatchlists();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const tabBaseId = useId();

  const [activeTab, setActiveTab] = useState<WorkspaceManagerTab>(workspaceManagerTab);
  const [currentSummary, setCurrentSummary] = useState<BackupPreview | null>(null);
  const [restorePoints, setRestorePoints] = useState<RestorePointMeta[]>([]);
  const [pendingImport, setPendingImport] = useState<{ fileName: string; raw: string; preview: BackupPreview } | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string>(DEFAULT_WATCHLIST_ID);

  const refreshLocalMeta = useCallback(async () => {
    const storage = createBrowserStorage();
    if (storage) {
      setCurrentSummary(summarizeWorkspaceData(readWorkspaceData(storage)));
    }
    const points = await listRestorePoints();
    setRestorePoints(points);
  }, []);

  // Sync requested initial tab whenever dialog opens.
  useEffect(() => {
    if (workspaceManagerOpen) {
      setActiveTab(workspaceManagerTab);
      setPendingImport(null);
      setValidationError(null);
      void refreshLocalMeta();
    }
  }, [workspaceManagerOpen, workspaceManagerTab, refreshLocalMeta]);

  // Open/close native modal <dialog> via showModal() / close().
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (workspaceManagerOpen && !dialog.open) {
      dialog.showModal();
    } else if (!workspaceManagerOpen && dialog.open) {
      dialog.close();
    }
  }, [workspaceManagerOpen]);

  // Fallback light-dismiss for Safari / browsers without <dialog closedby="any">.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof HTMLDialogElement === "undefined" || "closedBy" in HTMLDialogElement.prototype) return;

    const isOutside = (event: PointerEvent) => {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    };

    let pressedOutside = false;
    const onPointerDown = (event: PointerEvent) => {
      pressedOutside = isOutside(event);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (pressedOutside && isOutside(event) && dialog.open) {
        dialog.close();
      }
      pressedOutside = false;
    };

    dialog.addEventListener("pointerdown", onPointerDown);
    dialog.addEventListener("pointerup", onPointerUp);
    return () => {
      dialog.removeEventListener("pointerdown", onPointerDown);
      dialog.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  // Keep stats fresh when workspace storage changes while open.
  useEffect(() => {
    if (!workspaceManagerOpen) return;
    return subscribeWorkspaceStorage(() => {
      void refreshLocalMeta();
    });
  }, [workspaceManagerOpen, refreshLocalMeta]);

  const handleDialogClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog) dialog.returnValue = "";
    closeWorkspaceManager();
  }, [closeWorkspaceManager]);

  const handleExportDownload = useCallback(() => {
    const storage = createBrowserStorage();
    if (!storage) return;
    const exported = exportWorkspaceBackup(storage, { appVersion: "1.1.0" });
    downloadJsonFile(exported.json, exported.fileName);
    toast.success(t("workspace.exportedToast"));
  }, [t]);

  const handleSaveRestorePoint = useCallback(async () => {
    setBusy(true);
    try {
      await createLocalRestorePoint({ appVersion: "1.1.0" });
      await refreshLocalMeta();
      toast.success(t("workspace.localPointSaved"));
    } catch {
      // e.g. Safari private mode or storage blocked by policy.
      toast.error(t("workspace.localActionFailed"));
    } finally {
      setBusy(false);
    }
  }, [refreshLocalMeta, t]);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setValidationError(null);
      setPendingImport(null);

      try {
        if (file.size > MAX_BACKUP_BYTES) {
          setValidationError(t("workspace.err.too-large"));
          return;
        }
        const text = await file.text();
        const result = validateWorkspaceBackup(text);
        if (!result.valid) {
          setValidationError(t(errorTranslationKey(result.reason)));
          return;
        }
        setPendingImport({ fileName: file.name, raw: text, preview: result.preview });
      } catch {
        setValidationError(t("workspace.err.invalid-data"));
      }
    },
    [t],
  );

  const runUndoRestore = useCallback(
    async (preRestoreId: string) => {
      try {
        const result = await restoreFromArchive(preRestoreId, {
          onApplyLocale: setLocale,
          onApplyTheme: setTheme,
        });
        if (result.ok) {
          await refreshLocalMeta();
          toast.success(t("workspace.undoneToast"));
        } else {
          toast.error(t("workspace.restoreFailed"));
        }
      } catch {
        toast.error(t("workspace.restoreFailed"));
      }
    },
    [refreshLocalMeta, setLocale, setTheme, t],
  );

  const handleConfirmImport = useCallback(async () => {
    if (!pendingImport) return;
    setBusy(true);
    setValidationError(null);
    try {
      const result = await importWorkspaceBackup(pendingImport.raw, {
        onApplyLocale: setLocale,
        onApplyTheme: setTheme,
        appVersion: "1.1.0",
      });
      if (!result.ok) {
        toast.error(t("workspace.restoreFailed"));
        return;
      }
      setPendingImport(null);
      await refreshLocalMeta();
      const rollbackId = result.preRestoreId;
      toast.success(t("workspace.restoredToast"), {
        action: rollbackId
          ? {
              label: t("workspace.undoRestore"),
              onClick: () => {
                void runUndoRestore(rollbackId);
              },
            }
          : undefined,
      });
    } catch (error) {
      if (error instanceof BackupValidationError) {
        setValidationError(t(errorTranslationKey(error.reason)));
      } else {
        toast.error(t("workspace.restoreFailed"));
      }
    } finally {
      setBusy(false);
    }
  }, [pendingImport, refreshLocalMeta, runUndoRestore, setLocale, setTheme, t]);

  const handleRestoreFromHistory = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const result = await restoreFromArchive(id, {
          onApplyLocale: setLocale,
          onApplyTheme: setTheme,
        });
        if (!result.ok) {
          toast.error(t("workspace.restoreFailed"));
          return;
        }
        await refreshLocalMeta();
        const rollbackId = result.preRestoreId;
        toast.success(t("workspace.restoredToast"), {
          action: rollbackId
            ? {
                label: t("workspace.undoRestore"),
                onClick: () => {
                  void runUndoRestore(rollbackId);
                },
              }
            : undefined,
        });
      } catch {
        toast.error(t("workspace.restoreFailed"));
      } finally {
        setBusy(false);
      }
    },
    [refreshLocalMeta, runUndoRestore, setLocale, setTheme, t],
  );

  const handleDownloadHistory = useCallback(async (id: string) => {
    try {
      const record = await readRestorePoint(id);
      if (!record) return;
      downloadJsonFile(record.contents, record.name.endsWith(".json") ? record.name : `${record.name}.json`);
    } catch {
      toast.error(t("workspace.localActionFailed"));
    }
  }, [t]);

  const handleDeleteHistory = useCallback(
    async (id: string) => {
      try {
        await deleteRestorePoint(id);
        await refreshLocalMeta();
      } catch {
        toast.error(t("workspace.localActionFailed"));
      }
    },
    [refreshLocalMeta, t],
  );

  const handleRefreshOnline = useCallback(() => {
    void queryClient.invalidateQueries({ refetchType: "active" });
  }, [queryClient]);

  const handleClearOfflineCache = useCallback(() => {
    clearOfflineSummary();
    toast.success(t("offline.cacheCleared"));
  }, [t]);

  const freshness = useMemo(
    () => (now !== null ? evaluateOfflineFreshness(offlineSummary, now, !disconnected) : null),
    [offlineSummary, now, disconnected],
  );

  const activeWatchlist: Watchlist = lists.find((l) => l.id === selectedListId) ?? lists[0];
  const listLabel = (list: Watchlist) => list.name || t("watchlist.favorites");
  const companyNames = useMemo(
    () => new Map((offlineSummary?.companies?.items ?? []).map((c) => [c.ticker, c.display_name])),
    [offlineSummary],
  );
  const hasCachedMarket = hasOfflineSummaryData(offlineSummary);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={handleDialogClose}
      {...({ closedby: "any" } as Record<string, string>)}
      className="card-surface m-auto max-h-[88dvh] w-[calc(100%-1.5rem)] max-w-2xl flex-col overflow-hidden p-0 text-foreground backdrop:bg-black/45 open:flex"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <Archive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 id={titleId} className="font-display text-lg font-semibold leading-tight tracking-[-0.012em]">
            {t("workspace.dialogTitle")}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          aria-label={t("common.close")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground motion-press hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label={t("workspace.dialogTitle")} className="flex shrink-0 gap-1 border-b border-border bg-surface/50 px-5 pt-2">
        {(["backup", "offline"] as const).map((tab) => {
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              id={`${tabBaseId}-${tab}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${tabBaseId}-panel-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                selected
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab === "backup" ? t("workspace.tabBackup") : t("workspace.tabOffline")}
            </button>
          );
        })}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
        {activeTab === "backup" ? (
          <div id={`${tabBaseId}-panel-backup`} role="tabpanel" aria-labelledby={`${tabBaseId}-backup`} className="space-y-5">
            {/* Current local workspace summary + export */}
            <section className="rounded-lg border border-border bg-surface/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">{t("workspace.currentTitle")}</h3>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{t("workspace.currentHint")}</p>
                </div>
              </div>

              {currentSummary && (
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
                  <div className="rounded-md border border-border/80 bg-card px-2.5 py-1.5">
                    <dd className="font-mono font-medium text-foreground">
                      {t("workspace.statWatchlists", {
                        count: currentSummary.counts.watchlists,
                        tickers: currentSummary.counts.tickers,
                      })}
                    </dd>
                  </div>
                  <div className="rounded-md border border-border/80 bg-card px-2.5 py-1.5">
                    <dd className="font-mono font-medium text-foreground">
                      {t("workspace.statLayouts", { count: currentSummary.counts.layouts })}
                    </dd>
                  </div>
                  <div className="rounded-md border border-border/80 bg-card px-2.5 py-1.5">
                    <dd className="font-mono font-medium text-foreground">
                      {t("workspace.statCustomPages", { count: currentSummary.counts.customPages })}
                    </dd>
                  </div>
                  <div className="rounded-md border border-border/80 bg-card px-2.5 py-1.5">
                    <dd className="font-mono font-medium text-foreground">
                      {t("workspace.statCharts", { count: currentSummary.counts.chartPrefs })}
                    </dd>
                  </div>
                  <div className="rounded-md border border-border/80 bg-card px-2.5 py-1.5">
                    <dd className="font-mono font-medium text-foreground">
                      {t("workspace.statDrawings", {
                        count: currentSummary.counts.drawings,
                        symbols: currentSummary.counts.drawingSymbols,
                      })}
                    </dd>
                  </div>
                  <div className="rounded-md border border-border/80 bg-card px-2.5 py-1.5">
                    <dd className="font-mono font-medium text-foreground">
                      {t("workspace.statCosts", { count: currentSummary.counts.costs })}
                    </dd>
                  </div>
                  <div className="rounded-md border border-border/80 bg-card px-2.5 py-1.5">
                    <dd className="font-mono font-medium text-foreground">
                      {t("workspace.statPrefs", { count: currentSummary.counts.preferences })}
                    </dd>
                  </div>
                </dl>
              )}

              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={handleExportDownload} disabled={busy}>
                  <Download aria-hidden="true" />
                  {t("workspace.exportJson")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleSaveRestorePoint()} disabled={busy}>
                  <History aria-hidden="true" />
                  {t("workspace.saveLocalPoint")}
                </Button>
              </div>
            </section>

            {/* Validated Import & Preview */}
            <section className="rounded-lg border border-border p-4">
              <h3 className="text-xs font-semibold text-foreground">{t("workspace.importTitle")}</h3>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{t("workspace.importHint")}</p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={(e) => void handleFileChange(e)}
                className="sr-only"
              />

              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload aria-hidden="true" />
                  {t("workspace.chooseFile")}
                </Button>
              </div>

              {validationError && (
                <div
                  role="alert"
                  className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{validationError}</span>
                </div>
              )}

              {pendingImport && (
                <div className="mt-3 space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-up" aria-hidden="true" />
                      {t("workspace.previewTitle")}
                    </div>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {pendingImport.fileName} · {t("workspace.previewVersion", { version: pendingImport.preview.version })}
                    </span>
                  </div>

                  {pendingImport.preview.exportedAt && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("workspace.previewExportedAt", {
                        time: formatMarketDate(pendingImport.preview.exportedAt, "dateTime"),
                      })}
                    </p>
                  )}

                  <ul className="grid grid-cols-2 gap-1.5 text-[11px] text-foreground sm:grid-cols-3">
                    <li>
                      {t("workspace.statWatchlists", {
                        count: pendingImport.preview.counts.watchlists,
                        tickers: pendingImport.preview.counts.tickers,
                      })}
                    </li>
                    <li>{t("workspace.statLayouts", { count: pendingImport.preview.counts.layouts })}</li>
                    <li>{t("workspace.statCustomPages", { count: pendingImport.preview.counts.customPages })}</li>
                    <li>{t("workspace.statCharts", { count: pendingImport.preview.counts.chartPrefs })}</li>
                    <li>
                      {t("workspace.statDrawings", {
                        count: pendingImport.preview.counts.drawings,
                        symbols: pendingImport.preview.counts.drawingSymbols,
                      })}
                    </li>
                    <li>{t("workspace.statCosts", { count: pendingImport.preview.counts.costs })}</li>
                    <li>{t("workspace.statPrefs", { count: pendingImport.preview.counts.preferences })}</li>
                  </ul>

                  {pendingImport.preview.watchlistNames.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("workspace.previewWatchlists", {
                        names: pendingImport.preview.watchlistNames
                          .map((name) => (name === DEFAULT_WATCHLIST_ID ? t("watchlist.favorites") : name))
                          .join(", "),
                      })}
                    </p>
                  )}

                  {pendingImport.preview.layoutPages.length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {t("workspace.previewLayouts", { pages: pendingImport.preview.layoutPages.join(", ") })}
                    </p>
                  )}

                  {pendingImport.preview.warnings.length > 0 && (
                    <p className="text-[11px] text-warn">
                      {t("workspace.previewWarnings", { count: pendingImport.preview.warnings.length })}
                    </p>
                  )}

                  <div className="flex flex-wrap justify-end gap-2 pt-1">
                    {/* Autofocus the safe Cancel action when confirming replacement. */}
                    <Button
                      size="sm"
                      variant="outline"
                      autoFocus
                      disabled={busy}
                      onClick={() => setPendingImport(null)}
                    >
                      {t("workspace.cancelRestore")}
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void handleConfirmImport()}>
                      <RotateCcw aria-hidden="true" />
                      {t("workspace.confirmRestore")}
                    </Button>
                  </div>
                </div>
              )}
            </section>

            {/* Pre-restore Rollback Copies & Local Restore Points */}
            <section className="space-y-2.5">
              <h3 className="text-xs font-semibold text-foreground">{t("workspace.historyTitle")}</h3>
              {restorePoints.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3.5 py-4 text-xs text-muted-foreground">
                  {t("workspace.historyEmpty")}
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {restorePoints.map((point) => (
                    <li key={point.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "rounded-sm px-1.5 py-0.5 text-[10px] font-medium",
                              point.kind === "prerestore"
                                ? "bg-warn/15 text-warn"
                                : "bg-muted text-muted-foreground",
                            )}
                          >
                            {point.kind === "prerestore" ? t("workspace.badgePreRestore") : t("workspace.badgeManual")}
                          </span>
                          <span className="font-mono text-xs text-foreground">
                            {formatMarketDate(point.createdAt, "dateTime")}
                          </span>
                          <span className="text-[11px] text-muted-foreground">· {formatBytes(point.size)}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {point.watchlistCount} {t("watchlist.lists").toLocaleLowerCase()} · {point.layoutCount}{" "}
                          {t("workspace.statLayouts", { count: point.layoutCount }).replace(/^\d+\s*/, "")} ·{" "}
                          {point.drawingCount} {t("workspace.statDrawings", { count: point.drawingCount, symbols: 0 }).replace(/^\d+\s*/, "").replace(/\s*\(.*\)$/, "")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => void handleRestoreFromHistory(point.id)}
                        >
                          <RotateCcw aria-hidden="true" />
                          {t("workspace.restoreAction")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void handleDownloadHistory(point.id)}
                          aria-label={t("workspace.downloadAction")}
                          title={t("workspace.downloadAction")}
                        >
                          <Download aria-hidden="true" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void handleDeleteHistory(point.id)}
                          aria-label={t("workspace.deleteAction")}
                          title={t("workspace.deleteAction")}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : (
          /* Offline Summary Tab */
          <div id={`${tabBaseId}-panel-offline`} role="tabpanel" aria-labelledby={`${tabBaseId}-offline`} className="space-y-4">
            {/* Network & BIST freshness header */}
            <section className="rounded-lg border border-border bg-surface/40 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-medium">
                  {online && !disconnected ? (
                    <span className="inline-flex items-center gap-1.5 text-up">
                      <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("offline.statusOnline")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-warn">
                      <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("offline.statusOffline")}
                    </span>
                  )}
                  {freshness?.savedAt && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {t("offline.lastSaved", { time: formatMarketDate(freshness.savedAt, "dateTime") })}
                      {now !== null ? ` (${formatRelativeTime(freshness.savedAt, now)})` : ""}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  {online && (
                    <Button size="sm" variant="outline" onClick={handleRefreshOnline}>
                      <RefreshCw aria-hidden="true" />
                      {t("offline.refreshNow")}
                    </Button>
                  )}
                  {hasCachedMarket && (
                    <Button size="sm" variant="ghost" onClick={handleClearOfflineCache}>
                      <Trash2 aria-hidden="true" />
                      {t("offline.clearCache")}
                    </Button>
                  )}
                </div>
              </div>

              <p className="mt-2 text-[11px] text-muted-foreground">
                {t("offline.delayNote")}{" "}
                {freshness?.staleDuringSession
                  ? t("offline.sessionOpenStaleHint")
                  : freshness?.hasData && freshness.sameSession
                    ? t("offline.sessionClosedHint")
                    : null}
              </p>
            </section>

            {/* Cached BIST Indices */}
            {offlineSummary?.indices && offlineSummary.indices.quotes.length > 0 && (
              <section className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-xs font-semibold text-foreground">{t("offline.cachedIndices")}</h3>
                  {freshness?.quoteAt && (
                    <span className="text-[11px] text-muted-foreground">
                      {t("offline.quoteTime", { time: formatMarketDate(freshness.quoteAt, "dayMonthTime") })}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {HEADLINE_INDICES.map(({ symbol, label }) => {
                    const quote = offlineSummary.indices?.quotes.find((q) => q.symbol === symbol);
                    if (!quote) return null;
                    return (
                      <div key={symbol} className="rounded-md border border-border bg-card px-3 py-2">
                        <p className="text-[11px] text-muted-foreground">{label}</p>
                        <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
                          {formatNumber(quote.last)}
                        </p>
                        <ChangePill value={quote.change_percent} className="mt-1" />
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Personal Watchlists with Last Known Prices & Timestamps */}
            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-foreground">{t("offline.cachedWatchlist")}</h3>

              {lists.length > 1 && (
                <div role="group" aria-label={t("watchlist.lists")} className="flex flex-wrap gap-1.5">
                  {lists.map((list) => (
                    <button
                      key={list.id}
                      type="button"
                      onClick={() => setSelectedListId(list.id)}
                      aria-pressed={list.id === activeWatchlist.id}
                      className={cn(
                        "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                        list.id === activeWatchlist.id
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {listLabel(list)} ({list.tickers.length})
                    </button>
                  ))}
                </div>
              )}

              {activeWatchlist.tickers.length === 0 ? (
                <p className="rounded-lg border border-border px-3.5 py-4 text-xs text-muted-foreground">
                  {t("watchlist.emptyList")}
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {activeWatchlist.tickers.map((ticker) => {
                    const entry = offlineSummary?.watchlistQuotes[ticker];
                    const name = companyNames.get(ticker);
                    return (
                      <li key={ticker} className="flex items-center justify-between gap-3 px-3.5 py-2">
                        <Link
                          href={`/hisse/${ticker}`}
                          onClick={() => dialogRef.current?.close()}
                          className="min-w-0 flex-1 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <span className="block font-mono text-xs font-semibold text-foreground">{ticker}</span>
                          {name && <span className="block truncate text-[11px] text-muted-foreground">{name}</span>}
                        </Link>
                        {entry ? (
                          <div className="flex flex-col items-end text-right">
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs font-medium tabular-nums text-foreground">
                                {formatNumber(entry.quote.last_price)}
                              </span>
                              <ChangePill value={entry.quote.change_percent} />
                            </span>
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {formatMarketDate(entry.savedAt, "dayMonthTime")}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">{t("offline.noQuoteSaved")}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Cached Latest KAP Disclosures */}
            {offlineSummary?.latestEvents && offlineSummary.latestEvents.items.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold text-foreground">{t("offline.cachedEvents")}</h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {offlineSummary.latestEvents.items.slice(0, 5).map((ev) => {
                    const evTime = parseDate(ev.published_at ?? ev.created_at);
                    return (
                      <li key={ev.id} className="flex items-baseline justify-between gap-3 px-3.5 py-2 text-xs">
                        <span className="font-mono font-semibold text-foreground">{ev.ticker ?? "KAP"}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {ev.summary || ev.title || ev.excerpt || t("events.untitled")}
                        </span>
                        {evTime && (
                          <time dateTime={evTime.toISOString()} className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                            {formatMarketDate(evTime, "dayMonthTime")}
                          </time>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {!hasCachedMarket && (
              <p className="rounded-lg border border-dashed border-border px-3.5 py-4 text-xs text-muted-foreground">
                {t("offline.noDataYet")}
              </p>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
