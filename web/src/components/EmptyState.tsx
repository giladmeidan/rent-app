import { Card } from './Card';
import { Mascot, type MascotPose } from './Mascot';

/**
 * The look of an `EmptyState` without a pose (the default `Card` with `md` padding, and the
 * message's text classes), for a line that turns into one: the search map's count line (spec
 * 0009t). Keep it in step with the component below.
 */
export const emptyStateBox =
  'rounded-lg border border-border bg-surface p-4 text-body text-ink-muted';

/**
 * An empty list or result, in a card. With a `pose`, the mascot (120px) sits above the message,
 * centred, with the brand's space-8 around it.
 */
export function EmptyState({ message, pose }: { message: string; pose?: MascotPose }) {
  return (
    <Card
      padding="md"
      className={
        pose === undefined ? undefined : 'flex flex-col items-center gap-3 py-8 text-center'
      }
    >
      {pose !== undefined && <Mascot pose={pose} width={120} />}
      <p className="text-body text-ink-muted">{message}</p>
    </Card>
  );
}
