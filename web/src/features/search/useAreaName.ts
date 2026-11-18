import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { areasQuery } from '../areas/api';
import { areaLabel } from '../areas/areaLabel';

/**
 * Names an area filter's id: its `areaLabel`, or `search.tags.areaFallback` while `/areas` loads,
 * after it fails, and for an id the catalogue does not hold, so such a filter can still be shown
 * and removed. `enabled` false asks for nothing.
 */
export function useAreaName(enabled: boolean): (areaId: string) => string {
  const { t } = useTranslation();
  const { data } = useQuery({ ...areasQuery, enabled });
  const byId = useMemo(() => new Map((data ?? []).map((area) => [area.id, area])), [data]);
  return (areaId) => {
    const area = byId.get(areaId);
    return area === undefined ? t('search.tags.areaFallback') : areaLabel(t, area, byId);
  };
}
