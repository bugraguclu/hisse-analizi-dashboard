"use client";

import { useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLocale } from "@/lib/locale-context";
import { cn } from "@/lib/utils";
import { dayKey, dayParts, periodAllowed, shiftDate, shiftMonth } from "./date-picker-model";
import styles from "./date-picker.module.css";

const TEXT = {
  tr: { calendar: "Tarih takvimi", open: "Takvimi aç", close: "Takvimi kapat", prev: "Önceki takvim dönemi", next: "Sonraki takvim dönemi", month: "Ay seç", year: "Yıl seç", months: "Aylar", years: "Yıllar", today: "Bugün", clear: "Temizle" },
  en: { calendar: "Date calendar", open: "Open calendar", close: "Close calendar", prev: "Previous calendar period", next: "Next calendar period", month: "Choose month", year: "Choose year", months: "Months", years: "Years", today: "Today", clear: "Clear" },
  fr: { calendar: "Calendrier", open: "Ouvrir le calendrier", close: "Fermer le calendrier", prev: "Période précédente", next: "Période suivante", month: "Choisir le mois", year: "Choisir l’année", months: "Mois", years: "Années", today: "Aujourd’hui", clear: "Effacer" },
};
const INTL_LOCALE = { tr: "tr-TR", en: "en-US", fr: "fr-FR" };

interface DatePickerProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max"> {
  value: string;
  min?: string;
  max?: string;
  today: string | null;
  onChange: (value: string) => void;
}

/** Yemek Takibi's day/month/year picker, using the dashboard's theme and locale.
 * The native input keeps typing/validation. The custom calendar uses the browser's
 * top layer, escaping filter-panel clipping while retaining DOM ownership. */
