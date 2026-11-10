import createClient from 'openapi-fetch';

import type { components, paths } from './schema';

export type AreaOut = components['schemas']['AreaOut'];

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_URL,
  // Late-bound so tests can stub the global fetch after this module is imported.
  fetch: (request) => fetch(request),
});
