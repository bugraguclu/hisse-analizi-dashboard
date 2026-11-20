import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateSheetDragStart, sheetDismissThreshold, shouldDismissSheet } from "./dismissible-sheet.ts";

describe("dismissible-sheet gesture math", () => {
  it("ignores tiny finger wobble before claiming a drag", () => {
    assert.equal(evaluateSheetDragStart(2, 5, true), "pending");
  });

  it("rejects upward scrolling and horizontal swipes so inner lists keep scrolling naturally", () => {
    assert.equal(evaluateSheetDragStart(0, -18, true), "reject");
    assert.equal(evaluateSheetDragStart(24, 14, true), "reject");
    assert.equal(evaluateSheetDragStart(0, 20, false), "reject");
  });

  it("claims a clear downward pull on a cancelable touch", () => {
    assert.equal(evaluateSheetDragStart(3, 18, true), "claim");
  });

  it("scales threshold with sheet height and clamps between 64 and 148 px", () => {
    assert.equal(sheetDismissThreshold(200), 64);
    assert.equal(sheetDismissThreshold(500), 110);
    assert.equal(sheetDismissThreshold(1000), 148);
  });

  it("dismisses past distance threshold or on a fresh downward flick, never when cancelled", () => {
    assert.equal(
      shouldDismissSheet({ distance: 120, velocity: 0.1, sheetHeight: 450, msSinceLastMove: 20 }),
      true,
    );
    assert.equal(
      shouldDismissSheet({ distance: 40, velocity: 0.85, sheetHeight: 450, msSinceLastMove: 30 }),
      true,
    );
    assert.equal(
      shouldDismissSheet({ distance: 40, velocity: 0.85, sheetHeight: 450, msSinceLastMove: 140 }),
      false,
    );
    assert.equal(
      shouldDismissSheet({ distance: 200, velocity: 1.5, sheetHeight: 450, msSinceLastMove: 10, cancelled: true }),
      false,
    );
  });
});
