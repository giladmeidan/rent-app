import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { listingState } from '../listings/StatusBadge';
import { useMyListings } from '../listings/useMyListings';

/**
 * Under the card-required nudge of `/market/people` (spec 0010m): an account with a live room is
 * pointed to that room's own people page, where the lister invites seekers (no card needed). One
 * live room links to its page, two or more to "הפעילות שלי". Rendered only in the 403 branch, so
 * `GET /me/listings` is requested only there; loading, failed or no live room renders nothing and
 * never blocks the nudge. The live test is `MyListingsPage`'s for its people button.
 */
export function RoomInviteHint() {
  const { t } = useTranslation();
  const listings = useMyListings();
  const now = new Date();
  const live = (listings.data ?? []).filter(
    (listing) => listing.listing_type === 'room' && listingState(listing, now) === 'live',
  );
  const [first] = live;
  if (first === undefined) return null;

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <p className="text-body text-ink-muted">{t('market.people.roomHint')}</p>
      <Button
        variant="secondary"
        to={live.length === 1 ? `/me/listings/${first.id}/people` : '/market/mine'}
      >
        {t('market.people.toRoomPeople')}
      </Button>
    </div>
  );
}
