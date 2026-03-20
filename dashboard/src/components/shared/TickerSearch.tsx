"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface SearchResult {
  symbol?: string;
  ticker?: string;
  name?: string;
  title?: string;
}

export function TickerSearch({ onSelect }: { onSelect?: (ticker: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    const data = await api.search(q);
    if (Array.isArray(data)) {
      setResults(data.slice(0, 8));
      setIsOpen(true);
    }
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(query), 300);
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
    setQuery(ticker);
    setIsOpen(false);
    if (onSelect) onSelect(ticker);
    else router.push(`/hisse/${ticker.toUpperCase()}`);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          placeholder="Hisse ara..."
          className="pl-10 bg-white border-slate-200 text-slate-800 placeholder:text-slate-400 h-9 text-sm"
        />
      </div>
      {isOpen && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          {results.map((r, i) => {
            const ticker = r.symbol || r.ticker || "";
            return (
              <button
                key={i}
                onClick={() => select(ticker)}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 last:border-0"
              >
                <span className="font-semibold text-slate-800">{ticker}</span>
                <span className="text-xs text-slate-400 truncate ml-3">{r.name || r.title || ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
