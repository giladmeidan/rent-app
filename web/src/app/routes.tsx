import { Navigate, Route, Routes } from 'react-router';

import { AreasList } from '../features/areas/AreasList';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireOwner } from '../features/auth/RequireOwner';
import { SignupPage } from '../features/auth/SignupPage';
import { MyListingsPage } from '../features/listings/MyListingsPage';
import { NewListingPage } from '../features/listings/NewListingPage';
import { Layout } from './Layout';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AreasList />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route element={<RequireOwner />}>
          <Route path="listings/new" element={<NewListingPage />} />
          <Route path="me/listings" element={<MyListingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
