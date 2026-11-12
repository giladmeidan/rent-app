import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';

import i18n from './i18n';
import { AppRoutes } from './routes';

document.documentElement.dir = 'rtl';
document.documentElement.lang = 'he';
document.title = i18n.t('app.title');

// One retry: the default three with backoff delays the error state by ~7 s.
// `networkMode: 'always'`: offline, a request fails at once and the error line says so (0009f Q9),
// instead of pausing until the network returns.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
