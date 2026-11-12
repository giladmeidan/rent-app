import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router';

import { Loading } from '../../components/Loading';
import { PageContainer } from '../../components/PageContainer';
import { Skeleton } from '../../components/Skeleton';
import type { Role } from '../../api/client';
import { usePageTitle } from '../../app/usePageTitle';
import { safeNext } from './next';
import { OtpForm } from './OtpForm';
import { useMe } from './useMe';

function roleFromQuery(value: string | null): Role | null {
  return value === 'owner' || value === 'seeker' ? value : null;
}

export function SignupPage() {
  const { t } = useTranslation();
  usePageTitle(t('auth.signup.title'));
  const me = useMe();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  if (me.data) return <Navigate to={next} replace />;

  return (
    <PageContainer as="section" width="narrow" className="flex flex-col gap-6">
      <h1 className="text-start text-2xl font-extrabold">{t('auth.signup.title')}</h1>
      {/* While the session check runs, no editable form (a logged-in person is redirected). */}
      {me.isPending ? (
        <Loading>
          <Skeleton />
        </Loading>
      ) : (
        <OtpForm withProfile initialRole={roleFromQuery(params.get('role'))} next={next} />
      )}
    </PageContainer>
  );
}
