import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import i18n from './i18n';
import { AppRoutes, routerFuture } from './routes';

document.documentElement.dir = 'rtl';
document.documentElement.lang = 'he';
document.title = i18n.t('app.title');

// One retry: the default three with backoff delays the error state by ~7 s.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter future={routerFuture}>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
