import type { SVGProps } from "react";
import type { ChartType } from "./types";

/** 16 px pictograms of the chart styles, drawn in `currentColor` like the lucide set beside them. */
function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

export function ChartTypeIcon({ type, className }: { type: ChartType; className?: string }) {
  switch (type) {
    case "area":
      return (
        <Svg className={className}>
          <path d="M1.5 12.5 5 7.5l3 2.5 3.5-5.5 3 3" />
          <path d="M1.5 12.5 5 7.5l3 2.5 3.5-5.5 3 3v6.5h-13z" fill="currentColor" fillOpacity={0.18} stroke="none" />
        </Svg>
      );
    case "line":
      return (
        <Svg className={className}>
          <path d="M1.5 12 5 7l3 2.5L11.5 4l3 3" />
        </Svg>
      );
    case "baseline":
      return (
        <Svg className={className}>
          <path d="M1 8.5h14" strokeDasharray="1.6 1.6" strokeWidth={1} />
          <path d="M1.5 11 4.5 6l3 4 3-6.5 4 3" />
        </Svg>
      );
    case "candles":
      return (
        <Svg className={className}>
          <path d="M4.5 2v2.5M4.5 10.5V14M11.5 3.5V6M11.5 11v3" />
          <rect x={3} y={4.5} width={3} height={6} rx={0.5} fill="currentColor" />
          <rect x={10} y={6} width={3} height={5} rx={0.5} fill="currentColor" />
        </Svg>
      );
    case "hollow":
      return (
        <Svg className={className}>
          <path d="M4.5 2v2.5M4.5 10.5V14M11.5 3.5V6M11.5 11v3" />
          <rect x={3} y={4.5} width={3} height={6} rx={0.5} />
          <rect x={10} y={6} width={3} height={5} rx={0.5} fill="currentColor" />
        </Svg>
      );
    case "heikin":
      return (
        <Svg className={className}>
          <path d="M3 9.5v4M8 6v5M13 2.5v4.5" />
          <rect x={1.75} y={10} width={2.5} height={3} rx={0.4} fill="currentColor" />
          <rect x={6.75} y={7} width={2.5} height={3.5} rx={0.4} fill="currentColor" />
          <rect x={11.75} y={3.5} width={2.5} height={3} rx={0.4} fill="currentColor" />
        </Svg>
      );
    case "bars":
      return (
        <Svg className={className}>
          <path d="M5 2.5v11M3 5h2M5 11h2M11 4v9.5M9 11.5h2M11 6.5h2" />
        </Svg>
      );
  }
}
