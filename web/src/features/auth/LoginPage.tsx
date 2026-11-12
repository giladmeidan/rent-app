import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router';

import { PageContainer } from '../../components/PageContainer';
import { usePageTitle } from '../../app/usePageTitle';
import { safeNext } from './next';
import { OtpForm } from './OtpForm';
import { useMe } from './useMe';

export function LoginPage() {
  const { t } = useTranslation();
  usePageTitle(t('auth.login.title'));
  const me = useMe();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  if (me.data) return <Navigate to={next} replace />;

  return (
    <PageContainer as="section" width="narrow" className="flex flex-col gap-6">
      <h1 className="text-start text-2xl font-extrabold">{t('auth.login.title')}</h1>
      <OtpForm withProfile={false} next={next} />
    </PageContainer>
  );
}
