/* Matches TourCard's footprint (3:2 image + text block) so nothing jumps on load. */
export default function TourCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="card animate-pulse overflow-hidden motion-reduce:animate-none"
    >
      <div className="aspect-[3/2] bg-sand-100 dark:bg-ink-800" />
      <div className="space-y-3 p-4">
        <div className="h-3 w-1/4 rounded bg-sand-100 dark:bg-ink-800" />
        <div className="h-5 w-4/5 rounded bg-sand-100 dark:bg-ink-800" />
        <div className="h-3 w-full rounded bg-sand-100 dark:bg-ink-800" />
        <div className="h-3 w-2/3 rounded bg-sand-100 dark:bg-ink-800" />
        <div className="flex items-end justify-between pt-3">
          <div className="h-7 w-24 rounded bg-sand-100 dark:bg-ink-800" />
          <div className="h-11 w-28 rounded-xl bg-sand-100 dark:bg-ink-800" />
        </div>
      </div>
    </div>
  );
}