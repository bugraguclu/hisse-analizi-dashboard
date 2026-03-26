"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";

interface SearchResult {
  symbol?: string;
  ticker?: string;
  name?: string;
  title?: string;
  sector?: string;
}

function extractResults(data: unknown): SearchResult[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.results)) return obj.results;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.companies)) return obj.companies;
  }
  return [];
}

function getTargetPath(pathname: string, ticker: string): string {
  const t = ticker.toUpperCase();
  if (pathname.startsWith("/teknik")) return `/teknik/${t}`;
  if (pathname.startsWith("/temel")) return `/temel/${t}`;
  return `/hisse/${t}`;
}

export function TickerSearch({ onSelect }: { onSelect?: (ticker: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setIsSearching(false); return; }
    setIsSearching(true);
    try {
      const data = await api.search(q);
      const extracted = extractResults(data);
      setResults(extracted.slice(0, 8));
      setIsOpen(extracted.length > 0);
    } catch {
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (query.length >= 2) {
      setIsSearching(true);
      timerRef.current = setTimeout(() => search(query), 300);
    } else {
      setResults([]);
      setIsOpen(false);
    }
    return () => clearTimeout(timerRef.current);
  }, [query, search]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function select(ticker: string) {
    setQuery("");
    setIsOpen(false);
    setSelectedIndex(-1);
    if (onSelect) {
      onSelect(ticker);
    } else {
      router.push(getTargetPath(pathname, ticker));
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      const r = results[selectedIndex];
      const ticker = r.symbol || r.ticker || "";
      if (ticker) select(ticker);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground animate-spin" />
        )}
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase());
            setSelectedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setIsOpen(true); }}
          placeholder="Hisse ara... (THYAO, GARAN)"
          className="pl-10 pr-9 h-10 text-sm bg-card border-border shadow-sm focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-muted-foreground/60"
        />
      </div>
      <AnimatePresence>
        {isOpen && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 top-full mt-1.5 w-full bg-popover/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-xl shadow-black/10 overflow-hidden"
          >
            {results.map((r, i) => {
              const ticker = r.symbol || r.ticker || "";
              const isSelected = i === selectedIndex;
              return (
                <button
                  key={`${ticker}-${i}`}
                  onClick={() => select(ticker)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`w-full px-3.5 py-2.5 text-left text-sm flex items-center justify-between border-b border-border/30 last:border-0 transition-colors ${
                    isSelected ? "bg-accent" : "hover:bg-accent/50"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-primary text-xs bg-primary/10 px-1.5 py-0.5 rounded">{ticker}</span>
                    <span className="text-xs text-foreground truncate">{r.name || r.title || ""}</span>
                  </div>
                  {r.sector && (
                    <span className="text-[10px] text-muted-foreground ml-2 shrink-0">{r.sector}</span>
                  )}
                </button>
              );
            })}
            <div className="px-3.5 py-1.5 bg-muted/30 border-t border-border/30">
              <span className="text-[10px] text-muted-foreground">
                {results.length} sonuc &middot; Enter ile sec &middot; Esc ile kapat
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
