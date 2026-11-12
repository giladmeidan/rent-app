import { Navigate, Outlet, useLocation } from 'react-router';

import { PageContainer } from '../../components/PageContainer';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { loginWithNext } from './next';
import { useMe } from './useMe';

/** Route guard for seeker-only pages: logged out → /login?next=<this page> (path and query, never
 * the hash), an owner → /, a seeker → the page. */
export function RequireSeeker() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending)
    return (
      <PageContainer>
        <Skeleton />
      </PageContainer>
    );
  // A failed /me (network, 5xx) is not a logout: offer a retry and stay on the page.
  if (me.data === undefined)
    return (
      <PageContainer>
        <ErrorState onRetry={() => void me.refetch()} />
      </PageContainer>
    );
  if (me.data === null) return <Navigate to={loginWithNext(location)} replace />;
  if (me.data.role !== 'seeker') return <Navigate to="/" replace />;
  return <Outlet />;
}
