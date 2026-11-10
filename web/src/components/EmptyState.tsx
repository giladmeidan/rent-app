export function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-2xl border border-line bg-white px-4 py-[14px] text-muted">{message}</p>
  );
}
