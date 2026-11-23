"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Send, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ensureDeviceKey, useDeviceKey } from "@/hooks/use-device-key";
import { DeviceApiError } from "@/lib/device/device-api";
import { useLocale } from "@/lib/locale-context";
import {
  currentSubscription,
  disablePush,
  enablePush,
  notificationPermission,
  pushSupport,
  resyncSubscription,
  sendTestPush,
  type PushSupport,
} from "@/lib/pwa/push";
import { usePushConfig } from "./use-alerts";

type Status = { support: PushSupport; permission: NotificationPermission | "unsupported"; subscribed: boolean };

/** Permission state, enable/disable, test notification and the iOS home-screen requirement. */
export function PushPermissionCard() {
  const { t, locale } = useLocale();
  const deviceKey = useDeviceKey();
  const config = usePushConfig();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const support = pushSupport();
    const subscription = support.supported ? await currentSubscription().catch(() => null) : null;
    setStatus({ support, permission: notificationPermission(), subscribed: subscription !== null });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A restored backup brings another device key: move this browser's subscription to it.
  useEffect(() => {
    if (deviceKey && status?.subscribed) void resyncSubscription(deviceKey, locale).catch(() => undefined);
  }, [deviceKey, locale, status?.subscribed]);

  const describeError = (error: unknown) =>
    error instanceof DeviceApiError ? error.message : error instanceof Error ? error.message : String(error);

  const enable = async () => {
    const key = ensureDeviceKey();
    if (!key) return;
    setBusy(true);
    try {
      await enablePush(key, locale);
    } catch (error) {
      toast.error(t("alerts.enableFailed", { reason: describeError(error) }));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const disable = async () => {
    if (!deviceKey) return;
    setBusy(true);
    try {
      await disablePush(deviceKey);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const test = async () => {
    if (!deviceKey) return;
    setBusy(true);
    try {
      await sendTestPush(deviceKey);
      toast.success(t("alerts.testSent"));
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const serverEnabled = config.data?.enabled !== false;
  let message: string;
  if (!status) message = t("common.loading");
  else if (!status.support.supported) {
    message =
      status.support.reason === "development"
        ? t("alerts.permissionDevelopment")
        : status.support.reason === "ios-needs-install"
          ? t("alerts.iosNeedsInstall")
          : t("alerts.permissionUnsupported");
  } else if (status.permission === "denied") message = t("alerts.permissionDenied");
  else if (status.permission === "granted" && status.subscribed) message = t("alerts.permissionGranted");
  else message = t("alerts.permissionDefault");

  const canEnable = status?.support.supported && status.permission !== "denied" && !status.subscribed && serverEnabled;
  const showIos = status?.support.ios || status?.support.supported === false;

  return (
    <section aria-labelledby="push-permission-title" className="card-surface space-y-3 p-4">
      <h2 id="push-permission-title" className="flex items-center gap-2 text-sm font-semibold text-foreground">
        {status?.subscribed ? <Bell className="h-4 w-4" aria-hidden="true" /> : <BellOff className="h-4 w-4" aria-hidden="true" />}
        {t("alerts.permissionTitle")}
      </h2>
      <p role="status" className="text-[13px] leading-relaxed text-muted-foreground">
        {message}
      </p>
      {!serverEnabled ? <p className="text-[13px] leading-relaxed text-warn">{t("alerts.serverDisabled")}</p> : null}
      <div className="flex flex-wrap gap-2">
        {canEnable ? (
          <Button type="button" onClick={() => void enable()} disabled={busy}>
            <Bell aria-hidden="true" /> {t("alerts.enable")}
          </Button>
        ) : null}
        {status?.subscribed ? (
          <>
            <Button type="button" variant="outline" onClick={() => void test()} disabled={busy || !serverEnabled}>
              <Send aria-hidden="true" /> {t("alerts.sendTest")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => void disable()} disabled={busy}>
              {t("alerts.disable")}
            </Button>
          </>
        ) : null}
      </div>
      {showIos ? (
        <div className="flex gap-2 border-t border-border pt-3 text-[13px] leading-relaxed text-muted-foreground">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            <span className="font-medium text-foreground">{t("alerts.iosTitle")}: </span>
            {t("alerts.iosBody")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
