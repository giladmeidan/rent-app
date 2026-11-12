import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Loading } from '../../components/Loading';
import { Skeleton } from '../../components/Skeleton';
import { useMe } from '../auth/useMe';
import type { ListingPublic } from '../listings/api';
import { useProfile } from '../profile/useProfile';
import { bucket } from './bucket';
import { AgreeIcon, DifferIcon } from './icons';
import { seekerReason } from './reasons';
import type { MatchOut } from './types';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

// A high score is drawn in the accent, as the artboard; good and partial in the badge's neutral.
const frame = {
  high: { card: 'border-accent', score: 'border-accent bg-accent-soft text-accent-strong' },
  good: { card: 'border-border', score: 'border-border-strong bg-surface-subtle text-ink-muted' },
  partial: {
    card: 'border-border',
    score: 'border-border-strong bg-surface-subtle text-ink-muted',
  },
} as const;

type Props = {
  match: MatchOut;
  listing: ListingPublic;
};

/**
 * The listing page's "ההתאמה שלך" (Listing.dc.html): the score, its label, up to three agreeing
 * lines and the differing one, worded from the listing and the seeker's own profile. The lines
 * need the profile: skeletons while it loads, and only the score and label when it cannot be read.
 */
export function MatchCard({ match, listing }: Props) {
  const { t } = useTranslation();
  const headingId = useId();
  const me = useMe();
  const profile = useProfile(me.data?.role === 'seeker');
  const level = bucket(match.score);
  const label = {
    high: t('match.bucket.high'),
    good: t('match.bucket.good'),
    partial: t('match.bucket.partial'),
  }[level];

  let lines = null;
  // `isLoading`, not `isPending`: a disabled query (the session just ended) stays pending forever.
  if (profile.isLoading) {
    lines = (
      <Loading>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      </Loading>
    );
  } else if (profile.data !== undefined && profile.data !== null) {
    const p = profile.data;
    lines = (
      <ul className="flex flex-col gap-2">
        {match.agrees.map((criterion) => (
          <li key={criterion} className="flex items-center gap-[10px] text-sm">
            <AgreeIcon />
            <span>{seekerReason(criterion, 'agree', listing, p, t)}</span>
          </li>
        ))}
        {match.differs !== null && (
          <li className="flex items-center gap-[10px] text-sm text-ink-muted">
            <DifferIcon />
            <span>{seekerReason(match.differs, 'differ', listing, p, t)}</span>
          </li>
        )}
      </ul>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-[10px]">
      <h2 id={headingId} className="text-[17px] font-extrabold">
        {t('match.card.title')}
      </h2>
      <div
        className={`flex flex-col gap-[14px] rounded-[18px] border-[1.5px] bg-surface p-4 ${frame[level].card}`}
      >
        <div className="flex items-center gap-[14px]">
          <p
            className={`flex size-16 shrink-0 items-center justify-center rounded-full border-4 text-[19px] font-extrabold ${frame[level].score}`}
          >
            {t('match.card.score', { score: match.score })}
          </p>
          <div className="flex flex-col gap-[2px]">
            <p className="text-base font-bold">{label}</p>
            <p className="text-[13px] text-ink-muted">{t('match.card.basis')}</p>
          </div>
        </div>
        {lines}
        <Link
          to={`/me/profile?next=${encodeURIComponent(`/listings/${listing.id}`)}`}
          className={`inline-flex min-h-[44px] items-center self-start rounded-full text-sm font-semibold text-accent-strong underline underline-offset-4 ${focusRing}`}
        >
          {t('match.card.edit')}
        </Link>
      </div>
    </section>
  );
}
