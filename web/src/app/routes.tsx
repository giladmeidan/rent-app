import { Navigate, Route, Routes } from 'react-router';

import { AreasList } from '../features/areas/AreasList';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireOwner } from '../features/auth/RequireOwner';
import { SignupPage } from '../features/auth/SignupPage';
import { ListingPage } from '../features/listings/ListingPage';
import { MyListingsPage } from '../features/listings/MyListingsPage';
import { NewListingPage } from '../features/listings/NewListingPage';
import { SearchPage } from '../features/search/SearchPage';
import { Layout } from './Layout';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<AreasList />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route path="search" element={<SearchPage />} />
        {/* Public; the static `listings/new` below outranks `:id`. */}
        <Route path="listings/:id" element={<ListingPage />} />
        <Route element={<RequireOwner />}>
          <Route path="listings/new" element={<NewListingPage />} />
          <Route path="me/listings" element={<MyListingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
