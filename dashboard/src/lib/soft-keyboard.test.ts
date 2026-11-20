import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeRevealDelta } from "./soft-keyboard.ts";

describe("computeRevealDelta", () => {
  it("returns 0 when the focused field sits comfortably inside the visible viewport", () => {
    const delta = computeRevealDelta({
      targetTop: 120,
      targetBottom: 164,
      containerTop: 56,
      containerBottom: 420,
      viewportHeight: 400,
      paddingTop: 12,
      paddingBottom: 12,
    });
    assert.equal(delta, 0);
  });

  it("scrolls down when the keyboard covers the bottom of the field", () => {
    const delta = computeRevealDelta({
      targetTop: 340,
      targetBottom: 384,
      containerTop: 0,
      containerBottom: 700,
      viewportHeight: 360,
      paddingTop: 0,
      paddingBottom: 0,
      gap: 12,
    });
    // high = 360 - 12 = 348; delta = 384 - 348 = 36
    assert.equal(delta, 36);
  });

  it("scrolls up when the field sits behind a sticky header or scroll-padding-top", () => {
    const delta = computeRevealDelta({
      targetTop: 40,
      targetBottom: 80,
      containerTop: 20,
      containerBottom: 400,
      viewportHeight: 420,
      paddingTop: 44,
      paddingBottom: 0,
      gap: 12,
    });
    // low = max(12, 20 + 44) = 64; delta = 40 - 64 = -24
    assert.equal(delta, -24);
  });

  it("aligns the top edge when the target is taller than the remaining visible window", () => {
    const delta = computeRevealDelta({
      targetTop: 140,
      targetBottom: 520,
      containerTop: 0,
      containerBottom: 600,
      viewportHeight: 320,
      paddingTop: 16,
      paddingBottom: 16,
      gap: 12,
    });
    // low = 16; targetHeight (380) > available (308 - 16 = 292) => targetTop - low = 124
    assert.equal(delta, 124);
  });

  it("respects container scroll-padding-bottom for sticky primary action footers", () => {
    const delta = computeRevealDelta({
      targetTop: 290,
      targetBottom: 330,
      containerTop: 60,
      containerBottom: 360,
      viewportHeight: 420,
      paddingTop: 12,
      paddingBottom: 64,
      gap: 12,
    });
    // high = min(408, 360 - 64 = 296); delta = 330 - 296 = 34
    assert.equal(delta, 34);
  });
});
