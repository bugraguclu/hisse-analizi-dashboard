"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useStockIdentity, type IdentityState } from "./hooks";

export const StockIdentityContext = createContext<IdentityState>({ status: "loading", identity: null });

/** Identity of the stock rendered by the surrounding StockShell (or StockIdentityScope). */
export function useShellIdentity(): IdentityState {
  return useContext(StockIdentityContext);
}

/** Provides a stock's identity to cards rendered outside a StockShell (widgets on custom pages). */
export function StockIdentityScope({ ticker, children }: { ticker: string; children: ReactNode }) {
  const identity = useStockIdentity(ticker);
  return <StockIdentityContext.Provider value={identity}>{children}</StockIdentityContext.Provider>;
}
