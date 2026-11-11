import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** A loading block: the skeletons (`aria-hidden`) inside a busy region that says it is loading. */
export function Loading({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div aria-busy="true">
      <span className="sr-only">{t('common.loading')}</span>
      {children}
    </div>
  );
}
