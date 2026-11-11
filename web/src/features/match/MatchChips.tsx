import { useTranslation } from 'react-i18next';

import type { ListingPublic } from '../listings/api';
import type { SeekerProfileOut } from '../profile/api';
import { seekerShort } from './reasons';
import type { MatchOut } from './types';

type Props = {
  match: MatchOut;
  listing: ListingPublic;
  /** The seeker's profile; `undefined` while it loads or when it failed (the `move_in` differ chip
   * is then left out). */
  profile: SeekerProfileOut | undefined;
};

const chip = 'rounded-full px-[10px] py-1 text-xs font-semibold';
const agreeChip = `${chip} bg-accent-tint text-accent-text`;
const differChip = `${chip} bg-warn text-warn-text`;

/** A search card's two short reasons: the top agreeing criterion (teal) and the differing one
 * (amber). Not interactive. */
export function MatchChips({ match, listing, profile }: Props) {
  const { t } = useTranslation();
  const chips: { kind: 'agree' | 'differ'; text: string; className: string }[] = [];
  const top = match.agrees[0];
  if (top !== undefined) {
    const text = seekerShort(top, 'agree', listing, profile, t);
    if (text !== null) chips.push({ kind: 'agree', text, className: agreeChip });
  }
  if (match.differs !== null) {
    const text = seekerShort(match.differs, 'differ', listing, profile, t);
    if (text !== null) chips.push({ kind: 'differ', text, className: differChip });
  }
  if (chips.length === 0) return null;

  return (
    <ul data-testid="match-chips" className="flex flex-wrap gap-[6px]">
      {chips.map(({ kind, text, className }) => (
        <li key={kind} className={className}>
          {text}
        </li>
      ))}
    </ul>
  );
}
