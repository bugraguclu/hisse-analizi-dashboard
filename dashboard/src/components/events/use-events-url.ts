"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseEventsParams, serializeEventsParams, type EventsUrlState } from "./model";

export type NavMode = "push" | "replace";

/** A patch, or a function deriving it from the latest intended state (safe for rapid successive toggles). */
export type FilterPatch = Partial<EventsUrlState> | ((current: EventsUrlState) => Partial<EventsUrlState>);

/**
 * The URL is the single source of truth of the page (shareable, restorable).
 *
 * History policy: discrete changes (chips, presets, sort, paging, opening a
 * disclosure) push an entry so back/forward walk through them; typing and
 * j/k moves inside the drawer replace it. Closing a drawer that this page
 * opened pops its entry instead of stacking a duplicate one.
 */
export function useEventsUrlState() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = useMemo(() => parseEventsParams(searchParams), [searchParams]);

  // Latest intended state: several updates can fire before the router commits the URL.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);

  const pushedEvent = useRef(false);
  useEffect(() => {
    if (!state.event) pushedEvent.current = false;
  }, [state.event]);

  const hrefFor = useCallback(
    (next: EventsUrlState) => {
      const qs = serializeEventsParams(next);
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname],
  );

  const navigate = useCallback(
    (next: EventsUrlState, mode: NavMode) => {
      latest.current = next;
      const href = hrefFor(next);
      if (mode === "push") router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [hrefFor, router],
  );

  /** Any filter change starts again at page 1 with the drawer closed. */
  const setFilters = useCallback(
    (patch: FilterPatch, mode: NavMode = "push") => {
      const current = latest.current;
      const changes = typeof patch === "function" ? patch(current) : patch;
      navigate({ ...current, ...changes, page: 1, event: null }, mode);
    },
    [navigate],
  );

  const setPage = useCallback(
    (page: number) => {
      navigate({ ...latest.current, page, event: null }, "push");
    },
    [navigate],
  );

  const openEvent = useCallback(
    (id: string) => {
      const current = latest.current;
      if (current.event === id) return;
      const fresh = current.event === null;
      if (fresh) pushedEvent.current = true;
      navigate({ ...current, event: id }, fresh ? "push" : "replace");
    },
    [navigate],
  );

  const closeEvent = useCallback(() => {
    const current = latest.current;
    if (!current.event) return;
    latest.current = { ...current, event: null };
    if (pushedEvent.current) {
      pushedEvent.current = false;
      router.back();
    } else {
      navigate({ ...current, event: null }, "replace");
    }
  }, [navigate, router]);

  /** Show only `ticker` (drawer action): replaces the drawer's history entry. */
  const focusTicker = useCallback(
    (ticker: string) => {
      pushedEvent.current = false;
      navigate({ ...latest.current, tickers: [ticker], page: 1, event: null }, "replace");
    },
    [navigate],
  );

  return { state, hrefFor, setFilters, setPage, openEvent, closeEvent, focusTicker };
}
