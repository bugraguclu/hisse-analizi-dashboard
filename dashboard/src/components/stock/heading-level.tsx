"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Heading level of SectionCard titles: h2 directly on a page, h3 when the cards
 * sit under a column heading (the combined view's technical/fundamental columns).
 */
const SectionHeadingLevelContext = createContext<2 | 3>(2);

export function SectionHeadingLevel({ level, children }: { level: 2 | 3; children: ReactNode }) {
  return <SectionHeadingLevelContext.Provider value={level}>{children}</SectionHeadingLevelContext.Provider>;
}

export function useSectionHeadingLevel(): 2 | 3 {
  return useContext(SectionHeadingLevelContext);
}
