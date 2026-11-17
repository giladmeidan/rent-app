import { createRoutesFromChildren, matchRoutes } from 'react-router';

import { appRouteTree } from './routes';

const routes = createRoutesFromChildren(appRouteTree);

/**
 * The app route a pathname matches, as its pattern (`/listings/:id`, `/chat/:id`, `/` for the
 * index, `/*` for an unknown path), never with a query or hash. For reports that must not carry
 * ids, tokens or search filters (spec 0019a; 0019b reuses it).
 */
export function routePattern(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] || '/';
  const matches = matchRoutes(routes, path);
  if (matches === null) return '/*';
  return `/${matches
    .map((m) => m.route.path)
    .filter(Boolean)
    .join('/')}`;
}
