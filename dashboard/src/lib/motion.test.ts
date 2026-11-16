import assert from "node:assert/strict";
import test from "node:test";
import { criticalDamping, cubicBezier, exitDuration, motionCurve, motionDuration, moveProgress, rubberBand, staggerDelay } from "./motion.ts";

test("exit duration rounds the shared ratio to whole milliseconds", () => {
  assert.equal(exitDuration(motionDuration.popover), 160);
  assert.equal(exitDuration(motionDuration.panel), 208);
  assert.equal(exitDuration(13), 10);
});

test("stagger runs from zero through five 30 ms delays", () => {
  assert.deepEqual(Array.from({ length: 8 }, (_, index) => staggerDelay(index)), [0, 30, 60, 90, 120, 150, 150, 150]);
  assert.equal(staggerDelay(-1), 0);
});

test("critical damping yields a damping ratio of one", () => {
  assert.equal(criticalDamping(100, 1), 20);
  assert.equal(criticalDamping(520, 0.8), 2 * Math.sqrt(416));
});

test("rubber band preserves direction and stays within the distance", () => {
  const result = rubberBand(20, 10);
  assert.ok(Math.abs(result - (1 - 1 / 2.1) * 10) < 1e-12);
  assert.equal(rubberBand(-20, 10), -result);
  assert.equal(rubberBand(0, 10), 0);
  assert.equal(rubberBand(20, 0), 0);
  assert.ok(rubberBand(1000, 10) < 10);
});

test("CSS easing uses the same control points as JavaScript", () => {
  assert.equal(cubicBezier(motionCurve.easeOut), "cubic-bezier(0.23, 1, 0.32, 1)");
  assert.equal(cubicBezier(motionCurve.easeInOut), "cubic-bezier(0.77, 0, 0.175, 1)");
});


test("move timing reaches its endpoints without undershooting or overshooting", () => {
  const samples = Array.from({ length: 101 }, (_, i) => moveProgress(i / 100));
  assert.equal(samples[0], 0);
  assert.equal(samples.at(-1), 1);
  assert.ok(samples.every((value, i) => i === 0 || samples[i - 1] < value));
  assert.ok(moveProgress(0.25) < 0.25);
  assert.ok(moveProgress(0.75) > 0.75);
});
