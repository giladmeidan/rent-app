export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-2xl border border-border bg-surface px-4 py-[14px] text-ink-muted">
      {message}
    </p>
  );
}
