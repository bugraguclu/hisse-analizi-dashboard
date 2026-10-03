"use client";

import { useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { BarChart3, ChartCandlestick, Coins, Copy, Ellipsis, Globe, LayoutDashboard, Pencil, Plus, Scale, SquarePlus, Trash2, X, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { MENU_ITEM_CLASS, POPUP_CLASS } from "@/components/charts/controls";
import { DEFAULT_TICKER } from "@/components/layout/nav";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TEMPLATES, type TemplateId } from "./defaults";
import { EditLayoutButton } from "./EditBar";
import { useWidgetI18n } from "./i18n";
import type { WidgetKey } from "./i18n-dict";
import { widgetCount, type Layout } from "./model";
import { MAX_PAGES, pageActions, useCustomPages, useHydrated, type CustomPage } from "./store";
import { TickerPicker } from "./TickerPicker";
import { useLayoutEditor } from "./use-layout-editor";
import { WidgetBoard } from "./WidgetBoard";

const PAGE_PARAM = "p";
const EMPTY_LAYOUT: Layout = { rows: [] };

const TEMPLATE_ICONS: Record<TemplateId, LucideIcon> = {
  overview: ChartCandlestick,
  fundamental: Scale,
  technical: BarChart3,
  dividend: Coins,
  home: LayoutDashboard,
  macro: Globe,
};

function pageHref(id: string): string {
  return `/sayfalarim?${PAGE_PARAM}=${encodeURIComponent(id)}`;
}

/**
 * Shows another of the visitor's pages. Native history, which Next.js keeps in
 * sync with useSearchParams: the pages live in this browser, so switching
 * needs no server round trip (router.push waits for one: seconds on a busy
 * server, with the previous page still on screen).
 */
function showPage(id: string | null, mode: "push" | "replace") {
  const url = id ? pageHref(id) : "/sayfalarim";
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

/** The first candidate name no page has yet ("Sayfam 3", "Teknik analiz 2"). */
function uniqueName(pages: readonly CustomPage[], candidate: (attempt: number) => string): string {
  const names = new Set(pages.map((page) => page.name));
  for (let attempt = 0; attempt < 100; attempt++) if (!names.has(candidate(attempt))) return candidate(attempt);
  return candidate(0);
}

/**
 * /sayfalarim — the visitor's own pages: a blank page or a template to start
 * from, then the same editor as the site's pages (any widget, any size, any
 * stock). Pages live in this browser (localStorage); `?p=<id>` picks one.
 */
export function CustomPagesView() {
  const hydrated = useHydrated();
  const pages = useCustomPages();
  const params = useSearchParams();
  const requested = params.get(PAGE_PARAM);
  const active = pages.find((page) => page.id === requested) ?? pages[0] ?? null;
  // A page just created opens in edit mode.
  const [editOnOpen, setEditOnOpen] = useState<string | null>(null);

  const create = useCallback(
    (name: string, layout: Layout, ticker: string) => {
      const id = pageActions.create(name, ticker, layout);
      if (!id) return null;
      setEditOnOpen(widgetCount(layout) === 0 ? id : null);
      showPage(id, "push");
      return id;
    },
    [],
  );

  if (!hydrated) return <PagesSkeleton />;
  if (!active) return <Intro pages={pages} onCreate={create} />;
  return <PageScreen key={active.id} page={active} pages={pages} onCreate={create} initialEditing={editOnOpen === active.id} />;
}

function PagesSkeleton() {
  const { t } = useWidgetI18n();
  return (
    <div className="mx-auto max-w-7xl space-y-6" role="status" aria-live="polite">
      <span className="sr-only">{t("pages.loading")}</span>
      <div aria-hidden className="space-y-2 border-b border-border pb-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-64" />
      </div>
      <div aria-hidden className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

type CreatePage = (name: string, layout: Layout, ticker: string) => string | null;

/** Blank page or one of the templates. */
function StartOptions({ pages, onCreate, ticker }: { pages: readonly CustomPage[]; onCreate: CreatePage; ticker: string }) {
  const { t } = useWidgetI18n();
  const full = pages.length >= MAX_PAGES;
  const start = (name: string, layout: Layout) => {
    if (!onCreate(name, layout, ticker)) toast.error(t("pages.limit", { max: MAX_PAGES }));
  };
  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={full}
        onClick={() => start(uniqueName(pages, (attempt) => t("pages.defaultName", { n: pages.length + 1 + attempt })), EMPTY_LAYOUT)}
        className="group flex w-full items-center gap-4 rounded-xl border border-dashed border-foreground/25 bg-card p-5 text-left transition-colors hover:border-primary hover:bg-primary/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
          <SquarePlus className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-foreground">{t("pages.startBlank")}</span>
          <span className="block text-[13px] text-muted-foreground">{t("pages.startBlankDesc")}</span>
        </span>
      </button>
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{t("pages.templates")}</p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((template) => {
          const Icon = TEMPLATE_ICONS[template.id];
          const label = t(`pages.template.${template.id}` as WidgetKey);
          return (
            <li key={template.id} className="flex">
              <button
                type="button"
                disabled={full}
                onClick={() => start(uniqueName(pages, (attempt) => (attempt === 0 ? label : `${label} ${attempt + 1}`)), template.layout)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-foreground">{label}</span>
                  <span className="block text-xs text-muted-foreground">{t("pages.templateWidgets", { count: widgetCount(template.layout) })}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {full ? <p className="text-xs text-muted-foreground">{t("pages.limit", { max: MAX_PAGES })}</p> : null}
      <p className="text-xs text-muted-foreground">{t("pages.storageNote")}</p>
    </div>
  );
}

function Intro({ pages, onCreate }: { pages: readonly CustomPage[]; onCreate: CreatePage }) {
  const { t } = useWidgetI18n();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader eyebrow={t("pages.title")} title={t("pages.introTitle")} />
      <StartOptions pages={pages} onCreate={onCreate} ticker={DEFAULT_TICKER} />
    </div>
  );
}

/** One custom page: tabs to the others, its stock, the board. */
function PageScreen({ page, pages, onCreate, initialEditing }: { page: CustomPage; pages: readonly CustomPage[]; onCreate: CreatePage; initialEditing: boolean }) {
  const { t } = useWidgetI18n();
  const save = useCallback((layout: Layout | null) => pageActions.setLayout(page.id, layout ?? EMPTY_LAYOUT), [page.id]);
  const editor = useLayoutEditor({ layout: page.layout, save, initialEditing });
  const [dialog, setDialog] = useState<"new" | "rename" | null>(null);

  const remove = () => {
    const index = pages.findIndex((p) => p.id === page.id);
    const next = pages[index + 1] ?? pages[index - 1];
    pageActions.remove(page.id);
    showPage(next?.id ?? null, "replace");
    toast(t("pages.deleted", { name: page.name }), {
      action: {
        label: t("edit.undo"),
        onClick: () => {
          if (!pageActions.restore(page, index)) {
            toast.error(t("pages.limit", { max: MAX_PAGES }));
            return;
          }
          showPage(page.id, "replace");
        },
      },
    });
  };

  const duplicate = () => {
    const id = pageActions.duplicate(page.id, t("pages.copyName", { name: page.name }));
    if (id) showPage(id, "push");
    else toast.error(t("pages.limit", { max: MAX_PAGES }));
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow={t("pages.eyebrow")}
        title={<span className="break-words">{page.name}</span>}
        actions={
          <>
            <TickerPicker value={page.ticker} onChange={(ticker) => pageActions.setTicker(page.id, ticker)} label={t("pages.changeStock")}>
              <span className="text-muted-foreground">{t("pages.stock")}</span>
            </TickerPicker>
            <EditLayoutButton editor={editor} />
            <Menu.Root>
              <Menu.Trigger aria-label={t("pages.menu")} title={t("pages.menu")} className={cn(buttonVariants({ variant: "outline", size: "md" }), "w-8 px-0")}>
                <Ellipsis aria-hidden />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={12} className="z-[90]">
                  <Menu.Popup className={cn(POPUP_CLASS, "min-w-48 p-1")}>
                    <Menu.Item className={MENU_ITEM_CLASS} onClick={() => setDialog("rename")}>
                      <Pencil aria-hidden className="size-4 text-muted-foreground" />
                      {t("pages.rename")}
                    </Menu.Item>
                    <Menu.Item className={MENU_ITEM_CLASS} onClick={duplicate}>
                      <Copy aria-hidden className="size-4 text-muted-foreground" />
                      {t("pages.duplicate")}
                    </Menu.Item>
                    <Menu.Separator className="my-1 h-px bg-border" />
                    <Menu.Item className={cn(MENU_ITEM_CLASS, "text-destructive")} onClick={remove}>
                      <Trash2 aria-hidden className="size-4" />
                      {t("pages.delete")}
                    </Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </>
        }
      />

      <PageTabs pages={pages} active={page.id} onNew={() => setDialog("new")} />

      <div className="mt-6">
        {widgetCount(page.layout) === 0 && !editor.editing ? (
          <EmptyPage onStart={() => editor.setEditing(true)} />
        ) : (
          <WidgetBoard editor={editor} context={{ ticker: page.ticker, tickerOverrides: true }} galleryCategories={["stock", "market", "macro", "general"]} />
        )}
      </div>
      <p className="mt-10 text-xs text-muted-foreground">{t("pages.storageNote")}</p>

      <PageDialog open={dialog === "new"} title={t("pages.new")} onClose={() => setDialog(null)} wide>
        <StartOptions
          pages={pages}
          ticker={page.ticker}
          onCreate={(name, layout, ticker) => {
            const id = onCreate(name, layout, ticker);
            if (id) setDialog(null);
            return id;
          }}
        />
      </PageDialog>
      <PageDialog open={dialog === "rename"} title={t("pages.rename")} onClose={() => setDialog(null)}>
        <RenameForm
          name={page.name}
          onSave={(name) => {
            pageActions.rename(page.id, name);
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      </PageDialog>
    </div>
  );
}

/** The visitor's pages as tabs (links: `?p=<id>`), plus "New page". */
function PageTabs({ pages, active, onNew }: { pages: readonly CustomPage[]; active: string; onNew: () => void }) {
  const { t } = useWidgetI18n();
  const pathname = usePathname();
  return (
    <nav aria-label={t("pages.tabs")} className="relative mt-4 before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border">
      <ul className="relative -mx-2.5 flex items-center overflow-x-auto scrollbar-none max-md:mask-fade-x">
        {pages.map((page) => {
          const current = page.id === active;
          return (
            <li key={page.id} className="shrink-0">
              <Link
                href={`${pathname}?${PAGE_PARAM}=${encodeURIComponent(page.id)}`}
                scroll={false}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "relative flex h-10 max-w-56 items-center rounded-sm px-2.5 text-[13px] font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  current ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="truncate">{page.name}</span>
                {current ? <span aria-hidden className="absolute inset-x-2.5 bottom-0 h-0.5 bg-foreground" /> : null}
              </Link>
            </li>
          );
        })}
        <li className="shrink-0">
          <button
            type="button"
            onClick={onNew}
            className="flex h-10 items-center gap-1 rounded-sm px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            <Plus aria-hidden className="size-4" />
            {t("pages.new")}
          </button>
        </li>
      </ul>
    </nav>
  );
}

function EmptyPage({ onStart }: { onStart: () => void }) {
  const { t } = useWidgetI18n();
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-16 text-center">
      <span aria-hidden className="flex size-11 items-center justify-center rounded-lg bg-muted text-foreground">
        <SquarePlus className="size-5" />
      </span>
      <p className="text-[15px] font-semibold text-foreground">{t("board.empty")}</p>
      <p className="max-w-md text-[13px] text-muted-foreground">{t("board.emptyHint")}</p>
      <Button onClick={onStart} className="mt-2">
        <Plus aria-hidden />
        {t("edit.add")}
      </Button>
    </div>
  );
}

function PageDialog({ open, title, onClose, wide = false, children }: { open: boolean; title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const { t } = useWidgetI18n();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            "fixed left-1/2 top-[10vh] z-50 max-h-[80vh] -translate-x-1/2 overflow-y-auto rounded-xl border border-border bg-card text-foreground shadow-[0_24px_64px_-24px_rgb(0_0_0/0.5)] outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
            wide ? "w-[min(44rem,calc(100vw-2rem))]" : "w-[min(26rem,calc(100vw-2rem))]",
          )}
        >
          <div className="flex items-center gap-2 border-b border-border py-2 pl-5 pr-2">
            <Dialog.Title className="min-w-0 grow truncate text-[15px] font-semibold">{title}</Dialog.Title>
            <Dialog.Close
              aria-label={t("settings.close")}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X aria-hidden className="size-4" />
            </Dialog.Close>
          </div>
          <div className="p-5">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RenameForm({ name, onSave, onCancel }: { name: string; onSave: (name: string) => void; onCancel: () => void }) {
  const { t } = useWidgetI18n();
  const id = useId();
  const [value, setValue] = useState(name);
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    input?.select();
  }, [input]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSave(value);
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <label htmlFor={id} className="block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("pages.name")}
        </label>
        <input
          ref={setInput}
          id={id}
          type="text"
          maxLength={60}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          {t("pages.cancel")}
        </Button>
        <Button type="submit" disabled={!value.trim()}>
          {t("pages.save")}
        </Button>
      </div>
    </form>
  );
}
