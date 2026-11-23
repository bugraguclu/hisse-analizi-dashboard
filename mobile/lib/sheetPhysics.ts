/**
 * Pure gesture thresholds and decision math for `SwipeDismissSheet` (adapted from TusAnkiM's
 * `SwipeDismissSheet.tsx`), kept React-Native-free for fast Node unit testing.
 */

export const SHEET_DRAG_SLOP = 8;
export const SHEET_DISMISS_DISTANCE = 72;
export const SHEET_DISMISS_VELOCITY = 0.8;
export const SHEET_MIN_FLICK_DISTANCE = 12;

export function isDownwardSheetPull(dx: number, dy: number): boolean {
  return dy > SHEET_DRAG_SLOP && Math.abs(dy) > Math.abs(dx);
}

export function shouldCompleteSheetDismiss(distance: number, velocityY: number): boolean {
  return (
    distance >= SHEET_DISMISS_DISTANCE ||
    (distance > SHEET_MIN_FLICK_DISTANCE && velocityY >= SHEET_DISMISS_VELOCITY)
  );
}

export function clampSheetOffset(dy: number, dragStart: number): number {
  return Math.max(0, dy - dragStart);
}
