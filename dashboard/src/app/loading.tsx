import { CardSkeleton } from "@/components/shared/LoadingSpinner";

export default function Loading() {
  return (
    <div className="max-w-7xl mx-auto space-y-5" aria-label="Sayfa yükleniyor" aria-busy="true">
      <div className="h-16 rounded-2xl bg-muted/40 animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
      <div className="h-80 rounded-2xl bg-muted/40 animate-pulse" />
    </div>
  );
}
