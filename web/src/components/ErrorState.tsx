import { useTranslation } from 'react-i18next';

import { Button } from './Button';
import { Card } from './Card';

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Card role="alert" padding="md" className="flex flex-col items-start gap-3">
      <p className="text-body text-ink">{t('common.error')}</p>
      <Button shape="pill" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </Card>
  );
}
