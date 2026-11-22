import assert from "node:assert/strict";
import test from "node:test";
import { beginPointerGesture, gestureResistance, gestureScrollSpeed, type GesturePoint } from "./pointer-gesture.ts";

class TestWindow extends EventTarget {
  scrollX = 0;
  scrollY = 0;
  innerHeight = 800;
  breakpoint = new EventTarget();
  frames = new Map<number, FrameRequestCallback>();
  nextFrame = 0;
  selectionsCleared = 0;
  matchMedia() { return this.breakpoint; }
  getSelection() { return { removeAllRanges: () => this.selectionsCleared++ }; }
  requestAnimationFrame(callback: FrameRequestCallback) {
    const id = ++this.nextFrame;
    this.frames.set(id, callback);
    return id;
  }
  cancelAnimationFrame(id: number) { this.frames.delete(id); }
  scrollBy({ top }: { top: number }) { this.scrollY = Math.max(0, Math.min(2000, this.scrollY + top)); }
  flush() {
    const pending = [...this.frames.values()];
    this.frames.clear();
    for (const callback of pending) callback(0);
  }
}

class TestDocument extends EventTarget {
  body = { style: { cursor: "crosshair", userSelect: "text" } };
  visibilityState = "visible";
}

function environment(run: (win: TestWindow, doc: TestDocument) => void) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const win = new TestWindow();
  const doc = new TestDocument();
  Object.defineProperty(globalThis, "window", { value: win, configurable: true });
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  try { run(win, doc); } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

function press(x = 100, y = 100) {
  const handle = {
    captured: false,
    setPointerCapture() { this.captured = true; },
    hasPointerCapture() { return this.captured; },
    releasePointerCapture() { this.captured = false; },
  };
  return { button: 0, isPrimary: true, pointerId: 1, clientX: x, clientY: y, currentTarget: handle as unknown as EventTarget };
}

function pointer(win: TestWindow, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 1, buttons: 1, clientX: x, clientY: y, ...extra,
  });
  win.dispatchEvent(event);
}

const BASE = { mediaQuery: "(min-width: 64rem)", cursor: "grabbing" };

test("pointer frames coalesce, and release flushes its final position before finishing", () => environment((win, doc) => {
  const frames: GesturePoint[] = [];
  const finishes: boolean[][] = [];
  const start = press();
  beginPointerGesture(start, { ...BASE, onFrame: (point) => frames.push(point), onFinish: (...result) => finishes.push(result) });
  pointer(win, "pointermove", 110, 110);
  pointer(win, "pointermove", 120, 120);
  pointer(win, "pointermove", 500, 500, { pointerId: 2 });
  assert.equal(frames.length, 0);
  assert.equal(win.frames.size, 1);
  win.flush();
  assert.equal(frames.length, 1);
  assert.equal(frames[0].clientX, 120);
  pointer(win, "pointerup", 145, 155);
  assert.equal(frames.at(-1)?.deltaX, 45);
  assert.equal(frames.at(-1)?.deltaY, 55);
  assert.deepEqual(finishes, [[true, true]]);
  assert.equal(win.frames.size, 0);
  assert.deepEqual(doc.body.style, { cursor: "crosshair", userSelect: "text" });
  assert.equal((start.currentTarget as unknown as { captured: boolean }).captured, false);
  pointer(win, "pointermove", 200, 200);
  assert.equal(win.frames.size, 0);
}));

test("a click and sub-threshold travel never activate or create a layout preview", () => environment((win) => {
  let updates = 0;
  let activations = 0;
  const finishes: boolean[][] = [];
  beginPointerGesture(press(), { ...BASE, onStart: () => activations++, onFrame: () => updates++, onFinish: (...result) => finishes.push(result) });
  pointer(win, "pointermove", 102, 102);
  pointer(win, "pointerup", 102, 102);
  assert.equal(activations, 0);
  assert.equal(updates, 0);
  assert.deepEqual(finishes, [[true, false]]);
  assert.equal(win.frames.size, 0);
}));

