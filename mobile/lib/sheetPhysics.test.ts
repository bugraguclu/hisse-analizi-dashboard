import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clampSheetOffset,
  isDownwardSheetPull,
  shouldCompleteSheetDismiss,
} from "./sheetPhysics.ts";

describe("sheetPhysics", () => {
  it("claims downward drags beyond slop and rejects upward or horizontal gestures", () => {
    assert.equal(isDownwardSheetPull(0, 6), false);
    assert.equal(isDownwardSheetPull(0, -20), false);
    assert.equal(isDownwardSheetPull(25, 15), false);
    assert.equal(isDownwardSheetPull(4, 16), true);
  });

  it("completes dismiss on distance threshold or fast flick", () => {
    assert.equal(shouldCompleteSheetDismiss(72, 0.1), true);
    assert.equal(shouldCompleteSheetDismiss(24, 0.9), true);
    assert.equal(shouldCompleteSheetDismiss(8, 1.2), false);
    assert.equal(shouldCompleteSheetDismiss(40, 0.3), false);
  });

  it("clamps upward overscroll to zero", () => {
    assert.equal(clampSheetOffset(40, 12), 28);
    assert.equal(clampSheetOffset(5, 12), 0);
  });
});
