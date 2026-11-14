import { useTranslation } from 'react-i18next';

import { ListingCard } from '../listings/ListingCard';
import { todayInIsrael } from '../listings/format';
import { useMyLikes } from '../likes/useMyLikes';
import { MatchBadge } from '../match/MatchBadge';
import { MatchChips } from '../match/MatchChips';
import { hasLooking } from '../profile/api';
import { useProfile } from '../profile/useProfile';
import type { LikedRoomOut } from '../likes/api';

/**
 * The rooms whose lister invited the caller (spec 0010l, moved here by 0010m), above the room
 * applications: each card is a plain link to the room's page, where the caller applies (an
 * application answers the invite and opens the chat). Renders only with at least one invite;
 * pending, failed or empty renders nothing (no skeleton, no retry) and never blocks the
 * applications. A component of its own, so the type switch in `MyApplications` has no conditional
 * hooks; the profile for the match chips is read only once there is something to show.
 */
export function InvitesSection() {
  const likes = useMyLikes();
  const invites = likes.data?.liked_me ?? [];
  if (invites.length === 0) return null;
  return <Invites items={invites} />;
}

function Invites({ items }: { items: LikedRoomOut[] }) {
  const { t } = useTranslation();
  const stored = useProfile().data;
  const profile = hasLooking(stored) ? stored : undefined;
  const today = todayInIsrael();
  return (
    <section className="flex flex-col gap-3" aria-labelledby="applications-invites">
      <h2 id="applications-invites" className="text-start font-display text-h2">
        {t('applications.invites.title')}
      </h2>
      <p className="text-start text-body text-ink-muted">{t('applications.invites.hint')}</p>
      <ul className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        {items.map(({ listing }) => (
          <li key={listing.id}>
            {/* `h3`: the cards sit under the section `<h2>`. */}
            <ListingCard
              listing={listing}
              today={today}
              to={`/listings/${listing.id}`}
              titleAs="h3"
              coverUrl={listing.cover?.small_url}
              seekerBirthYear={profile?.birth_year}
              badge={listing.match && <MatchBadge score={listing.match.score} />}
            >
              {listing.match && (
                <MatchChips match={listing.match} listing={listing} profile={profile} />
              )}
            </ListingCard>
          </li>
        ))}
      </ul>
    </section>
  );
}