test("Escape cancels pending frames without a final update or commit", () => environment((win, doc) => {
  let updates = 0;
  const finishes: boolean[][] = [];
  const cancel = beginPointerGesture(press(), { ...BASE, onFrame: () => updates++, onFinish: (...result) => finishes.push(result) });
  pointer(win, "pointermove", 120, 120);
  assert.equal(doc.body.style.cursor, "grabbing");
  win.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }));
  win.flush();
  cancel();
  pointer(win, "pointerup", 160, 160);
  assert.equal(updates, 0);
  assert.deepEqual(finishes, [[false, true]]);
  assert.equal(win.frames.size, 0);
  assert.equal(doc.body.style.userSelect, "text");
}));

test("breakpoint, visibility, blur, and context-menu interruptions cancel exactly once", () => {
  for (const interrupt of ["breakpoint", "visibility", "blur", "contextmenu"]) environment((win, doc) => {
    const finishes: boolean[][] = [];
    beginPointerGesture(press(), { ...BASE, onFrame: () => {}, onFinish: (...result) => finishes.push(result) });
    pointer(win, "pointermove", 130, 130);
    if (interrupt === "breakpoint") win.breakpoint.dispatchEvent(new Event("change"));
    else if (interrupt === "visibility") {
      doc.visibilityState = "hidden";
      doc.dispatchEvent(new Event("visibilitychange"));
    } else win.dispatchEvent(new Event(interrupt));
    pointer(win, "pointerup", 140, 140);
    win.flush();
    assert.deepEqual(finishes, [[false, true]], interrupt);
    assert.equal(win.frames.size, 0, interrupt);
    assert.equal(doc.body.style.cursor, "crosshair", interrupt);
  });
});

test("edge scrolling starts only toward the edge and stops when the card has no room", () => environment((win) => {
  let room = true;
  let latest: GesturePoint | undefined;
  const cancel = beginPointerGesture(press(100, 780), {
    ...BASE, scrollRoom: () => ({ up: room, down: room }), onFrame: (point) => { latest = point; }, onFinish: () => {},
  });
  pointer(win, "pointermove", 120, 780);
  win.flush();
  assert.equal(win.scrollY, 0);
  assert.equal(win.frames.size, 0);
  pointer(win, "pointermove", 120, 792);
  win.flush();
  assert.ok(win.scrollY > 0);
  assert.ok(latest && latest.deltaY > 12);
  assert.equal(win.frames.size, 1);
  const position = win.scrollY;
  room = false;
  win.flush();
  assert.equal(win.scrollY, position);
  assert.equal(win.frames.size, 0);
  cancel();
  win.dispatchEvent(new Event("scroll"));
  assert.equal(win.frames.size, 0);
}));

test("width resizing can disable edge scrolling and missed releases use the latest position", () => environment((win) => {
  let latest: GesturePoint | undefined;
  const finishes: boolean[][] = [];
  beginPointerGesture(press(100, 700), {
    ...BASE, autoScroll: false, onFrame: (point) => { latest = point; }, onFinish: (...result) => finishes.push(result),
  });
  pointer(win, "pointermove", 130, 799);
  win.flush();
  assert.equal(win.scrollY, 0);
  pointer(win, "pointermove", 180, 799, { buttons: 0 });
  assert.equal(latest?.clientX, 180);
  assert.deepEqual(finishes, [[true, true]]);
}));

test("only the owning pointer can cancel and non-primary presses are ignored", () => environment((win) => {
  const finishes: boolean[][] = [];
  beginPointerGesture({ ...press(), isPrimary: false }, { ...BASE, onFrame: () => assert.fail(), onFinish: () => assert.fail() });
  assert.equal(win.frames.size, 0);
  beginPointerGesture(press(), { ...BASE, onFrame: () => {}, onFinish: (...result) => finishes.push(result) });
  pointer(win, "pointermove", 120, 120);
  pointer(win, "pointercancel", 120, 120, { pointerId: 2 });
  assert.equal(finishes.length, 0);
  pointer(win, "pointercancel", 120, 120);
  assert.deepEqual(finishes, [[false, true]]);
  assert.equal(win.frames.size, 0);
}));

test("edge speed and shared card resistance stay bounded", () => {
  assert.equal(gestureScrollSpeed(790, 790, 800), 0);
  assert.equal(gestureScrollSpeed(0, 100, 800), -16);
  assert.equal(gestureScrollSpeed(-100, 100, 800), -22);
  assert.equal(gestureResistance(20, 0, 100), 20);
  assert.ok(gestureResistance(1000, 0, 100) < 156);
  assert.ok(gestureResistance(-1000, 0, 100) > -56);
});
