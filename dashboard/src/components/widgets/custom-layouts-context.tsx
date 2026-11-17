"use client";

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import type { BuiltInPage } from "./defaults";
import { CUSTOM_LAYOUTS_COOKIE, parseCustomLayoutsCookie } from "./custom-layouts-cookie";

export { CUSTOM_LAYOUTS_COOKIE, parseCustomLayoutsCookie };

const CustomLayoutsContext = createContext<ReadonlySet<BuiltInPage>>(new Set());

export function CustomLayoutsProvider({
  customLayouts,
  children,
}: {
  customLayouts?: readonly BuiltInPage[] | ReadonlySet<BuiltInPage>;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    if (customLayouts instanceof Set) return customLayouts as ReadonlySet<BuiltInPage>;
    return new Set<BuiltInPage>(customLayouts ?? []);
  }, [customLayouts]);

  return createElement(CustomLayoutsContext.Provider, { value }, children);
}

export function useCustomLayouts(): ReadonlySet<BuiltInPage> {
  return useContext(CustomLayoutsContext);
}
