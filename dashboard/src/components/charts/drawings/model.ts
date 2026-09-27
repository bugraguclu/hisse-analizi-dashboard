/**
 * Plain-data rules of a drawing: which shapes exist, how many points they
 * take, what a valid stored drawing looks like and how an edit handle changes
 * it. Pure, so the store and the pointer layer share one definition.
 */

import type { Drawing, DrawingKind, DrawingPoint, DrawingTool } from "./types";

export const DRAWING_KINDS: readonly DrawingKind[] = ["trend", "ray", "hline", "vline", "rect", "fib"];

/** Drawings kept per symbol; the oldest go first. */
export const MAX_DRAWINGS = 200;

/** Palette slots a drawing can use: −1 is the foreground ink, 0–4 the categorical colours. */
export const DRAWING_COLORS: readonly number[] = [-1, 0, 1, 2, 3, 4];

/**
 * First colour of each tool: quiet, one per kind instead of a rainbow cycle,
 * so a chart full of lines still reads as one system.
 */
export const DEFAULT_COLOR: Readonly<Record<DrawingKind, number>> = {
  trend: 0,
  ray: 0,
  hline: 1,
  vline: 4,
  rect: 3,
  fib: 2,
};

const MAX_ID_LENGTH = 64;

export function isDrawingKind(value: unknown): value is DrawingKind {
  return typeof value === "string" && (DRAWING_KINDS as readonly string[]).includes(value);
}

/** The tool places a stored drawing (not the cursor or the measure tool). */
export function isPlacementTool(tool: DrawingTool): tool is DrawingKind {
  return isDrawingKind(tool);
}

/** hline / vline are anchored by one point, everything else by two. */
export function pointCount(kind: DrawingKind): 1 | 2 {
  return kind === "hline" || kind === "vline" ? 1 : 2;
}

function sanitizePoint(value: unknown): DrawingPoint | null {
  if (!value || typeof value !== "object") return null;
  const { time, price } = value as Record<string, unknown>;
  if (typeof time !== "number" || typeof price !== "number") return null;
  if (!Number.isFinite(time) || !Number.isFinite(price)) return null;
  return { time, price };
}

/** A well-formed copy of one stored drawing (unknown fields dropped), or null. */
export function sanitizeDrawing(value: unknown): Drawing | null {
  if (!value || typeof value !== "object") return null;
  const { id, kind, points, color, dashed } = value as Record<string, unknown>;
  if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH) return null;
  if (!isDrawingKind(kind)) return null;
  if (!Array.isArray(points) || points.length !== pointCount(kind)) return null;
  if (typeof color !== "number" || !Number.isInteger(color) || color < -1 || color > 4) return null;
  const clean: DrawingPoint[] = [];
  for (const point of points) {
    const sane = sanitizePoint(point);
    if (!sane) return null;
    clean.push(sane);
  }
  const drawing: Drawing = { id, kind, points: clean, color };
  if (dashed === true) drawing.dashed = true;
  return drawing;
}

/**
 * Valid drawings of an untrusted list (localStorage, other tabs): malformed
 * items and repeated ids are dropped, at most `MAX_DRAWINGS` newest are kept.
 */
export function sanitizeDrawings(value: unknown): Drawing[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Drawing[] = [];
  for (const item of value) {
    const drawing = sanitizeDrawing(item);
    if (!drawing || seen.has(drawing.id)) continue;
    seen.add(drawing.id);
    result.push(drawing);
  }
  return result.length > MAX_DRAWINGS ? result.slice(result.length - MAX_DRAWINGS) : result;
}

function sameDrawing(a: Drawing, b: Drawing): boolean {
  if (a === b) return true;
  if (a.id !== b.id || a.kind !== b.kind || a.color !== b.color || Boolean(a.dashed) !== Boolean(b.dashed)) return false;
  if (a.points.length !== b.points.length) return false;
  return a.points.every((point, i) => point.time === b.points[i].time && point.price === b.points[i].price);
}

/** Same drawings in the same order (the store hands back parsed copies, so references differ). */
export function drawingsEqual(a: readonly Drawing[] | null, b: readonly Drawing[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((drawing, i) => sameDrawing(drawing, b[i]));
}

/** Edit handles of a drawing: its points, plus the two free corners of a rectangle. */
export function handleCount(kind: DrawingKind): number {
  if (kind === "rect") return 4;
  return pointCount(kind);
}

/**
 * Handle `handle` moved to `point`. Rectangle handles 2 and 3 are the corners
 * (first time, second price) and (second time, first price).
 */
export function moveHandle(drawing: Drawing, handle: number, point: DrawingPoint): Drawing {
  const points = drawing.points.map((p) => ({ ...p }));
  if (drawing.kind === "rect" && handle >= 2) {
    const [a, b] = points;
    if (handle === 2) {
      a.time = point.time;
      b.price = point.price;
    } else {
      b.time = point.time;
      a.price = point.price;
    }
  } else if (points[handle]) {
    points[handle] = { time: point.time, price: point.price };
  }
  return { ...drawing, points };
}
