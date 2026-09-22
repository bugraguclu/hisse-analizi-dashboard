"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/locale-context";

interface Suggestion {
  ticker: string;
  name: string;
}

function extractSuggestions(data: unknown): Suggestion[] {
  const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const raw = Array.isArray(data) ? data : Array.isArray(obj.results) ? obj.results : [];
  return (raw as Array<Record<string, unknown>>)
    .map((r) => ({ ticker: String(r.symbol ?? r.ticker ?? ""), name: String(r.name ?? r.full_name ?? "") }))
    .filter((r) => r.ticker);
}

/**
 * Free-text ticker/title filter for the events page. Distinct from the
 * shared <TickerSearch> (which only navigates): partial typing here maps to
 * the backend's `search` param (title match) so results narrow live, while
 * picking a suggestion commits an exact `ticker` filter instead — per the
 * B3 contract, the two are mutually exclusive.
 */
export function TickerFilterInput({
  ticker,
  search,
  onTickerSelect,
  onSearchChange,
  onClear,
}: {
  ticker: string;
  search: string;
  onTickerSelect: (ticker: string) => void;
  onSearchChange: (text: string) => void;
  onClear: () => void;
}) {
  const { t } = useLocale();
  const [inputValue, setInputValue] = useState(ticker || search);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const suggestDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Resync from the URL on external changes (back/forward, the clear
  // button) — a committed ticker always wins the displayed text. Adjusted
  // during render (React's recommended pattern for "reset state when a prop
  // changes") rather than in an effect, which would cause an extra render.
  const externalValue = ticker || search;
  const [prevExternalValue, setPrevExternalValue] = useState(externalValue);
  if (externalValue !== prevExternalValue) {
    setPrevExternalValue(externalValue);
    setInputValue(externalValue);
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => () => {
    clearTimeout(searchDebounceRef.current);
    clearTimeout(suggestDebounceRef.current);
  }, []);

  const fetchSuggestions = useCallback(async (q: string) => {
    const requestId = ++requestIdRef.current;
    try {
      const data = await api.search(q);
      if (requestId !== requestIdRef.current) return;
      setSuggestions(extractSuggestions(data).slice(0, 8));
      setIsOpen(true);
    } catch {
      if (requestId === requestIdRef.current) setSuggestions([]);
    }
  }, []);

  const handleChange = (value: string) => {
    setInputValue(value);
    setSelectedIndex(-1);

    clearTimeout(suggestDebounceRef.current);
    clearTimeout(searchDebounceRef.current);

    if (value.trim().length < 2) {
      setSuggestions([]);
      setIsOpen(false);
      searchDebounceRef.current = setTimeout(() => onSearchChange(""), 300);
      return;
    }
    suggestDebounceRef.current = setTimeout(() => { void fetchSuggestions(value.trim()); }, 250);
    searchDebounceRef.current = setTimeout(() => onSearchChange(value.trim()), 400);
  };

  const selectTicker = (tk: string) => {
    clearTimeout(searchDebounceRef.current);
    setInputValue(tk);
    setIsOpen(false);
    setSelectedIndex(-1);
    onTickerSelect(tk);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && isOpen && suggestions.length > 0) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && isOpen && suggestions.length > 0) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isOpen && selectedIndex >= 0 && suggestions[selectedIndex]) {
        selectTicker(suggestions[selectedIndex].ticker);
      } else if (inputValue.trim().length >= 2) {
        clearTimeout(searchDebounceRef.current);
        onSearchChange(inputValue.trim());
        setIsOpen(false);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const clear = () => {
    clearTimeout(searchDebounceRef.current);
    clearTimeout(suggestDebounceRef.current);
    setInputValue("");
    setSuggestions([]);
    setIsOpen(false);
    onClear();
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground z-10" />
        <Input
          value={inputValue}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setIsOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder={t("events.searchTicker")}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={selectedIndex >= 0 ? `${listboxId}-${selectedIndex}` : undefined}
          className="w-56 h-8 text-xs pl-8 pr-8"
        />
        {inputValue && (
          <button type="button" onClick={clear} aria-label={t("common.reset")} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted/50 transition-colors">
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>
      {isOpen && suggestions.length > 0 && (
        <div id={listboxId} role="listbox" aria-label={t("events.searchTicker")} className="absolute top-full left-0 mt-1 w-64 bg-card border border-border/60 rounded-xl shadow-xl z-50 overflow-hidden">
          {suggestions.map((s, i) => (
            <button
              key={`${s.ticker}-${i}`}
              type="button"
              id={`${listboxId}-${i}`}
              role="option"
              aria-selected={i === selectedIndex}
              onClick={() => selectTicker(s.ticker)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`flex items-center gap-2 w-full px-3 py-2 text-left transition-colors ${i === selectedIndex ? "bg-accent" : "hover:bg-muted/30"}`}
            >
              <span className="text-xs font-bold text-primary min-w-[50px]">{s.ticker}</span>
              <span className="text-[11px] text-muted-foreground truncate">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
