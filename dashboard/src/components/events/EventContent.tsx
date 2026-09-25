"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EventContentBlock, EventContentOut } from "@/types";
import { useEventsI18n } from "./i18n";

type FieldBlock = Extract<EventContentBlock, { type: "field" }>;

type Group =
  | { kind: "heading"; text: string }
  | { kind: "fields"; fields: FieldBlock[] }
  | { kind: "text"; paragraphs: string[] }
  | { kind: "table"; header: string[]; rows: string[][]; number: number };

function str(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

/** Validate untrusted blocks and merge consecutive fields into one definition list. */
function groupBlocks(blocks: unknown): Group[] {
  if (!Array.isArray(blocks)) return [];
  const groups: Group[] = [];
  let tables = 0;
  for (const raw of blocks) {
    if (!raw || typeof raw !== "object") continue;
    const block = raw as Record<string, unknown>;
    switch (block.type) {
      case "heading": {
        const text = str(block.text).trim();
        if (text) groups.push({ kind: "heading", text });
        break;
      }
      case "field": {
        const label = str(block.label).trim();
        const value = str(block.value).trim();
        if (!label && !value) break;
        const last = groups.at(-1);
        const field: FieldBlock = { type: "field", label, value };
        if (last?.kind === "fields") last.fields.push(field);
        else groups.push({ kind: "fields", fields: [field] });
        break;
      }
      case "text": {
        const paragraphs = str(block.text)
          .replace(/\r\n?/g, "\n")
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean);
        if (paragraphs.length) groups.push({ kind: "text", paragraphs });
        break;
      }
      case "table": {
        const rows = Array.isArray(block.rows)
          ? block.rows.filter(Array.isArray).map((row) => (row as unknown[]).map((cell) => str(cell).trim()))
          : [];
        const nonEmpty = rows.filter((row) => row.some(Boolean));
        if (nonEmpty.length === 0) break;
        const width = Math.max(...nonEmpty.map((row) => row.length));
        const pad = (row: string[]) => [...row, ...Array<string>(width - row.length).fill("")];
        const [header, ...body] = nonEmpty.map(pad);
        tables += 1;
        groups.push({ kind: "table", header, rows: body, number: tables });
        break;
      }
      default:
        break;
    }
  }
  return groups;
}

/** "1.234.567,89", "(12,5)", "%15", "-3,2 TL" → right-aligned tabular cells. */
function isNumeric(cell: string): boolean {
  const compact = cell.replace(/\s|%|TL|TRY|₺/gi, "");
  return /^[-+(]?\d[\d.,]*\)?$/.test(compact);
}

function ContentTable({ header, rows, index }: { header: string[]; rows: string[][]; index: number }) {
  const { t } = useEventsI18n();
  const numericColumns = header.map((_, column) => rows.length > 0 && rows.every((row) => !row[column] || isNumeric(row[column])));
  return (
    <div
      role="region"
      aria-label={t("drawer.table", { index })}
      tabIndex={0}
      className="overflow-x-auto rounded-md border border-border scrollbar-thin focus-visible:outline-2 focus-visible:outline-ring"
    >
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {header.map((cell, column) => (
              <th
                key={column}
                scope="col"
                className={cn(
                  "border-b border-border bg-surface px-2.5 py-1.5 text-left align-bottom font-medium text-muted-foreground",
                  numericColumns[column] && "text-right",
                )}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        {rows.length > 0 ? (
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-border last:border-0">
                {row.map((cell, column) => (
                  <td
                    key={column}
                    className={cn(
                      "px-2.5 py-1.5 align-top text-foreground",
                      numericColumns[column] || isNumeric(cell) ? "whitespace-nowrap text-right font-mono" : "min-w-[8rem] break-words",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ) : null}
      </table>
    </div>
  );
}

export function EventContentBody({ content, kapUrl }: { content: EventContentOut; kapUrl: string | null }) {
  const { t } = useEventsI18n();
  const groups = useMemo(() => groupBlocks(content.blocks), [content.blocks]);
  const attachments = Array.isArray(content.attachments)
    ? content.attachments.map((item) => str(item?.name).trim()).filter(Boolean)
    : [];

  if (groups.length === 0 && attachments.length === 0) {
    return <p className="text-[13px] text-muted-foreground">{t("drawer.contentEmpty")}</p>;
  }

  const kapLink = (children: ReactNode) =>
    kapUrl ? (
      <a href={kapUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
        {children}
        <span className="sr-only"> {t("common.opensInNewTab")}</span>
      </a>
    ) : (
      children
    );

  return (
    <div className="space-y-4">
      {groups.map((group, index) => {
        switch (group.kind) {
          case "heading":
            return (
              <h4 key={index} className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-0">
                {group.text}
              </h4>
            );
          case "fields":
            return (
              <dl key={index} className="grid grid-cols-1 gap-x-5 gap-y-1 text-[13px] sm:grid-cols-[minmax(8rem,13rem)_minmax(0,1fr)] sm:gap-y-2">
                {group.fields.map((field, fieldIndex) => (
                  <Fragment key={fieldIndex}>
                    <dt className="text-muted-foreground">{field.label}</dt>
                    <dd className="mb-2 whitespace-pre-line break-words text-foreground sm:mb-0">{field.value || "—"}</dd>
                  </Fragment>
                ))}
              </dl>
            );
          case "text":
            return (
              <div key={index} className="space-y-3">
                {group.paragraphs.map((paragraph, paragraphIndex) => (
                  <p key={paragraphIndex} className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground">
                    {paragraph}
                  </p>
                ))}
              </div>
            );
          case "table":
            return <ContentTable key={index} header={group.header} rows={group.rows} index={group.number} />;
          default:
            return null;
        }
      })}

      {content.truncated ? (
        <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground">{kapLink(t("drawer.truncated"))}</p>
      ) : null}

      {attachments.length > 0 ? (
        <section className="space-y-2 border-t border-border pt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("drawer.attachments")}</h4>
          <ul className="space-y-1">
            {attachments.map((name, index) => (
              <li key={`${name}-${index}`} className="flex items-start gap-2 text-[13px] text-foreground">
                <Paperclip aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="break-all">{name}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{kapLink(t("drawer.attachmentsNote"))}</p>
        </section>
      ) : null}
    </div>
  );
}
