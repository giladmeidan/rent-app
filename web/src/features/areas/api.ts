import { queryOptions } from '@tanstack/react-query';

import { api, type AreaOut } from '../../api/client';

export async function fetchAreas(): Promise<AreaOut[]> {
  const { data, response } = await api.GET('/areas');
  if (data === undefined) throw new Error(`GET /areas: HTTP ${String(response.status)}`);
  return data;
}

/** `GET /areas`, loaded once per visit (spec 0021b NF1): the catalogue only changes with an import.
 * Explicit refetches (the wizard's `unknown_area`, the profile's retry) still go out. */
export const areasQuery = queryOptions({
  queryKey: ['areas'],
  queryFn: fetchAreas,
  staleTime: Infinity,
  gcTime: Infinity,
});
