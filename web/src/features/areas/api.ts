import { api, type AreaOut } from '../../api/client';

export async function fetchAreas(): Promise<AreaOut[]> {
  const { data, response } = await api.GET('/areas');
  if (data === undefined) throw new Error(`GET /areas: HTTP ${String(response.status)}`);
  return data;
}
