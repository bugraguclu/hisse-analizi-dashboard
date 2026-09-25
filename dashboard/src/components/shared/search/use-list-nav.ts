"use client";

import { useCallback, useState, type KeyboardEvent } from "react";

export interface ListNav {
  /** Highlighted option, -1 for none. */
  active: number;
  /** Pointer highlight: hover and keyboard mark the same row, so they look alike. */
  setActive: (index: number) => void;
  /** Handles the walking keys; returns true when it consumed the event. */
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => boolean;
  /** DOM id of option `index`, for `aria-activedescendant` and the option's `id`. */
  optionId: (index: number) => string;
}

/**
 * The belif search's result walk (Search.astro, sss.astro): ArrowDown / Tab and
 * ArrowUp / Shift+Tab move a highlight through the options, wrapping at both
 * ends, while focus never leaves the field. Typing and Backspace therefore
 * always reach the query, the field keeps its own focus indicator, and
 * `aria-activedescendant` tells screen readers which option is current.
 *
 * `tabWalks` decides whether Tab belongs to the list. Leave it off when the
 * list opened by itself (an empty-state list on focus): a keyboard user tabbing
 * through the page must be able to pass the field without pressing Escape.
 *
 * The highlight resets whenever `listKey` changes, so give it something that
 * changes with the rendered options (their ids joined, the query…).
 */
export function useListNav({
  count,
  listKey,
  idPrefix,
  tabWalks,
}: {
  /** Options currently on screen (0 while the list is closed). */
  count: number;
  listKey: string;
  idPrefix: string;
  tabWalks: boolean;
}): ListNav {
  const [state, setState] = useState({ key: listKey, index: -1 });
  // A closed list forgets its highlight, so reopening the same rows starts unmarked
  // (belif's close() sets `active = -1`). Adjusted during render, not in an effect.
  if (count === 0 && state.index !== -1) setState({ key: listKey, index: -1 });
  const active = state.key === listKey && state.index < count ? state.index : -1;

  const optionId = useCallback((index: number) => `${idPrefix}-o${index}`, [idPrefix]);
  const setActive = useCallback((index: number) => setState({ key: listKey, index }), [listKey]);

  function move(index: number) {
    setState({ key: listKey, index });
    // Keyboard moves keep the row inside the scrolling list; hover never scrolls.
    document.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): boolean {
    if (count === 0 || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return false;
    const tab = event.key === "Tab" && tabWalks;
    if (event.key === "ArrowDown" || (tab && !event.shiftKey)) {
      event.preventDefault();
      move((active + 1) % count);
      return true;
    }
    if (event.key === "ArrowUp" || (tab && event.shiftKey)) {
      event.preventDefault();
      move((active <= 0 ? count : active) - 1);
      return true;
    }
    // Home/End jump within the list only once the list is being walked; before
    // that they move the caret, as in any text field.
    if ((event.key === "Home" || event.key === "End") && active >= 0) {
      event.preventDefault();
      move(event.key === "Home" ? 0 : count - 1);
      return true;
    }
    return false;
  }

  return { active, setActive, onKeyDown, optionId };
}
