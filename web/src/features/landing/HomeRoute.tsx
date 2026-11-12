import { Navigate } from 'react-router';

import { Loading } from '../../components/Loading';
import { PageContainer } from '../../components/PageContainer';
import { Skeleton } from '../../components/Skeleton';
import { useMe } from '../auth/useMe';
import { homeFor } from './home';
import { LandingPage } from './LandingPage';

/**
 * `/`: a signed-in person goes straight to their home; a visitor gets the landing. While `/me` is
 * pending only a skeleton shows, so a signed-in person never sees the landing flash. A failed
 * `/me` counts as logged out, as the header does.
 */
export function HomeRoute() {
  const me = useMe();

  if (me.isPending) {
    return (
      <PageContainer>
        <Loading>
          <Skeleton />
        </Loading>
      </PageContainer>
    );
  }
  if (me.data) return <Navigate to={homeFor(me.data.role)} replace />;
  return <LandingPage />;
}
