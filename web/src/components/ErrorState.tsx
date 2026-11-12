import { useTranslation } from 'react-i18next';

import { Button } from './Button';
import { Card } from './Card';
import { useOnline } from './useOnline';

/**
 * A failed load with a retry, in a card. `page`: the error is the whole page (it replaces a page
 * that has no other `<h1>`), so the message is the page's `<h1>`. The retry is the kit's primary
 * button as a pill (ink, with the accent focus ring). Offline, the message says so (0009f).
 */
export function ErrorState({ onRetry, page = false }: { onRetry: () => void; page?: boolean }) {
  const { t } = useTranslation();
  const online = useOnline();
  const text = online ? t('common.error') : t('common.offline');
  return (
    <Card role="alert" padding="md" className="flex flex-col items-start gap-3">
      {page ? (
        <h1 className="text-body text-ink">{text}</h1>
      ) : (
        <p className="text-body text-ink">{text}</p>
      )}
      <Button variant="primary" shape="pill" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </Card>
  );
}
