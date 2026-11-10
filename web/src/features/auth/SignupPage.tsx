import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router';

import type { Role } from '../../api/client';
import { safeNext } from './next';
import { OtpForm } from './OtpForm';
import { useMe } from './useMe';

function roleFromQuery(value: string | null): Role | null {
  return value === 'owner' || value === 'seeker' ? value : null;
}

export function SignupPage() {
  const { t } = useTranslation();
  const me = useMe();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  if (me.data) return <Navigate to={next} replace />;

  return (
    <section className="mx-auto flex w-full max-w-[480px] flex-col gap-6">
      <h1 className="text-start text-2xl font-extrabold">{t('auth.signup.title')}</h1>
      <OtpForm withProfile initialRole={roleFromQuery(params.get('role'))} next={next} />
    </section>
  );
}
