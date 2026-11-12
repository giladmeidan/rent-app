import type { ReactNode } from 'react';

import { Card } from './Card';
import { Mascot, type MascotPose } from './Mascot';

/**
 * An empty list or result, in a card. With a `pose`, the mascot (120px) sits above the message,
 * centred, with the brand's space-8 around it. An `action` (a `Button`) sits below the message.
 */
export function EmptyState({
  message,
  pose,
  action,
}: {
  message: string;
  pose?: MascotPose;
  action?: ReactNode;
}) {
  return (
    <Card
      padding="md"
      className={
        pose === undefined ? undefined : 'flex flex-col items-center gap-3 py-8 text-center'
      }
    >
      {pose !== undefined && <Mascot pose={pose} width={120} />}
      <p className="text-body text-ink-muted">{message}</p>
      {action !== undefined && action !== null && action !== false && (
        <div className={pose === undefined ? 'mt-3' : undefined}>{action}</div>
      )}
    </Card>
  );
}
