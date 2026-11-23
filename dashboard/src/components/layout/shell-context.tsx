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
  /** The AI assistant sheet (components/assistant). */
  assistantOpen: boolean;
  /** Opens the assistant; a `question` is asked right away (from the site search). */
  openAssistant: (question?: string) => void;
  closeAssistant: () => void;
  /** A question waiting to be asked by the opened sheet (`nonce` makes repeats distinct). */
  assistantSeed: { question: string; nonce: number } | null;
  clearAssistantSeed: () => void;
  /** What had focus when the assistant opened (focus goes back there on close). */
  assistantOpenerRef: RefObject<HTMLElement | null>;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The drawer belongs to the page it was opened on, so any navigation
  // (link, back/forward) closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const [workspaceManagerOpen, setWorkspaceManagerOpen] = useState(false);
  const [workspaceManagerTab, setWorkspaceManagerTab] = useState<WorkspaceManagerTab>("backup");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantSeed, setAssistantSeed] = useState<{ question: string; nonce: number } | null>(null);
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null);
  const legalNoticeRef = useRef<HTMLDialogElement>(null);
  const assistantOpenerRef = useRef<HTMLElement | null>(null);
  const openMobileNav = useCallback(() => setOpenedOn(pathname), [pathname]);
  const closeMobileNav = useCallback(() => setOpenedOn(null), []);
  const openWorkspaceManager = useCallback((tab: WorkspaceManagerTab = "backup") => {
    setWorkspaceManagerTab(tab);
    setWorkspaceManagerOpen(true);
  }, []);
  const closeWorkspaceManager = useCallback(() => {
    setWorkspaceManagerOpen(false);
  }, []);
  const openAssistant = useCallback((question?: string) => {
    // Focus returns here when the sheet closes (it is not opened by a Dialog.Trigger).
    assistantOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const trimmed = question?.trim();
    if (trimmed) setAssistantSeed((previous) => ({ question: trimmed, nonce: (previous?.nonce ?? 0) + 1 }));
    setOpenedOn(null);
    setAssistantOpen(true);
  }, []);
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);
  const clearAssistantSeed = useCallback(() => setAssistantSeed(null), []);
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
      assistantOpen,
      openAssistant,
      closeAssistant,
      assistantSeed,
      clearAssistantSeed,
      assistantOpenerRef,
    }),
    [
      mobileNavOpen,
      openMobileNav,
      closeMobileNav,
      workspaceManagerOpen,
      workspaceManagerTab,
      openWorkspaceManager,
      closeWorkspaceManager,
      assistantOpen,
      openAssistant,
      closeAssistant,
      assistantSeed,
      clearAssistantSeed,
      assistantOpenerRef,
    ],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (!context) throw new Error("useShell must be used inside <ShellProvider>");
  return context;
}

/** The shell when rendered inside it, else null (for components that also render standalone). */
export function useOptionalShell(): ShellContextValue | null {
  return useContext(ShellContext);
}
