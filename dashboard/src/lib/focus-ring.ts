const NAVIGATION_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * Scope focus rings to keyboard navigation (`html[data-keyboard="true"]`).
 * Navigation keys turn it on; pointerdown turns it off so mouse clicks and
 * programmatic focus restoration on dialog/menu close never leave focus outlines.
 */
export function trackKeyboardNavigation(
  root: HTMLElement = document.documentElement,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey) return;
    // Safari reaches controls with Option+Tab; Option+arrows only move the text cursor.
    if (event.key === "Tab" || (NAVIGATION_KEYS.has(event.key) && !event.altKey)) {
      root.dataset.keyboard = "true";
    }
  };

  const onPointerDown = () => {
    delete root.dataset.keyboard;
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    delete root.dataset.keyboard;
  };
}
