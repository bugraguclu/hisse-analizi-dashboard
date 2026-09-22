"use client";

import { useSyncExternalStore } from "react";

/**
 * A shared wall clock that ticks every 30 s. Returns null during SSR and
 * hydration so time-dependent output (market status, "3 min ago") never
 * causes hydration mismatches, and so components stay render-pure (no
 * Date.now() during render).
 */
const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let now = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function emit() {
  now = Date.now();
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    timer = setInterval(emit, TICK_MS);
    // The cached value may be stale if the clock was idle; refresh immediately.
    if (Date.now() - now > 1_000) queueMicrotask(emit);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot(): number {
  if (now === 0) now = Date.now();
  return now;
}

function getServerSnapshot(): number | null {
  return null;
}

export function useNow(): number | null {
  return useSyncExternalStore<number | null>(subscribe, getSnapshot, getServerSnapshot);
}
