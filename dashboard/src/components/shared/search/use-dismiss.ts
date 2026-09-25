"use client";

import { useCallback, useEffect, useRef, type FocusEvent, type RefObject } from "react";

/**
 * When a field's suggestion panel closes — the rules the belif /sss search
 * settled on (f6e3bce):
 *
 * - A press outside closes it only once focus has really left the field. On an
 *   iPhone a tap elsewhere on the page keeps the keyboard up and the caret in
 *   the field, and the panel should stay with them. Checked on pointerup and on
 *   mouseup, because Android moves focus with the mouseup. A scroll gesture ends
 *   in pointercancel, so scrolling the page never closes it.
 * - Focus moving to something outside (Tab, a tapped link) closes it, with two
 *   exceptions: no relatedTarget (dismissing the iPhone keyboard is such a blur,
 *   and that is when people want to see the whole list), and a relatedTarget that
 *   contains the box — iOS Safari focuses the nearest focusable ancestor
 *   (<main tabIndex={-1}>) when an option is tapped, and closing then would drop
 *   the tap onto the page underneath.
 *
 * Returns the `onBlur` handler for the box (React's onBlur is focusout).
 */
export function useDismissOnLeave({
  open,
  boxRef,
  inputRef,
  onDismiss,
}: {
  open: boolean;
  boxRef: RefObject<HTMLElement | null>;
  inputRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    let pressedOutside = false;
    function handleDown(event: PointerEvent) {
      pressedOutside = !boxRef.current?.contains(event.target as Node);
    }
    function settle() {
      if (!pressedOutside || document.activeElement === inputRef.current) return;
      pressedOutside = false;
      dismissRef.current();
    }
    document.addEventListener("pointerdown", handleDown, true);
    document.addEventListener("pointerup", settle, true);
    document.addEventListener("mouseup", settle, true);
    return () => {
      document.removeEventListener("pointerdown", handleDown, true);
      document.removeEventListener("pointerup", settle, true);
      document.removeEventListener("mouseup", settle, true);
    };
  }, [open, boxRef, inputRef]);

  return useCallback(
    (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget as Node | null;
      const box = boxRef.current;
      if (next && box && !box.contains(next) && !next.contains(box)) dismissRef.current();
    },
    [boxRef],
  );
}
