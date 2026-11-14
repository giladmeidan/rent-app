import { useTranslation } from 'react-i18next';

import { Badge, type BadgeTone } from '../../components/Badge';
import type { ListingOut } from './api';
import { RENEWAL_WINDOW_DAYS } from './constants';

export type ListingState = 'live' | 'paused' | 'expired';

/** Live = active and not yet expired (spec 0002a); a paused listing reads paused even if expired. */
export function listingState(
  listing: Pick<ListingOut, 'status' | 'expires_at'>,
  now: Date,
): ListingState {
  if (listing.status === 'active' && new Date(listing.expires_at) > now) return 'live';
  if (listing.status === 'paused') return 'paused';
  return 'expired';
}

/** Past expiry (`expires_at <= now`), whatever the status: such a listing is read-only (spec 0002f). */
export function isPastExpiry(listing: Pick<ListingOut, 'expires_at'>, now: Date): boolean {
  return new Date(listing.expires_at) <= now;
}

/** Renewable (spec 0011a): from `RENEWAL_WINDOW_DAYS` before `expires_at`, and any time after. */
export function inRenewalWindow(listing: Pick<ListingOut, 'expires_at'>, now: Date): boolean {
  return new Date(listing.expires_at).getTime() - now.getTime() <= RENEWAL_WINDOW_DAYS * 86_400_000;
}

const tone: Record<ListingState, BadgeTone> = {
  live: 'accent',
  paused: 'neutral',
  expired: 'warning',
};

export function StatusBadge({ state }: { state: ListingState }) {
  const { t } = useTranslation();
  const label = {
    live: t('listings.status.live'),
    paused: t('listings.status.paused'),
    expired: t('listings.status.expired'),
  }[state];
  return (
    <Badge tone={tone[state]} data-testid="status-badge" className="shrink-0">
      {label}
    </Badge>
  );
}
