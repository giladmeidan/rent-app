import { AgreeIcon, DifferIcon } from './icons';
import type { ReasonKind } from './types';

/** The match explanation's lines: the agreeing ones with a check, the differing one with a "!". The
 * words carry the meaning; the icon repeats it. */
export function ReasonList({ lines }: { lines: { kind: ReasonKind; text: string }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {lines.map(({ kind, text }) => (
        <li key={`${kind}-${text}`} className="flex items-center gap-2 text-body-sm text-ink">
          {kind === 'agree' ? <AgreeIcon /> : <DifferIcon />}
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}
