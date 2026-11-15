import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '../../components/Card';
import type { ListingPublic } from './api';
import {
  AirConditioningIcon,
  ArnonaIcon,
  ConditionIcon,
  ElevatorIcon,
  FurnishedIcon,
  ParkingIcon,
  PetsIcon,
  SafeRoomIcon,
  VaadIcon,
} from './factIcons';
import { conditionLabel, shelterLabel } from './facts';
import { formatIls } from './format';
import { furnishedLabel } from './furnished';

/** One cell of a facts grid: a card with the icon and the label in the `<dt>`, the value in the
 * `<dd>`, which follows it directly (`ListingFacts` and `RoomFacts` share it). */
export function FactCell({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card as="div" padding="sm" className="flex flex-col items-center gap-1.5 text-center">
      <dt className="flex flex-col items-center gap-1.5 text-caption text-ink-muted">
        <span className="text-ink">{icon}</span>
        {label}
      </dt>
      <dd className="text-body-sm font-bold">{value}</dd>
    </Card>
  );
}

/** Listing.dc.html's facts grid as label/value pairs; arnona and vaad only when given. The flat's
 * protected space (0015a) follows the elevator when said, on an apartment and a room alike. An
 * apartment adds its balcony, air conditioning and condition (0014b), each only when said
 * (`ListingPage` renders this grid for a room too, whose facts are `RoomFacts`'). */
export function ListingFacts({ listing }: { listing: ListingPublic }) {
  const { t } = useTranslation();
  const ils = (amount: number) => `${formatIls(amount)} ${t('listings.units.ils')}`;

  const rows: { label: string; value: string; icon: ReactNode }[] = [
    {
      label: t('listings.fields.elevator'),
      value: listing.elevator ? t('listing.yes') : t('listing.no'),
      icon: <ElevatorIcon />,
    },
    ...(listing.shelter === null
      ? []
      : [
          {
            label: t('listings.fields.shelter'),
            value: shelterLabel(t, listing.shelter),
            icon: <SafeRoomIcon />,
          },
        ]),
    {
      label: t('listings.fields.parking'),
      value:
        listing.parking_spots === 0
          ? t('listing.no')
          : t('listing.parking', { count: listing.parking_spots }),
      icon: <ParkingIcon />,
    },
    {
      label: t('listings.fields.furnished'),
      value: furnishedLabel(t, listing.furnished, listing.listing_type),
      icon: <FurnishedIcon />,
    },
    {
      label: t('listings.fields.pets'),
      value: listing.pets_allowed ? t('listing.allowed') : t('listing.notAllowed'),
      icon: <PetsIcon />,
    },
  ];
  if (listing.listing_type === 'apartment') {
    const yesNo = (value: boolean) => (value ? t('listing.yes') : t('listing.no'));
    if (listing.balcony !== null) {
      rows.push({
        label: t('listings.room.balcony'),
        value: yesNo(listing.balcony),
        icon: <ArnonaIcon />,
      });
    }
    if (listing.air_conditioning !== null) {
      rows.push({
        label: t('listings.fields.airConditioning'),
        value: yesNo(listing.air_conditioning),
        icon: <AirConditioningIcon />,
      });
    }
    if (listing.condition !== null) {
      rows.push({
        label: t('listings.fields.condition'),
        value: conditionLabel(t, listing.condition),
        icon: <ConditionIcon />,
      });
    }
  }
  if (listing.arnona_ils !== null) {
    rows.push({
      label: t('listings.fields.arnona'),
      value: ils(listing.arnona_ils),
      icon: <ArnonaIcon />,
    });
  }
  if (listing.vaad_ils !== null) {
    rows.push({
      label: t('listings.fields.vaad'),
      value: ils(listing.vaad_ils),
      icon: <VaadIcon />,
    });
  }

  return (
    <dl className="grid grid-cols-3 gap-2.5 xl:grid-cols-6">
      {rows.map((row) => (
        <FactCell key={row.label} icon={row.icon} label={row.label} value={row.value} />
      ))}
    </dl>
  );
}
