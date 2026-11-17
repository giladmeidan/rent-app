import type { TFunction } from 'i18next';

import type { AreaOut } from '../../api/client';

/** A settlement's name; a neighbourhood's "<neighbourhood>, <city>" (names like "מרכז העיר" repeat
 * across cities). A neighbourhood whose city is missing from `areasById` reads as its own name. */
export function areaLabel(
  t: TFunction,
  area: AreaOut,
  areasById: ReadonlyMap<string, AreaOut>,
): string {
  const city = area.parent_id === null ? undefined : areasById.get(area.parent_id);
  if (area.kind === 'settlement' || city === undefined) return area.name_he;
  return t('areas.neighbourhoodOf', { neighbourhood: area.name_he, city: city.name_he });
}

/** Every area's `areaLabel` by id (the people pages' cards). */
export function areaLabels(t: TFunction, areas: readonly AreaOut[] = []): Map<string, string> {
  const byId = new Map(areas.map((area) => [area.id, area]));
  return new Map(areas.map((area) => [area.id, areaLabel(t, area, byId)]));
}
