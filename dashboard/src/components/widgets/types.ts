import type { ComponentType } from "react";
import type { OptionValue } from "./model";

export interface WidgetComponentProps {
  ticker: string;
  options: Record<string, OptionValue>;
}

/** Widget type → the component that renders it. */
export type WidgetComponents = Readonly<Record<string, ComponentType<WidgetComponentProps>>>;
