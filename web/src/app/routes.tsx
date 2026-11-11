import { Navigate, Route, Routes } from 'react-router';

import { ApplicantsPage } from '../features/applicants/ApplicantsPage';
import { MyApplicationsPage } from '../features/applications/MyApplicationsPage';
import { AreasList } from '../features/areas/AreasList';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireOwner } from '../features/auth/RequireOwner';
import { RequireSeeker } from '../features/auth/RequireSeeker';
import { SignupPage } from '../features/auth/SignupPage';
import { EditListingPage } from '../features/listings/EditListingPage';
import { ListingPage } from '../features/listings/ListingPage';
import { MyListingsPage } from '../features/listings/MyListingsPage';
import { NewListingPage } from '../features/listings/NewListingPage';
import { ProfilePage } from '../features/profile/ProfilePage';
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
          <Route path="me/listings/:id/edit" element={<EditListingPage />} />
          <Route path="me/listings/:id/applicants" element={<ApplicantsPage />} />
        </Route>
        <Route element={<RequireSeeker />}>
          <Route path="me/applications" element={<MyApplicationsPage />} />
          <Route path="me/profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
