import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router';

import { safeNext } from './next';
import { OtpForm } from './OtpForm';
import { useMe } from './useMe';

export function LoginPage() {
  const { t } = useTranslation();
  const me = useMe();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  if (me.data) return <Navigate to={next} replace />;

  return (
    <section className="mx-auto flex w-full max-w-[480px] flex-col gap-6">
      <h1 className="text-start text-2xl font-extrabold">{t('auth.login.title')}</h1>
      <OtpForm withProfile={false} next={next} />
    </section>
  );
}
