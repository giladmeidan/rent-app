import { Navigate, Outlet, useLocation } from 'react-router';

import { PageContainer } from '../../components/PageContainer';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { Skeleton } from '../../components/Skeleton';
import { loginWithNext } from './next';
import { useMe } from './useMe';

/** Route guard for the one owner-only page, `/me/listings` (the owner's apartments; spec 0010b:
 * apartments keep the roles, every room page is `RequireUser`): logged out → /login?next=<this
 * page> (path and query, never the hash), a seeker → /, an owner → the page. */
export function RequireOwner() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending)
    return (
      <PageContainer>
        <Loading>
          <Skeleton />
        </Loading>
      </PageContainer>
    );
  // A failed /me (network, 5xx) is not a logout: offer a retry and stay on the page.
  if (me.data === undefined)
    return (
      <PageContainer>
        <ErrorState page onRetry={() => me.refetch()} />
      </PageContainer>
    );
  if (me.data === null) return <Navigate to={loginWithNext(location)} replace />;
  if (me.data.role !== 'owner') return <Navigate to="/" replace />;
  return <Outlet />;
}
