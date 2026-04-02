"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/ErrorState";
import { useLocale } from "@/lib/locale-context";
import { motion } from "framer-motion";
import { MessageCircle, ExternalLink } from "lucide-react";

interface TweetsFeedProps {
  ticker: string;
}

function parseTweets(raw: unknown): Record<string, unknown>[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const obj = raw as Record<string, unknown>;
  if (obj.tweets && Array.isArray(obj.tweets)) return obj.tweets as Record<string, unknown>[];
  if (obj.data && Array.isArray(obj.data)) return obj.data as Record<string, unknown>[];
  return [];
}

function timeAgo(dateStr: string, locale: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return dateStr;
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return locale === "tr" ? `${diff}sn` : `${diff}s`;
  if (diff < 3600) return locale === "tr" ? `${Math.floor(diff / 60)}dk` : `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return locale === "tr" ? `${Math.floor(diff / 3600)}sa` : `${Math.floor(diff / 3600)}h`;
  return locale === "tr" ? `${Math.floor(diff / 86400)}g` : `${Math.floor(diff / 86400)}d`;
}

export function TweetsFeed({ ticker }: TweetsFeedProps) {
  const { locale } = useLocale();
  const tweetsQ = useQuery({
    queryKey: ["tweets", ticker],
    queryFn: () => api.tweets(ticker, 15),
    staleTime: 120_000,
  });

  const tweets = parseTweets(tweetsQ.data);

  const labels = {
    title: { tr: "Sosyal Medya", en: "Social Media", fr: "Medias sociaux" },
    noData: { tr: "Tweet bulunamadi", en: "No tweets found", fr: "Aucun tweet trouve" },
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-card rounded-2xl border border-border/60 overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-border/40 flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-sky-500" />
        <h2 className="text-sm font-semibold text-foreground">{labels.title[locale]}</h2>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {tweetsQ.isLoading ? (
          <div className="p-5"><LoadingSpinner /></div>
        ) : tweets.length === 0 ? (
          <div className="p-5"><EmptyState message={labels.noData[locale]} /></div>
        ) : (
          <div className="divide-y divide-border/20">
            {tweets.map((tw, i) => {
              const text = String(tw.text ?? tw.content ?? tw.body ?? "");
              const author = String(tw.user ?? tw.author ?? tw.username ?? tw.screen_name ?? "");
              const date = String(tw.created_at ?? tw.date ?? tw.timestamp ?? "");
              const url = String(tw.url ?? tw.link ?? "");
              return (
                <div key={i} className="px-5 py-3.5 hover:bg-muted/10 transition-colors">
                  <div className="flex items-center gap-2 mb-1.5">
                    {author && (
                      <span className="text-[11px] font-semibold text-primary">@{author}</span>
                    )}
                    {date && (
                      <span className="text-[10px] text-muted-foreground">{timeAgo(date, locale)}</span>
                    )}
                    {url && (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto text-muted-foreground hover:text-primary transition-colors">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-foreground/90 leading-relaxed line-clamp-3">{text}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
