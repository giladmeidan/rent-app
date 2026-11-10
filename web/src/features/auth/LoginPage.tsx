import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';

import { OtpForm } from './OtpForm';
import { useMe } from './useMe';

export function LoginPage() {
  const { t } = useTranslation();
  const me = useMe();

  if (me.data) return <Navigate to="/" replace />;

  return (
    <section className="mx-auto flex w-full max-w-[480px] flex-col gap-6">
      <h1 className="text-start text-2xl font-extrabold">{t('auth.login.title')}</h1>
      <OtpForm withProfile={false} />
    </section>
  );
}
