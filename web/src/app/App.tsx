import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { AreasList } from '../features/areas/AreasList';
import './i18n';

document.documentElement.dir = 'rtl';
document.documentElement.lang = 'he';

const queryClient = new QueryClient();

function Header() {
  const { t } = useTranslation();
  return (
    <header className="pb-2 pt-[18px]">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent">
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 11l9-8 9 8" />
            <path d="M5 10v10h14V10" />
          </svg>
        </div>
        <h1 className="text-xl font-extrabold">{t('app.title')}</h1>
      </div>
      <p className="mt-1 text-muted">{t('app.tagline')}</p>
    </header>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="mx-auto max-w-[640px] px-4">
        <Header />
        <main className="pb-8 pt-6">
          <AreasList />
        </main>
      </div>
    </QueryClientProvider>
  );
}
