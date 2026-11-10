import { useTranslation } from 'react-i18next';

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-white px-4 py-[14px]"
    >
      <p>{t('common.error')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[44px] rounded-full bg-accent px-5 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {t('common.retry')}
      </button>
    </div>
  );
}
