"use client";

import type { BuiltInPage } from "./defaults";
import { useStoredLayout } from "./store";
import { useLayoutEditor, type LayoutEditor } from "./use-layout-editor";

/** Edit session over one of the site's pages (the visitor's layout, else the default; resettable). */
export function useSitePageEditor(page: BuiltInPage): LayoutEditor {
  const stored = useStoredLayout(page);
  return useLayoutEditor({
    layout: stored.layout,
    save: stored.save,
    customized: stored.customized,
    pending: stored.pending,
    resettable: true,
  });
}
