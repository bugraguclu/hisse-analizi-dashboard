import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, parseLocale } from "@/lib/i18n";
import { eventsText } from "@/components/events/i18n-dict";

export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const locale = parseLocale(store.get(LOCALE_COOKIE)?.value) ?? "tr";
  return { title: eventsText("page.title", locale), description: eventsText("page.metaDescription", locale) };
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
