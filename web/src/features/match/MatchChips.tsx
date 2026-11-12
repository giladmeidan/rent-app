import { useTranslation } from 'react-i18next';

import { Tag, type TagTone } from '../../components/Tag';
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

/** A card's two short reasons: the top agreeing criterion (accent) and the differing one (warning,
 * with its words). Not interactive. */
export function MatchChips(props: Props) {
  const { t } = useTranslation();
  const short = (criterion: Criterion, kind: ReasonKind) =>
    props.voice === 'owner'
      ? ownerShort(criterion, kind, props.profile, props.spots, t)
      : seekerShort(criterion, kind, props.listing, props.profile, t);
  const { match } = props;
  const chips: { kind: ReasonKind; text: string; tone: TagTone }[] = [];
  const top = match.agrees[0];
  if (top !== undefined) {
    const text = short(top, 'agree');
    if (text !== null) chips.push({ kind: 'agree', text, tone: 'accent' });
  }
  if (match.differs !== null) {
    const text = short(match.differs, 'differ');
    if (text !== null) chips.push({ kind: 'differ', text, tone: 'warning' });
  }
  if (chips.length === 0) return null;

  return (
    <ul data-testid="match-chips" className="flex flex-wrap gap-1.5">
      {chips.map(({ kind, text, tone }) => (
        <Tag key={kind} as="li" size="sm" tone={tone}>
          {text}
        </Tag>
      ))}
    </ul>
  );
}
