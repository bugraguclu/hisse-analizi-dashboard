import type { Metadata } from "next";
import { OfflineView } from "@/components/pwa/OfflineView";

export const metadata: Metadata = {
  title: "Çevrimdışı",
  robots: { index: false, follow: false },
};

/** Fallback the service worker serves for pages that were never saved on this device. */
export default function OfflinePage() {
  return <OfflineView />;
}
