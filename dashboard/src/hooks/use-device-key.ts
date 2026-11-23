"use client";

import { useSyncExternalStore } from "react";
import { DEVICE_KEY_STORAGE_KEY, getOrCreateDeviceKey, readDeviceKey } from "@/lib/device/device-key";
import { createBrowserStorage, subscribeWorkspaceStorage } from "@/lib/local-store/storage";

const DEVICE_KEY_EVENT = "hisse-device-key-changed";

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === DEVICE_KEY_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(DEVICE_KEY_EVENT, listener);
  const unsubscribeWorkspace = subscribeWorkspaceStorage(listener); // backup restore
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(DEVICE_KEY_EVENT, listener);
    unsubscribeWorkspace();
  };
}

function snapshot(): string | null {
  return readDeviceKey(createBrowserStorage());
}

/** The stored device key (null until something was saved with it, or during SSR). */
export function useDeviceKey(): string | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}

/** The device key, created on first write. Null when the browser cannot store it. */
export function ensureDeviceKey(): string | null {
  const before = snapshot();
  const key = getOrCreateDeviceKey(createBrowserStorage());
  if (key && key !== before) window.dispatchEvent(new Event(DEVICE_KEY_EVENT));
  return key;
}
