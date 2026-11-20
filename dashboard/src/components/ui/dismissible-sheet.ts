/**
 * Pure gesture decision helpers for mobile bottom sheets (adapted from Yemek Takibi's
 * `DismissibleSheet.jsx`), kept DOM-free so they can be unit-tested directly.
 */

export const SHEET_DRAG_SLOP = 8;
export const SHEET_DIRECTION_RATIO = 1.25;
export const SHEET_FLICK_MIN_DISTANCE = 32;
export const SHEET_FLICK_MIN_VELOCITY = 0.65;
export const SHEET_FLICK_MAX_AGE_MS = 100;

export type DragClaimDecision = "pending" | "claim" | "reject";

/**
 * Decides whether a pointer/touch move should be claimed as a downward sheet dismiss, ignored as
 * noise (`pending`), or permanently yielded to native vertical/horizontal scrolling (`reject`).
 */
export function evaluateSheetDragStart(dx: number, dy: number, cancelable: boolean): DragClaimDecision {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SHEET_DRAG_SLOP) return "pending";
  if (dy <= 0 || dy < Math.abs(dx) * SHEET_DIRECTION_RATIO) return "reject";
  if (!cancelable) return "reject";
  return "claim";
}

/** Distance threshold scales with sheet height, clamped to comfortable thumb travel. */
export function sheetDismissThreshold(sheetHeight: number): number {
  return Math.max(64, Math.min(148, sheetHeight * 0.22));
}

export interface SheetReleaseInput {
  distance: number;
  velocity: number;
  sheetHeight: number;
  msSinceLastMove: number;
  cancelled?: boolean;
}

/** True when releasing the sheet should complete dismissal rather than snapping back. */
export function shouldDismissSheet({
  distance,
  velocity,
  sheetHeight,
  msSinceLastMove,
  cancelled = false,
}: SheetReleaseInput): boolean {
  if (cancelled) return false;
  const threshold = sheetDismissThreshold(sheetHeight);
  const flick =
    distance >= SHEET_FLICK_MIN_DISTANCE &&
    velocity > SHEET_FLICK_MIN_VELOCITY &&
    msSinceLastMove < SHEET_FLICK_MAX_AGE_MS;
  return distance >= threshold || flick;
}
