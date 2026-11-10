import createClient from 'openapi-fetch';

import type { components, paths } from './schema';

export type AreaOut = components['schemas']['AreaOut'];
export type UserOut = components['schemas']['UserOut'];
export type Role = UserOut['role'];

export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_URL,
  // Send the httpOnly `rent_session` cookie with every call (the API allows credentials for the
  // exact WEB_ORIGIN only).
  credentials: 'include',
  // Late-bound so tests can stub the global fetch after this module is imported.
  fetch: (request) => fetch(request),
});
