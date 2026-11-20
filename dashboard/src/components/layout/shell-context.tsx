"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { usePathname } from "next/navigation";

export type WorkspaceManagerTab = "backup" | "offline";

interface ShellContextValue {
  mobileNavOpen: boolean;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  /** The hamburger button; focus returns to it when the drawer closes. */
  mobileNavTriggerRef: RefObject<HTMLButtonElement | null>;
  /** The legal notice dialog (LegalNotice.tsx), reopened from the footer link. */
  legalNoticeRef: RefObject<HTMLDialogElement | null>;
  /** Workspace backup & offline summary dialog state. */
  workspaceManagerOpen: boolean;
  workspaceManagerTab: WorkspaceManagerTab;
  openWorkspaceManager: (tab?: WorkspaceManagerTab) => void;
  closeWorkspaceManager: () => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The drawer belongs to the page it was opened on, so any navigation
  // (link, back/forward) closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [workspaceManagerTab, setWorkspaceManagerTab] = useState<WorkspaceManagerTab>("backup");
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null);
  const legalNoticeRef = useRef<HTMLDialogElement>(null);
  const openMobileNav = useCallback(() => setOpenedOn(pathname), [pathname]);
  const closeMobileNav = useCallback(() => setOpenedOn(null), []);
  const openWorkspaceManager = useCallback((tab: WorkspaceManagerTab = "backup") => {
    setWorkspaceManagerTab(tab);
    setWorkspaceManagerOpen(true);
  }, []);
  const closeWorkspaceManager = useCallback(() => {
    setWorkspaceManagerOpen(false);
  }, []);
  const mobileNavOpen = openedOn !== null && openedOn === pathname;
  const value = useMemo(
    () => ({
      mobileNavOpen,
      openMobileNav,
      closeMobileNav,
      mobileNavTriggerRef,
      legalNoticeRef,
      workspaceManagerOpen,
      workspaceManagerTab,
      openWorkspaceManager,
      closeWorkspaceManager,
    }),
    [
      mobileNavOpen,
      openMobileNav,
      closeMobileNav,
      workspaceManagerOpen,
      workspaceManagerTab,
      openWorkspaceManager,
      closeWorkspaceManager,
    ],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside <ShellProvider>");
  return context;
}
