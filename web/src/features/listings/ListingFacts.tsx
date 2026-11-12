import { useTranslation } from 'react-i18next';

import type { ListingPublic } from './api';
import { formatIls } from './format';
import { furnishedLabel } from './furnished';

/** Listing.dc.html's facts grid as label/value pairs; arnona and vaad only when given. */
export function ListingFacts({ listing }: { listing: ListingPublic }) {
  const { t } = useTranslation();
  const ils = (amount: number) => `${formatIls(amount)} ${t('listings.units.ils')}`;

  const rows: { label: string; value: string }[] = [
    {
      label: t('listings.fields.elevator'),
      value: listing.elevator ? t('listing.yes') : t('listing.no'),
    },
    {
      label: t('listings.fields.parking'),
      value:
        listing.parking_spots === 0
          ? t('listing.no')
          : t('listing.parking', { count: listing.parking_spots }),
    },
    {
      label: t('listings.fields.furnished'),
      value: furnishedLabel(t, listing.furnished, listing.listing_type),
    },
    {
      label: t('listings.fields.pets'),
      value: listing.pets_allowed ? t('listing.allowed') : t('listing.notAllowed'),
    },
  ];
  if (listing.arnona_ils !== null) {
    rows.push({ label: t('listings.fields.arnona'), value: ils(listing.arnona_ils) });
  }
  if (listing.vaad_ils !== null) {
    rows.push({ label: t('listings.fields.vaad'), value: ils(listing.vaad_ils) });
  }

  return (
    <dl className="grid grid-cols-2 gap-[10px] sm:grid-cols-3">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex flex-col items-center gap-[6px] rounded-[14px] border border-border bg-surface px-[10px] py-3 text-center"
        >
          <dt className="text-xs text-ink-muted">{row.label}</dt>
          <dd className="text-sm font-bold">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
