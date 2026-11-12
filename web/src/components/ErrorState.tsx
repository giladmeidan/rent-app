import { useTranslation } from 'react-i18next';

import { Button } from './Button';
import { useOnline } from './useOnline';

/**
 * A failed load with a retry. `page`: the error is the whole page (it replaces a page that has no
 * other `<h1>`), so the message is the page's `<h1>`. The retry is the kit's primary button (ink,
 * with the accent focus ring). Offline, the message says so (0009f).
 */
export function ErrorState({ onRetry, page = false }: { onRetry: () => void; page?: boolean }) {
  const { t } = useTranslation();
  const online = useOnline();
  const text = online ? t('common.error') : t('common.offline');
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-white px-4 py-[14px]"
    >
      {page ? <h1>{text}</h1> : <p>{text}</p>}
      <Button variant="primary" shape="pill" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
