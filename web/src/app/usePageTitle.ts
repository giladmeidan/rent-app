import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Names the browser tab after the page: "{page} · {app}", or the app's name alone while `page` is
 * undefined (a loading state whose heading comes from the data). Unmounting restores the app's
 * name, so a page that sets no title never keeps the previous page's.
 */
export function usePageTitle(page: string | undefined): void {
  const { t } = useTranslation();
  useEffect(() => {
    const app = t('app.title');
    document.title = page === undefined ? app : t('app.pageTitle', { page, app });
    return () => {
      document.title = app;
    };
  }, [page, t]);
}
