import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';

import i18n from './i18n';
import { createQueryClient } from './queryClient';
import { AppRoutes } from './routes';

document.documentElement.dir = 'rtl';
document.documentElement.lang = 'he';
document.title = i18n.t('app.title');

const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
