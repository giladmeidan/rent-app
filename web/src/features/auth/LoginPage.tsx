import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router';

import { Card } from '../../components/Card';
import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';
import { Loading } from '../../components/Loading';
import { Logo } from '../../components/Logo';
import { Mascot } from '../../components/Mascot';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
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

  // Only `safeNext`'s output goes into the link; `?role` is not carried.
  const toSignup = next === '/' ? '/signup' : `/signup?next=${encodeURIComponent(next)}`;

  return (
    <PageContainer as="section" width="narrow" className="flex flex-col gap-4 lg:pt-10">
      <div data-testid="auth-brand" className="flex flex-col items-center gap-3">
        <Mascot pose="hello" width={112} className="w-24 lg:w-28" />
        <Logo variant="wordmark" tone="dark" lang="en" decorative className="h-7" />
      </div>
      <Card data-testid="auth-card" padding="lg" className="flex flex-col gap-6">
        <PageHeader title={t('auth.login.title')} subtitle={t('auth.login.subtitle')} />
        {/* While the session check runs, no editable form (a logged-in person is redirected). */}
        {me.isPending ? (
          <Loading>
            <Skeleton />
          </Loading>
        ) : (
          <OtpForm withProfile={false} next={next} />
        )}
      </Card>
      <p className="text-center text-body text-ink-muted">
        {t('auth.login.noAccount')}{' '}
        <Link
          to={toSignup}
          className={cx(
            'inline-flex min-h-11 items-center px-1 font-medium text-accent underline underline-offset-4 hover:text-accent-strong',
            focusRing,
          )}
        >
          {t('auth.login.toSignup')}
        </Link>
      </p>
    </PageContainer>
  );
}
