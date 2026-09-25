/**
 * Canvas charts cannot read CSS variables, and the design tokens are oklch()
 * values that lightweight-charts cannot parse. Tokens are resolved at runtime by
 * painting them into a 1×1 canvas and reading the sRGB pixel back, so charts
 * follow every theme/token change without copying values.
 */

export type Rgb = readonly [number, number, number];

export interface ChartPalette {
  up: Rgb;
  down: Rgb;
  warn: Rgb;
  primary: Rgb;
  foreground: Rgb;
  muted: Rgb;
  border: Rgb;
  grid: Rgb;
  card: Rgb;
  /** Categorical --chart-1..5 in fixed order. */
  series: readonly [Rgb, Rgb, Rgb, Rgb, Rgb];
  fontFamily: string;
  monoFamily: string;
  dark: boolean;
}

let probeContext: CanvasRenderingContext2D | null | undefined;

function probe(): CanvasRenderingContext2D | null {
  if (probeContext === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    probeContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  return probeContext;
}

const SENTINEL = "#010203";

/** Any CSS color (oklch, color-mix, hex...) → sRGB triple; `fallback` when unparsable. */
export function cssColorToRgb(value: string, fallback: Rgb): Rgb {
  const context = probe();
  const color = value.trim();
  if (!context || !color) return fallback;
  context.fillStyle = SENTINEL;
  context.fillStyle = color;
  if (context.fillStyle === SENTINEL && color.toLowerCase() !== SENTINEL) return fallback;
  context.clearRect(0, 0, 1, 1);
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

export function rgba(color: Rgb, alpha = 1): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

function luminance([r, g, b]: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function fontOf(host: Element, className: string): string {
  const span = document.createElement("span");
  span.className = className;
  span.style.position = "absolute";
  span.style.visibility = "hidden";
  host.appendChild(span);
  const family = getComputedStyle(span).fontFamily;
  span.remove();
  return family;
}

/** Read the current design tokens as seen from `host` (theme class, scoped overrides). */
export function readChartPalette(host: Element): ChartPalette {
  const style = getComputedStyle(host);
  const token = (name: string, fallback: Rgb) => cssColorToRgb(style.getPropertyValue(name), fallback);
  const card = token("--card", [255, 255, 255]);
  return {
    up: token("--up", [22, 142, 84]),
    down: token("--down", [210, 56, 45]),
    warn: token("--warn", [190, 125, 30]),
    primary: token("--primary", [45, 90, 170]),
    foreground: token("--foreground", [30, 30, 30]),
    muted: token("--muted-foreground", [115, 115, 110]),
    border: token("--border", [228, 228, 224]),
    grid: token("--grid", [234, 234, 230]),
    card,
    series: [
      token("--chart-1", [52, 96, 170]),
      token("--chart-2", [196, 140, 48]),
      token("--chart-3", [140, 70, 140]),
      token("--chart-4", [60, 130, 150]),
      token("--chart-5", [130, 128, 122]),
    ],
    fontFamily: fontOf(host, "font-sans") || getComputedStyle(document.body).fontFamily,
    monoFamily: fontOf(host, "font-mono") || "ui-monospace, monospace",
    dark: luminance(card) < 0.5,
  };
}

/**
 * Calls `onChange` whenever the theme can have changed: class/style/data-theme on
 * <html> (next-themes) or <body>. Returns the unsubscribe function.
 */
export function observeTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  const options: MutationObserverInit = { attributes: true, attributeFilter: ["class", "style", "data-theme"] };
  observer.observe(document.documentElement, options);
  observer.observe(document.body, options);
  return () => observer.disconnect();
}

/** CSS custom property per categorical slot, for HTML keys next to canvas series. */
export const SERIES_CSS_VAR = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"] as const;
