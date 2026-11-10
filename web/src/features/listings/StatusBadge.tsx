import { useTranslation } from 'react-i18next';

import type { ListingOut } from './api';

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

const tone: Record<ListingState, string> = {
  live: 'bg-accent-tint text-accent-text',
  paused: 'bg-line text-muted',
  expired: 'bg-warn text-warn-text',
};

export function StatusBadge({ state }: { state: ListingState }) {
  const { t } = useTranslation();
  const label = {
    live: t('listings.status.live'),
    paused: t('listings.status.paused'),
    expired: t('listings.status.expired'),
  }[state];
  return (
    <span
      data-testid="status-badge"
      className={`shrink-0 rounded-full px-3 py-[5px] text-[13px] font-bold ${tone[state]}`}
    >
      {label}
    </span>
  );
}
