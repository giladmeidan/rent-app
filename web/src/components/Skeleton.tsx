/**
 * A placeholder with the same box as an area card, so nothing jumps when data arrives. Pass
 * `className` (size classes) for a plain inline bar instead, e.g. `h-5 w-24` in the header.
 */
export function Skeleton({ className }: { className?: string }) {
  if (className !== undefined) {
    return (
      <div
        data-testid="skeleton"
        aria-hidden="true"
        className={`animate-pulse rounded bg-line ${className}`}
      />
    );
  }
  return (
    <div
      data-testid="skeleton"
      aria-hidden="true"
      className="rounded-2xl border border-line bg-white px-4 py-[14px]"
    >
      <div className="flex h-6 items-center">
        <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
      </div>
    </div>
  );
}
