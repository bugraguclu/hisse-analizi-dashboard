import { Suspense } from "react";
import { EventsView, EventsViewFallback } from "@/components/events/EventsView";

/** KAP Haberleri — the feed is driven entirely by the URL (useSearchParams needs a Suspense boundary). */
export default function EventsPage() {
  return (
    <Suspense fallback={<EventsViewFallback />}>
      <EventsView />
    </Suspense>
  );
}
