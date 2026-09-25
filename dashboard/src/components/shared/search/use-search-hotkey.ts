"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * The site search's two shortcuts, as on the belif site: "/" outside text
 * fields and ⌘K / Ctrl+K from anywhere. A page with its own search box (the
 * KAP feed) takes "/" first in the capture phase and stops it, so "/" means
 * "this page's search" and ⌘K always means the stock search. Nothing fires
 * while a modal dialog (the mobile menu, a drawer) owns the keyboard.
 */
export function useSearchHotkey(onTrigger: () => void) {
  const triggerRef = useRef(onTrigger);
  useEffect(() => {
    triggerRef.current = onTrigger;
  });

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey) return;
      const modifier = event.metaKey || event.ctrlKey;
      const commandK = modifier && !event.shiftKey && event.key.toLowerCase() === "k";
      const slash = event.key === "/" && !modifier && !isTypingTarget(event.target);
      if (!commandK && !slash) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      triggerRef.current();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);
}

const noSubscribe = () => () => {};
const shortcutOnClient = () =>
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K";
const shortcutOnServer = () => null;

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere; null during SSR and hydration. */
export function useShortcutLabel(): string | null {
  return useSyncExternalStore(noSubscribe, shortcutOnClient, shortcutOnServer);
}
