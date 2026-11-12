/** The empty-state box, shared with lines that turn into one (the search map's count line). */
export const emptyStateBox = 'rounded-2xl border border-line bg-white px-4 py-[14px] text-muted';

export function EmptyState({ message }: { message: string }) {
  return <p className={emptyStateBox}>{message}</p>;
}
