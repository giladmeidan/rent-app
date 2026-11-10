import { Navigate, Route, Routes } from 'react-router-dom';

import { AreasList } from '../features/areas/AreasList';
import { LoginPage } from '../features/auth/LoginPage';
import { SignupPage } from '../features/auth/SignupPage';
import { Layout } from './Layout';

// Opt in to the v7 behaviours now (and silence the router's deprecation warnings).
export const routerFuture = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AreasList />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
