import { useTranslation } from 'react-i18next';

/**
 * A failed load with a retry. `page`: the error is the whole page (it replaces a page that has no
 * other `<h1>`), so the message is the page's `<h1>`.
 */
export function ErrorState({ onRetry, page = false }: { onRetry: () => void; page?: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-white px-4 py-[14px]"
    >
      {page ? <h1>{t('common.error')}</h1> : <p>{t('common.error')}</p>}
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[44px] rounded-full bg-ink px-5 font-semibold text-on-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {t('common.retry')}
      </button>
    </div>
  );
}
