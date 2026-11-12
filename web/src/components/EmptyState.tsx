import type { ReactNode } from 'react';

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
 * centred, with the brand's space-8 around it. An `action` (a button or a link) follows the
 * message inside the card.
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
  const hasAction = action !== undefined && action !== null;
  let layout: string | undefined;
  if (pose !== undefined) layout = 'flex flex-col items-center gap-3 py-8 text-center';
  else if (hasAction) layout = 'flex flex-col items-start gap-3';
  return (
    <Card padding="md" className={layout}>
      {pose !== undefined && <Mascot pose={pose} width={120} />}
      <p className="text-body text-ink-muted">{message}</p>
      {hasAction && action}
    </Card>
  );
}
