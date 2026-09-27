"use client";

import { useCallback, useSyncExternalStore } from "react";

/** A CSS media query as React state (false during server render and hydration). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Primary input is touch: larger hit targets, pinch/tap wording in hints. */
export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}

export function isApplePlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
}
