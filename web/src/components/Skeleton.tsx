import { Card } from './Card';

const bar = 'animate-pulse rounded bg-border motion-reduce:animate-none';

/**
 * A placeholder with the same box as an area card (54px), so nothing jumps when data arrives. Pass
 * `className` (size classes) for a plain inline bar instead, e.g. `h-5 w-24` in the header.
 */
export function Skeleton({ className }: { className?: string }) {
  if (className !== undefined) {
    return <div data-testid="skeleton" aria-hidden="true" className={`${bar} ${className}`} />;
  }
  return (
    <Card data-testid="skeleton" aria-hidden="true" padding="none" className="px-4 py-3.5">
      <div className="flex h-6 items-center">
        <div className={`h-4 w-1/3 ${bar}`} />
      </div>
    </Card>
  );
}