export function DatePicker({ value, min, max, today, onChange, className, ...props }: DatePickerProps) {
  const { locale } = useLocale();
  const text = TEXT[locale];
  const intl = INTL_LOCALE[locale];
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const [focusDate, setFocusDate] = useState("");
  const [[year, month], setAnchor] = useState<[number, number]>([2000, 0]);
  const allowed = (date: string) => (!min || date >= min) && (!max || date <= max);
  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(intl, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, i, 1))));
  const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, i + 1))));
  const label = (date: string) => new Intl.DateTimeFormat(intl, { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

  function show() {
    if (props.disabled) return;
    const date = value || today || min || "2000-01-01";
    const clamped = min && date < min ? min : max && date > max ? max : date;
    const [y, m] = dayParts(clamped);
    setAnchor([y, m]);
    setFocusDate(clamped);
    setView("days");
    setOpen(true);
  }

  function close(restore = true) {
    setOpen(false);
    if (restore) input.current?.focus({ preventScroll: true });
  }

  function select(date: string) {
    if (!allowed(date)) return;
    onChange(date);
    close();
  }

  useLayoutEffect(() => {
    const calendar = panel.current;
    if (!open || !calendar) return;
    calendar.showPopover();
    const place = () => {
      if (!root.current) return;
      const box = root.current.getBoundingClientRect();
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      calendar.style.width = `${Math.min(320, width - 24)}px`;
      calendar.style.maxHeight = `${height - 24}px`;
      const size = calendar.getBoundingClientRect();
      calendar.style.left = `${width <= 600 ? left + (width - size.width) / 2 : Math.max(left + 12, Math.min(box.left, left + width - size.width - 12))}px`;
      calendar.style.top = `${Math.max(top + 12, box.bottom + size.height + 20 <= top + height ? box.bottom + 8 : Math.min(box.top - size.height - 8, top + height - size.height - 12))}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(calendar);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    // The filter bar also listens on document. Handle the inner calendar first.
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      input.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      calendar.hidePopover();
      observer.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const selector = view === "days" ? `[data-date="${focusDate}"]:not(:disabled)` : '[data-options] [aria-pressed="true"]:not(:disabled)';
    (panel.current?.querySelector<HTMLButtonElement>(selector) ?? panel.current?.querySelector<HTMLButtonElement>("[data-grid] button:not(:disabled)"))?.focus({ preventScroll: true });
  }, [open, view, year, month, focusDate]);

  function move(direction: number) {
    if (view === "years") setAnchor([Math.max(100, Math.min(9988, year + direction * 12)), month]);
    else if (view === "months") setAnchor([year + direction, month]);
    else {
      const next = shiftMonth(dayKey(year, month), direction);
      const [y, m] = dayParts(next);
      setAnchor([y, m]);
      setFocusDate(min && next < min ? min : next);
    }
  }

  function dayKeys(event: KeyboardEvent, date: string) {
    const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    const next = event.key in offsets ? shiftDate(date, offsets[event.key]) : event.key === "PageUp" || event.key === "PageDown" ? shiftMonth(date, event.key === "PageUp" ? -1 : 1) : null;
    if (!next) return;
    event.preventDefault();
    if (!allowed(next)) return;
    const [y, m] = dayParts(next);
    setAnchor([y, m]);
    setFocusDate(next);
  }

  const first = dayKey(year, month);
  const offset = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const count = Math.ceil((offset + new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) / 7) * 7;
  const start = shiftDate(first, -offset);
  const yearStart = Math.max(100, Math.min(9988, Math.floor(year / 12) * 12));
  const previous = view === "days" ? periodAllowed(month === 0 ? year - 1 : year, (month + 11) % 12, min, max) : view === "months" ? periodAllowed(year - 1, undefined, min, max) : yearStart > 100 && (!min || dayKey(yearStart - 1, 11, 31) >= min);
  const next = view === "days" ? periodAllowed(month === 11 ? year + 1 : year, (month + 1) % 12, min, max) : view === "months" ? periodAllowed(year + 1, undefined, min, max) : yearStart + 12 <= 9999 && (!max || dayKey(yearStart + 12, 0) <= max);

  return (
    <div className={styles.root} ref={root}>
      <input {...props} ref={input} type="date" role="combobox" value={value} min={min} max={max} className={cn(className, styles.input)} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => { event.preventDefault(); if (open) close(); else show(); }}
        onKeyDown={(event) => { if ((event.altKey && event.key === "ArrowDown") || event.key === " ") { event.preventDefault(); show(); } }} />
      <button type="button" className={styles.open} aria-label={text.open} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={props.disabled} onClick={() => open ? close() : show()}><CalendarDays size={17} aria-hidden="true" /></button>
      {open && <div ref={panel} id={id} popover="manual" role="dialog" aria-label={`${text.calendar}${props["aria-label"] ? ` · ${props["aria-label"]}` : ""}`} className={styles.panel}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          if (event.key !== "Tab") return;
          const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []).filter((button) => button.tabIndex >= 0);
          if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
        }}>
        <div className={styles.caption}>
          <button type="button" className={styles.arrow} aria-label={text.prev} disabled={!previous} onClick={() => move(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <div className={styles.heading} aria-live="polite">
            <button type="button" className={styles.month} aria-label={text.month} aria-pressed={view === "months"} onClick={() => setView(view === "months" ? "days" : "months")}>{months[month]}</button>
            <button type="button" aria-label={text.year} aria-pressed={view === "years"} onClick={() => setView(view === "years" ? "days" : "years")}>{year}</button>
          </div>
          <button type="button" className={styles.arrow} aria-label={text.next} disabled={!next} onClick={() => move(1)}><ChevronRight size={18} aria-hidden="true" /></button>
          <button type="button" className={styles.today} disabled={!today || !allowed(today)} onClick={() => today && select(today)}>{text.today}</button>
          <button type="button" className={styles.close} aria-label={text.close} onClick={() => close()}><X size={16} aria-hidden="true" /></button>
        </div>
        <div className={styles.body}>
          <div className={view === "days" ? undefined : styles.sizer} aria-hidden={view !== "days" || undefined}>
            <div className={styles.weekdays} aria-hidden="true">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
            <div data-grid className={styles.days} role={view === "days" ? "group" : undefined} aria-label={view === "days" ? `${months[month]} ${year}` : undefined}>
              {Array.from({ length: count }, (_, i) => shiftDate(start, i)).map((date) => view !== "days" || date.slice(0, 7) !== first.slice(0, 7) ? <span key={date} /> :
                <button key={date} type="button" data-date={date} aria-label={label(date)} aria-pressed={date === value} aria-current={date === today ? "date" : undefined} disabled={!allowed(date)} tabIndex={date === focusDate ? 0 : -1} onKeyDown={(event) => dayKeys(event, date)} onClick={() => select(date)}>{Number(date.slice(-2))}</button>)}
            </div>
          </div>
          {view !== "days" && <div data-grid data-options className={styles.options} role="group" aria-label={view === "months" ? text.months : text.years}>
            {(view === "months" ? months : Array.from({ length: 12 }, (_, i) => yearStart + i)).map((item, i) => <button type="button" key={item} aria-pressed={view === "months" ? i === month : item === year} disabled={!periodAllowed(view === "months" ? year : Number(item), view === "months" ? i : undefined, min, max)} onClick={() => {
              const y = view === "months" ? year : Number(item);
              const m = view === "months" ? i : month;
              const firstDay = dayKey(y, m);
              setAnchor([y, m]);
              setFocusDate(min && firstDay < min ? min : firstDay);
              setView(view === "months" ? "days" : "months");
            }}>{item}</button>)}
          </div>}
        </div>
        {!props.required && value && <div className={styles.footer}><button type="button" onClick={() => { onChange(""); close(); }}>{text.clear}</button></div>}
      </div>}
    </div>
  );
}
