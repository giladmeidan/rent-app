import { useTranslation } from 'react-i18next';

import { Button } from './Button';

/**
 * A failed load with a retry. `page`: the error is the whole page (it replaces a page that has no
 * other `<h1>`), so the message is the page's `<h1>`. The retry is the kit's primary button (ink,
 * with the accent focus ring).
 */
export function ErrorState({ onRetry, page = false }: { onRetry: () => void; page?: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-white px-4 py-[14px]"
    >
      {page ? <h1>{t('common.error')}</h1> : <p>{t('common.error')}</p>}
      <Button variant="primary" shape="pill" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
