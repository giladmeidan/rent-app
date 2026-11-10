/** A placeholder with the same box as an area card, so nothing jumps when data arrives. */
export function Skeleton() {
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
