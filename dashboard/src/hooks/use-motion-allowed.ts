"use client";

import { useSyncExternalStore } from "react";

import { reducedMotionQuery } from "@/lib/motion";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia(reducedMotionQuery).matches;
}

export function motionScrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "instant" : "smooth";
}

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    query.removeEventListener("change", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

function getSnapshot(): boolean {
  return !prefersReducedMotion() && document.visibilityState === "visible";
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Whether JS-driven motion should run:
 * false for "reduce motion" users and while the tab is hidden (requestAnimationFrame
 * is paused there, so a transition could stop midway). Always false during
 * SSR/hydration, so server and client markup match.
 */
export function useMotionAllowed(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
