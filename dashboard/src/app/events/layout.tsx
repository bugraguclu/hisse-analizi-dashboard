import type { Metadata } from "next";
import { requestLocale } from "@/lib/request-locale";
import { eventsText } from "@/components/events/i18n-dict";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await requestLocale();
  return { title: eventsText("page.title", locale), description: eventsText("page.metaDescription", locale) };
}

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
