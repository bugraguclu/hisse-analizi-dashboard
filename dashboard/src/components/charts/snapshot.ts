import type { IChartApi } from "lightweight-charts";
import { rgba, type ChartPalette } from "./colors";

/** One legend entry drawn onto the snapshot: a colour key, a muted label and its values. */
export interface SnapshotLabel {
  color: string;
  label: string;
  value: string;
}

export interface SnapshotHeader {
  /** "THYAO · Türk Hava Yolları". */
  title: string;
  /** "3A · Günlük · 26 Eyl 2026 18:10". */
  subtitle: string;
  /** Last price, printed large on the right. */
  value: string;
  /** Change line under the value, e.g. "−%11,49 (−37,75)". */
  change: string;
  tone: "up" | "down" | "flat";
  footer: string;
  /** Price-pane legend (overlays), drawn at the top-left of the chart. */
  overlays?: readonly SnapshotLabel[];
  /** Indicator-pane legends; `top` in CSS px from the top of the chart canvas. */
  panes?: ReadonlyArray<{ top: number; items: readonly SnapshotLabel[] }>;
}

/**
 * The chart canvas framed like a TradingView snapshot: a header with the
 * symbol, period and last price, the chart (with drawings, markers and
 * watermark, which live on the canvas) and an attribution footer.
 */
export function composeSnapshot(chart: IChartApi, palette: ChartPalette, header: SnapshotHeader): Promise<Blob | null> {
  const shot = chart.takeScreenshot(true, false);
  // takeScreenshot returns device pixels; lay the frame out in CSS pixels × ratio.
  const cssWidth = chart.timeScale().width() + chart.priceScale("right").width();
  const ratio = cssWidth > 0 ? shot.width / cssWidth : window.devicePixelRatio || 1;
  const pad = Math.round(16 * ratio);
  const headerHeight = Math.round(56 * ratio);
  const footerHeight = Math.round(28 * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = shot.width + pad * 2;
  canvas.height = shot.height + headerHeight + footerHeight;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);

  context.fillStyle = rgba(palette.card);
  context.fillRect(0, 0, canvas.width, canvas.height);

  const px = (size: number) => `${Math.round(size * ratio)}px`;
  context.textBaseline = "alphabetic";
  context.fillStyle = rgba(palette.foreground);
  context.font = `600 ${px(15)} ${palette.fontFamily}`;
  context.fillText(header.title, pad, Math.round(26 * ratio));
  context.fillStyle = rgba(palette.muted);
  context.font = `${px(11)} ${palette.fontFamily}`;
  context.fillText(header.subtitle, pad, Math.round(44 * ratio));

  context.textAlign = "right";
  context.fillStyle = rgba(palette.foreground);
  context.font = `600 ${px(15)} ${palette.monoFamily}`;
  context.fillText(header.value, canvas.width - pad, Math.round(26 * ratio));
  context.fillStyle = rgba(header.tone === "up" ? palette.up : header.tone === "down" ? palette.down : palette.muted);
  context.font = `500 ${px(11)} ${palette.monoFamily}`;
  context.fillText(header.change, canvas.width - pad, Math.round(44 * ratio));
  context.textAlign = "left";

  context.drawImage(shot, pad, headerHeight);

  // The HTML legends are not part of the canvas: repeat them, like TradingView's snapshots do.
  const drawLabels = (items: readonly SnapshotLabel[], y: number) => {
    let x = pad + Math.round(6 * ratio);
    context.font = `${px(11)} ${palette.monoFamily}`;
    context.textBaseline = "middle";
    for (const item of items) {
      context.fillStyle = item.color;
      context.fillRect(x, y - Math.round(ratio), Math.round(10 * ratio), Math.max(1, Math.round(2 * ratio)));
      x += Math.round(14 * ratio);
      context.fillStyle = rgba(palette.muted);
      context.fillText(item.label, x, y);
      x += context.measureText(item.label).width + Math.round(6 * ratio);
      context.fillStyle = rgba(palette.foreground);
      context.fillText(item.value, x, y);
      x += context.measureText(item.value).width + Math.round(16 * ratio);
    }
    context.textBaseline = "alphabetic";
  };
  if (header.overlays?.length) drawLabels(header.overlays, headerHeight + Math.round(10 * ratio));
  for (const pane of header.panes ?? []) drawLabels(pane.items, headerHeight + Math.round((pane.top + 12) * ratio));

  context.strokeStyle = rgba(palette.border);
  context.lineWidth = Math.max(1, Math.round(ratio));
  context.beginPath();
  context.moveTo(pad, canvas.height - footerHeight + 0.5);
  context.lineTo(canvas.width - pad, canvas.height - footerHeight + 0.5);
  context.stroke();
  context.fillStyle = rgba(palette.muted);
  context.font = `${px(10)} ${palette.fontFamily}`;
  context.fillText(header.footer, pad, canvas.height - Math.round(10 * ratio));

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Copies a PNG to the clipboard. Safari only accepts the write inside the user
 * gesture, so the ClipboardItem gets the promise, not the resolved blob.
 */
export async function copyPng(blob: Promise<Blob | null>): Promise<boolean> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
  try {
    const png = blob.then((value) => {
      if (!value) throw new Error("snapshot failed");
      return value;
    });
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    return true;
  } catch {
    return false;
  }
}
