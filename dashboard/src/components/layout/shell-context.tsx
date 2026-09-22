"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { usePathname } from "next/navigation";

interface ShellContextValue {
  mobileNavOpen: boolean;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  /** The hamburger button; focus returns to it when the drawer closes. */
  mobileNavTriggerRef: RefObject<HTMLButtonElement | null>;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The drawer belongs to the page it was opened on, so any navigation
  // (link, back/forward) closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null);
  const openMobileNav = useCallback(() => setOpenedOn(pathname), [pathname]);
  const closeMobileNav = useCallback(() => setOpenedOn(null), []);
  const mobileNavOpen = openedOn !== null && openedOn === pathname;
  const value = useMemo(
    () => ({ mobileNavOpen, openMobileNav, closeMobileNav, mobileNavTriggerRef }),
    [mobileNavOpen, openMobileNav, closeMobileNav],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside <ShellProvider>");
  return context;
}
