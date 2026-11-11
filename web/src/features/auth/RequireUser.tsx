import { Navigate, Outlet } from 'react-router';

import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useMe } from './useMe';

/** Route guard for pages of either role: logged out → /login, an owner or a seeker → the page. */
export function RequireUser() {
  const me = useMe();

  if (me.isPending) return <Skeleton />;
  // A failed /me (network, 5xx) is not a logout: offer a retry and stay on the page.
  if (me.data === undefined) return <ErrorState onRetry={() => void me.refetch()} />;
  if (me.data === null) return <Navigate to="/login" replace />;
  return <Outlet />;
}
