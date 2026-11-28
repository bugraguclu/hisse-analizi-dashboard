"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import { ChevronDown, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EventAttachmentStatus, EventContentBlock, EventContentOut } from "@/types";
import { useEventsI18n, type EventsKey } from "./i18n";

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

interface Attachment {
  name: string;
  status: EventAttachmentStatus | null;
  text: string;
  pages: number | null;
  truncated: boolean;
}

const STATUSES: readonly EventAttachmentStatus[] = ["text", "no_text", "too_large", "unreadable", "failed", "skipped", "unsupported"];

const STATUS_NOTE: Partial<Record<EventAttachmentStatus, EventsKey>> = {
  no_text: "drawer.attachment.noText",
  too_large: "drawer.attachment.tooLarge",
  unreadable: "drawer.attachment.unreadable",
  failed: "drawer.attachment.failed",
};

/** Validate untrusted attachment entries (older caches carry the name only). */
function readAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): Attachment[] => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const name = str(entry.name).trim();
    if (!name) return [];
    const status = STATUSES.find((value) => value === entry.status) ?? null;
    const text = status === "text" ? str(entry.text).replace(/\r\n?/g, "\n") : "";
    const pages = typeof entry.pages === "number" && Number.isFinite(entry.pages) && entry.pages > 0 ? entry.pages : null;
    return [{ name, status: text.trim() ? status : status === "text" ? null : status, text, pages, truncated: entry.truncated === true }];
  });
}

function AttachmentText({ attachment, open, kapLink }: { attachment: Attachment; open: boolean; kapLink: (children: ReactNode) => ReactNode }) {
  const { t, tp } = useEventsI18n();
  return (
    <details open={open} className="group rounded-md border border-border">
      <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2 text-[13px] text-foreground [&::-webkit-details-marker]:hidden">
        <Paperclip aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 break-all font-medium">{attachment.name}</span>
        {attachment.pages ? (
          <span className="shrink-0 text-xs text-muted-foreground">{tp("drawer.attachment.pages", attachment.pages)}</span>
        ) : null}
        <ChevronDown aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">{t("drawer.attachment.extracted")}</p>
        <pre
          role="region"
          aria-label={t("drawer.attachment.textLabel", { name: attachment.name })}
          tabIndex={0}
          className="max-h-[28rem] overflow-auto whitespace-pre rounded bg-surface p-2 font-mono text-[11px] leading-snug text-foreground scrollbar-thin focus-visible:outline-2 focus-visible:outline-ring"
        >
          {attachment.text}
        </pre>
        {attachment.truncated ? <p className="text-xs text-muted-foreground">{kapLink(t("drawer.attachment.truncated"))}</p> : null}
      </div>
    </details>
  );
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
                      numericColumns[column] || isNumeric(cell) ? "whitespace-nowrap text-right font-mono tabular-nums" : "min-w-[8rem] break-words",
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
  const attachments = useMemo(() => readAttachments(content.attachments), [content.attachments]);
  // The first readable attachment starts open: it is often the whole disclosure ("ekte yer almaktadır").
  const firstText = attachments.findIndex((item) => item.status === "text");

  if (groups.length === 0 && attachments.length === 0) {
    return <p className="text-[13px] text-muted-foreground">{t("drawer.contentEmpty")}</p>;
  }

  const kapLink = (children: ReactNode) =>
    kapUrl ? (
      <a
        href={kapUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
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
          <ul className="space-y-2">
            {attachments.map((attachment, index) => {
              if (attachment.status === "text") {
                return (
                  <li key={`${attachment.name}-${index}`}>
                    <AttachmentText attachment={attachment} open={index === firstText} kapLink={kapLink} />
                  </li>
                );
              }
              const note = attachment.status ? STATUS_NOTE[attachment.status] : undefined;
              return (
                <li key={`${attachment.name}-${index}`} className="flex items-start gap-2 text-[13px] text-foreground">
                  <Paperclip aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="break-all">{attachment.name}</span>
                    {note ? <span className="block text-xs text-muted-foreground">{t(note)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">{kapLink(t("drawer.attachmentsNote"))}</p>
        </section>
      ) : null}
    </div>
  );
}
