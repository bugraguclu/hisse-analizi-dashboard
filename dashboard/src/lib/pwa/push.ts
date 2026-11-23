/**
 * Web Push in the browser: capability checks, permission and the subscription
 * registered with the API under the device key.
 */

import type { Locale } from "@/lib/i18n";
import { deviceRequest } from "@/lib/device/device-api";
import { activeRegistration, serviceWorkerEnabled } from "./registration";

export interface PushConfig {
  enabled: boolean;
  vapid_public_key: string | null;
  price_delay_minutes: number;
}

export type PushSupport =
  | { supported: true; ios: boolean; standalone: boolean }
  | { supported: false; reason: "no-service-worker" | "development" | "no-push" | "ios-needs-install"; ios: boolean; standalone: boolean };

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  // iPadOS 13+ reports itself as a Mac; touch points give it away.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

export function pushSupport(): PushSupport {
  const ios = isIosDevice();
  const standalone = isStandaloneDisplay();
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return { supported: false, reason: "no-service-worker", ios, standalone };
  if (!serviceWorkerEnabled()) return { supported: false, reason: "development", ios, standalone };
  // iOS/iPadOS expose PushManager only to sites opened from the home screen (16.4+).
  if (!("PushManager" in window) || !("Notification" in window)) {
    return { supported: false, reason: ios && !standalone ? "ios-needs-install" : "no-push", ios, standalone };
  }
  return { supported: true, ios, standalone };
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export function fetchPushConfig(): Promise<PushConfig> {
  return deviceRequest<PushConfig>("/push/config");
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await activeRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

function subscriptionBody(subscription: PushSubscription, locale: Locale) {
  const json = subscription.toJSON();
  return { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" }, locale };
}

function sameKey(subscription: PushSubscription, vapidKey: Uint8Array): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === vapidKey.length && bytes.every((value, index) => value === vapidKey[index]);
}

/** Must run from a user gesture (permission prompt). Returns the permission outcome. */
export async function enablePush(deviceKey: string, locale: Locale): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const config = await fetchPushConfig();
  if (!config.enabled || !config.vapid_public_key) throw new Error("push-disabled");
  const registration = await activeRegistration();
  if (!registration) throw new Error("no-service-worker");
  const vapidKey = urlBase64ToUint8Array(config.vapid_public_key);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription, vapidKey)) {
    // Server keys were rotated: the old subscription can never receive our pushes.
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKey });
  await deviceRequest("/me/push/subscription", { method: "PUT", deviceKey, body: subscriptionBody(subscription, locale) });
  return permission;
}

export async function disablePush(deviceKey: string): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => false);
  await deviceRequest("/me/push/subscription", { method: "DELETE", deviceKey, body: { endpoint } }).catch(() => undefined);
}

/** Re-register an existing subscription (after a backup restore changed the device key, or a locale change). */
export async function resyncSubscription(deviceKey: string, locale: Locale): Promise<boolean> {
  if (notificationPermission() !== "granted") return false;
  const subscription = await currentSubscription();
  if (!subscription) return false;
  await deviceRequest("/me/push/subscription", { method: "PUT", deviceKey, body: subscriptionBody(subscription, locale) });
  return true;
}

export function sendTestPush(deviceKey: string): Promise<{ delivery_id: string; subscriptions: number }> {
  return deviceRequest("/me/push/test", { method: "POST", deviceKey });
}
