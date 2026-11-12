import { useTranslation } from 'react-i18next';
import { Link, Navigate, useSearchParams } from 'react-router';

import { Card } from '../../components/Card';
import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';
import { Logo } from '../../components/Logo';
import { Mascot } from '../../components/Mascot';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
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

  // Only `safeNext`'s output goes into the link; `?role` is not carried.
  const toLogin = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;

  return (
    <PageContainer as="section" width="narrow" className="flex flex-col gap-4 lg:pt-10">
      <div data-testid="auth-brand" className="flex flex-col items-center gap-3">
        <Mascot pose="hello" width={112} className="w-24 lg:w-28" />
        <Logo variant="wordmark" tone="dark" decorative className="h-7" />
      </div>
      <Card data-testid="auth-card" padding="lg" className="flex flex-col gap-6">
        <PageHeader title={t('auth.signup.title')} subtitle={t('auth.signup.subtitle')} />
        <OtpForm withProfile initialRole={roleFromQuery(params.get('role'))} next={next} />
      </Card>
      <p className="text-center text-body text-ink-muted">
        {t('auth.signup.haveAccount')}{' '}
        <Link
          to={toLogin}
          className={cx(
            'inline-flex min-h-11 items-center px-1 font-medium text-accent underline underline-offset-4 hover:text-accent-strong',
            focusRing,
          )}
        >
          {t('auth.signup.toLogin')}
        </Link>
      </p>
    </PageContainer>
  );
}
