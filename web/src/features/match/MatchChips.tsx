import { useTranslation } from 'react-i18next';

import type { ApplicantProfileOut } from '../applicants/api';
import type { ListingPublic } from '../listings/api';
import type { SeekerProfileOut } from '../profile/api';
import { ownerShort, seekerShort } from './reasons';
import type { Criterion, MatchOut, ReasonKind } from './types';

/** A search card's chips, about a listing (the seeker's voice, the default). */
type SeekerProps = {
  voice?: 'seeker';
  match: MatchOut;
  listing: ListingPublic;
  /** The seeker's profile; `undefined` while it loads or when it failed (the `move_in` differ chip
   * is then left out). */
  profile: SeekerProfileOut | undefined;
};

/** An inbox card's chips, about an applicant (the owner's voice). */
type OwnerProps = {
  voice: 'owner';
  match: MatchOut;
  /** The applicant's housing summary. */
  profile: ApplicantProfileOut;
  /** The listing's `parking_spots`. */
  spots: number;
};

type Props = SeekerProps | OwnerProps;

const chip = 'rounded-full px-[10px] py-1 text-xs font-semibold';
const agreeChip = `${chip} bg-accent-tint text-accent-text`;
const differChip = `${chip} bg-warn text-warn-text`;

/** A card's two short reasons: the top agreeing criterion (teal) and the differing one (amber).
 * Not interactive. */
export function MatchChips(props: Props) {
  const { t } = useTranslation();
  const short = (criterion: Criterion, kind: ReasonKind) =>
    props.voice === 'owner'
      ? ownerShort(criterion, kind, props.profile, props.spots, t)
      : seekerShort(criterion, kind, props.listing, props.profile, t);
  const { match } = props;
  const chips: { kind: ReasonKind; text: string; className: string }[] = [];
  const top = match.agrees[0];
  if (top !== undefined) {
    const text = short(top, 'agree');
    if (text !== null) chips.push({ kind: 'agree', text, className: agreeChip });
  }
  if (match.differs !== null) {
    const text = short(match.differs, 'differ');
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
