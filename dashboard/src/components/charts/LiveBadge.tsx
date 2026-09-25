/** "● Canlı" marker for charts that update during the session (soft ping, no glow). */
export function LiveBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-up">
      <span aria-hidden className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping-soft rounded-full bg-up" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-up" />
      </span>
      {label}
    </span>
  );
}
