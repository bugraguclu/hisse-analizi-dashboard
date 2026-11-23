/**
 * Anonymous device identity (no accounts).
 *
 * A random 256-bit secret, base64url (43 characters), created on first use and
 * kept in localStorage next to the rest of the personal workspace. It is part of
 * the workspace backup, so restoring a backup on another browser brings back
 * that device's alerts and notes. The server stores only its SHA-256.
 *
 * Pure module (no React/Next imports) so Node `--test` can run it.
 */

import type { StorageAdapter } from "../local-store/storage.ts";

export const DEVICE_KEY_STORAGE_KEY = "hisse.device.key.v1";
export const DEVICE_KEY_HEADER = "X-Device-Key";
const DEVICE_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

export function isValidDeviceKey(value: unknown): value is string {
  return typeof value === "string" && DEVICE_KEY_RE.test(value);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateDeviceKey(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  return base64UrlEncode(random(new Uint8Array(32)));
}

export function readDeviceKey(storage: StorageAdapter | null): string | null {
  const value = storage?.getItem(DEVICE_KEY_STORAGE_KEY) ?? null;
  return isValidDeviceKey(value) ? value : null;
}

/**
 * The stored key, or a new one (persisted). Null when storage is unavailable:
 * a key that cannot be kept would orphan everything created with it.
 */
export function getOrCreateDeviceKey(storage: StorageAdapter | null, generate: () => string = generateDeviceKey): string | null {
  if (!storage) return null;
  const existing = readDeviceKey(storage);
  if (existing) return existing;
  const created = generate();
  try {
    storage.setItem(DEVICE_KEY_STORAGE_KEY, created);
  } catch {
    return null;
  }
  return readDeviceKey(storage) === created ? created : null;
}
