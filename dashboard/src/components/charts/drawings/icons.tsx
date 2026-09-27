import type { SVGProps } from "react";

/**
 * Pictograms of the drawing tools (lucide has no chart-drawing set). Drawn on
 * an 18-unit grid with a 1.5 stroke in `currentColor`, so at 14–16 px they sit
 * next to lucide icons without looking heavier; anchor points are small rings.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 18 18"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.1 12.9 12.9 5.1" />
      <circle cx="3.75" cy="14.25" r="1.75" />
      <circle cx="14.25" cy="3.75" r="1.75" />
    </Icon>
  );
}

export function RayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.1 12.9 16.5 1.5" />
      <circle cx="3.75" cy="14.25" r="1.75" />
    </Icon>
  );
}

export function HorizontalLineIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 9h5.75M10.75 9h5.75" />
      <circle cx="9" cy="9" r="1.75" />
    </Icon>
  );
}

export function VerticalLineIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 1.5v5.75M9 10.75v5.75" />
      <circle cx="9" cy="9" r="1.75" />
    </Icon>
  );
}

export function RectangleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4h9.5v8.5M13 14H3.5V5.5" />
      <circle cx="3.5" cy="4" r="1.5" />
      <circle cx="14.5" cy="14" r="1.5" />
    </Icon>
  );
}

export function FibonacciIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 3.5h11M1.5 7.25h15M1.5 10.75h15M5.5 14.5h11" />
      <circle cx="14.5" cy="3.5" r="1.5" />
      <circle cx="3.5" cy="14.5" r="1.5" />
    </Icon>
  );
}

/** Dashed-line toggle of the edit bar. */
export function DashedLineIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M1.5 9h3M7.5 9h3M13.5 9h3" />
    </Icon>
  );
}
