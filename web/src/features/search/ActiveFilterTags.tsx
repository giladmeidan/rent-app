import { useTranslation } from 'react-i18next';

import { Tag } from '../../components/Tag';
import { formatDate, formatIls, formatRooms } from '../listings/format';
import { countActive, type Feature, type Filters } from './filters';

type Props = {
  filters: Filters;
  /** Layout only. */
  className?: string;
};

/**
 * The active filters as static tags, one per set group (a price range, a rooms range, the date, each
 * feature). Nothing when no filter is set. They are not buttons: removing a filter is the panel's
 * job.
 */
export function ActiveFilterTags({ filters, className }: Props) {
  const { t } = useTranslation();
  if (countActive(filters) === 0) return null;

  const tags: string[] = [];

  const { price_min: min, price_max: max } = filters;
  if (min !== undefined && max !== undefined) {
    tags.push(t('search.tags.priceRange', { min: formatIls(min), max: formatIls(max) }));
  } else if (min !== undefined) {
    tags.push(t('search.tags.priceAtLeast', { min: formatIls(min) }));
  } else if (max !== undefined) {
    tags.push(t('search.tags.priceUpTo', { max: formatIls(max) }));
  }

  const { rooms_min: roomsMin, rooms_max: roomsMax } = filters;
  if (roomsMin !== undefined || roomsMax !== undefined) {
    let range: string;
    if (roomsMin !== undefined && roomsMax !== undefined) {
      range =
        roomsMin === roomsMax
          ? formatRooms(roomsMin)
          : t('search.tags.roomsRange', { min: formatRooms(roomsMin), max: formatRooms(roomsMax) });
    } else if (roomsMin !== undefined) {
      range = t('search.tags.roomsAtLeast', { min: formatRooms(roomsMin) });
    } else {
      range = t('search.tags.roomsUpTo', { max: formatRooms(roomsMax ?? 0) });
    }
    tags.push(t('search.tags.rooms', { range }));
  }

  if (filters.available_by !== undefined) {
    tags.push(t('search.tags.availableBy', { date: formatDate(filters.available_by) }));
  }

  const featureLabels: Record<Feature, string> = {
    pets: t('search.feature.pets'),
    furnished: t('search.feature.furnished'),
    elevator: t('search.feature.elevator'),
    parking: t('search.feature.parking'),
  };
  for (const feature of ['pets', 'furnished', 'elevator', 'parking'] as const) {
    if (filters[feature] === true) tags.push(featureLabels[feature]);
  }

  return (
    <ul
      aria-label={t('search.tags.label')}
      className={`flex flex-nowrap items-center gap-2 overflow-x-auto${className === undefined ? '' : ` ${className}`}`}
    >
      {tags.map((tag) => (
        <Tag key={tag} as="li" tone="accent" className="shrink-0 whitespace-nowrap">
          {tag}
        </Tag>
      ))}
    </ul>
  );
}
