import { useTranslation } from 'react-i18next';

import { Tag } from '../../components/Tag';
import { TagRemoveButton } from '../../components/TagRemoveButton';
import { formatDate, formatIls, formatRooms } from '../listings/format';
import { countActive, FEATURES, type Feature, type Filters } from './filters';
import { useAreaName } from './useAreaName';

type Props = {
  filters: Filters;
  /** A tag's X: the filters to change, each set to its new value (`undefined` removes it). */
  onRemove: (patch: Partial<Filters>) => void;
  /** Layout only. */
  className?: string;
};

type ActiveTag = { key: string; label: string; patch: Partial<Filters> };

/**
 * The active filters as removable tags: each area first, in the URL's order, then one per set group
 * (a price range, a rooms range, the date, each feature). Nothing when no filter is set.
 */
export function ActiveFilterTags({ filters, onRemove, className }: Props) {
  const { t } = useTranslation();
  const areaIds = filters.area_ids ?? [];
  const areaName = useAreaName(areaIds.length > 0);
  if (countActive(filters) === 0) return null;

  const tags: ActiveTag[] = areaIds.map((areaId) => {
    const rest = areaIds.filter((other) => other !== areaId);
    return {
      key: `area:${areaId}`,
      label: areaName(areaId),
      patch: { area_ids: rest.length > 0 ? rest : undefined },
    };
  });

  const { price_min: min, price_max: max } = filters;
  const noPrice = { price_min: undefined, price_max: undefined };
  if (min !== undefined && max !== undefined) {
    tags.push({
      key: 'price',
      label: t('search.tags.priceRange', { min: formatIls(min), max: formatIls(max) }),
      patch: noPrice,
    });
  } else if (min !== undefined) {
    tags.push({
      key: 'price',
      label: t('search.tags.priceAtLeast', { min: formatIls(min) }),
      patch: noPrice,
    });
  } else if (max !== undefined) {
    tags.push({
      key: 'price',
      label: t('search.tags.priceUpTo', { max: formatIls(max) }),
      patch: noPrice,
    });
  }

  const { rooms_min: roomsMin, rooms_max: roomsMax } = filters;
  if (roomsMin !== undefined || roomsMax !== undefined) {
    let range: string;
    if (roomsMin !== undefined && roomsMax !== undefined) {
      // One room chip is `n` to `n + 0.5`, and reads as "n".
      range =
        roomsMin === roomsMax || roomsMax === roomsMin + 0.5
          ? formatRooms(roomsMin)
          : t('search.tags.roomsRange', { min: formatRooms(roomsMin), max: formatRooms(roomsMax) });
    } else if (roomsMin !== undefined) {
      range = t('search.tags.roomsAtLeast', { min: formatRooms(roomsMin) });
    } else {
      range = t('search.tags.roomsUpTo', { max: formatRooms(roomsMax ?? 0) });
    }
    tags.push({
      key: 'rooms',
      label: t('search.tags.rooms', { range }),
      patch: { rooms_min: undefined, rooms_max: undefined },
    });
  }

  if (filters.available_by !== undefined) {
    tags.push({
      key: 'available_by',
      label: t('search.tags.availableBy', { date: formatDate(filters.available_by) }),
      patch: { available_by: undefined },
    });
  }

  const featureLabels: Record<Feature, string> = {
    pets: t('search.feature.pets'),
    furnished: t('search.feature.furnished'),
    elevator: t('search.feature.elevator'),
    parking: t('search.feature.parking'),
    shelter: t('search.feature.shelter'),
  };
  for (const feature of FEATURES) {
    if (filters[feature] === true) {
      tags.push({
        key: feature,
        label: featureLabels[feature],
        patch: { [feature]: undefined },
      });
    }
  }

  return (
    // `py-1`: the row scrolls sideways, which would otherwise clip the buttons' 44 px hit area.
    <ul
      aria-label={t('search.tags.label')}
      className={`flex flex-nowrap items-center gap-2 overflow-x-auto py-1${className === undefined ? '' : ` ${className}`}`}
    >
      {tags.map(({ key, label, patch }) => (
        <Tag key={key} as="li" tone="accent" className="shrink-0 whitespace-nowrap">
          {label}
          <TagRemoveButton
            aria-label={t('search.tags.remove', { name: label })}
            onClick={() => onRemove(patch)}
          />
        </Tag>
      ))}
    </ul>
  );
}
