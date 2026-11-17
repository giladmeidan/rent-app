import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { AreaOut } from '../../api/client';
import type { MapView } from '../../components/map/MapCanvas';
import { AreaSearch } from '../areas/AreaSearch';
import { areasQuery } from '../areas/api';

const KINDS = ['settlement', 'neighbourhood'] as const;

/** Where the map goes for an area: its centre, at zoom 13 for a settlement, 15 for a neighbourhood. */
export function areaView(area: AreaOut): MapView {
  const [lng = 0, lat = 0] = area.centre;
  return { center: [lng, lat], zoom: area.kind === 'settlement' ? 13 : 15 };
}

type Props = {
  /** An area was chosen: the map goes there. */
  onJump: (view: MapView) => void;
  /** Enter on a name that is not in the catalogue. */
  onNotFound: () => void;
  /** Layout only. */
  className?: string;
};

/**
 * The place box over the full map (spec 0021d): `AreaSearch` over every settlement and
 * neighbourhood in the catalogue; a pick jumps to `areaView`. The chosen name stays in the box.
 * Nothing when `/areas` fails: the map works without it, and one retry (the map's) is enough.
 */
export function PlaceSearch({ onJump, onNotFound, className }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const areas = useQuery(areasQuery);
  if (areas.isError) return null;
  return (
    <div className={className}>
      <AreaSearch
        label={t('search.map.placeLabel')}
        kinds={KINDS}
        value={value}
        onPick={(area) => {
          setValue(area?.id ?? '');
          if (area !== null) onJump(areaView(area));
        }}
        onNotFound={onNotFound}
        enterKeyHint="search"
      />
    </div>
  );
}
