import { Card } from './Card';
import { Mascot, type MascotPose } from './Mascot';

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
