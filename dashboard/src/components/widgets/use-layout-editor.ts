"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Layout } from "./model";

const HISTORY_LIMIT = 60;

export interface LayoutEditor {
  layout: Layout;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  /** Saves a new layout (autosave) and records the previous one for undo. */
  commit: (next: Layout) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Site pages only: back to the default layout (undoable). */
  reset?: () => void;
  /** Site pages only: the visitor has their own layout. */
  customized?: boolean;
}

/**
 * Edit session over a stored layout: every change is saved right away, with
 * undo/redo (also ⌘Z / ⇧⌘Z while editing) for the session.
 */
export function useLayoutEditor({
  layout,
  save,
  customized,
  resettable = false,
  initialEditing = false,
}: {
  layout: Layout;
  /** null = drop the visitor's layout (site pages). */
  save: (layout: Layout | null) => void;
  customized?: boolean;
  resettable?: boolean;
  /** Open in edit mode (a page just created). */
  initialEditing?: boolean;
}): LayoutEditor {
  const [editing, setEditing] = useState(initialEditing);
  // Entries are layouts, or null for "the default layout" (site pages).
  const past = useRef<Array<Layout | null>>([]);
  const future = useRef<Array<Layout | null>>([]);
  // History sizes as state: render reads these, never the refs.
  const [counts, setCounts] = useState({ past: 0, future: 0 });
  const current = useRef<{ layout: Layout; customized: boolean | undefined }>({ layout, customized });
  useEffect(() => {
    current.current = { layout, customized };
  }, [layout, customized]);

  const snapshot = useCallback((): Layout | null => (resettable && !current.current.customized ? null : current.current.layout), [resettable]);

  const apply = useCallback(
    (next: Layout | null, from: "commit" | "undo" | "redo") => {
      const before = snapshot();
      if (from === "commit") {
        past.current = [...past.current, before].slice(-HISTORY_LIMIT);
        future.current = [];
      } else if (from === "undo") {
        future.current = [...future.current, before];
      } else {
        past.current = [...past.current, before];
      }
      save(next);
      setCounts({ past: past.current.length, future: future.current.length });
    },
    [save, snapshot],
  );

  const commit = useCallback(
    (next: Layout) => {
      if (next === current.current.layout) return;
      if (JSON.stringify(next) === JSON.stringify(current.current.layout)) return;
      apply(next, "commit");
    },
    [apply],
  );

  const undo = useCallback(() => {
    if (past.current.length === 0) return;
    const previous = past.current[past.current.length - 1];
    past.current = past.current.slice(0, -1);
    apply(previous, "undo");
  }, [apply]);

  const redo = useCallback(() => {
    if (future.current.length === 0) return;
    const next = future.current[future.current.length - 1];
    future.current = future.current.slice(0, -1);
    apply(next, "redo");
  }, [apply]);

  const reset = useCallback(() => {
    if (!current.current.customized) return;
    past.current = [...past.current, current.current.layout].slice(-HISTORY_LIMIT);
    future.current = [];
    save(null);
    setCounts({ past: past.current.length, future: 0 });
  }, [save]);

  // ⌘Z / Ctrl+Z undo, ⇧⌘Z / Ctrl+Y redo — while editing, outside text fields.
  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, undo, redo]);

  const canUndo = counts.past > 0;
  const canRedo = counts.future > 0;
  return useMemo(
    () => ({
      layout,
      editing,
      setEditing,
      commit,
      undo,
      redo,
      canUndo,
      canRedo,
      reset: resettable ? reset : undefined,
      customized,
    }),
    [layout, editing, commit, undo, redo, canUndo, canRedo, resettable, reset, customized],
  );
}
