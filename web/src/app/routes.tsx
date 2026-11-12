import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { ApplicantsPage } from '../features/applicants/ApplicantsPage';
import { MyApplicationsPage } from '../features/applications/MyApplicationsPage';
import { AreasList } from '../features/areas/AreasList';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireOwner } from '../features/auth/RequireOwner';
import { RequireSeeker } from '../features/auth/RequireSeeker';
import { RequireUser } from '../features/auth/RequireUser';
import { SignupPage } from '../features/auth/SignupPage';
import { ChatListPage } from '../features/chat/ChatListPage';
import { ChatThreadPage } from '../features/chat/ChatThreadPage';
import { FlatmatesPage } from '../features/flatmates/FlatmatesPage';
import { JoinFlatPage } from '../features/flatmates/JoinFlatPage';
import { MyFlatsPage } from '../features/flatmates/MyFlatsPage';
import { MyLikesPage } from '../features/likes/MyLikesPage';
import { EditListingPage } from '../features/listings/EditListingPage';
import { ListingPage } from '../features/listings/ListingPage';
import { MyListingsPage } from '../features/listings/MyListingsPage';
import { NewListingPage } from '../features/listings/NewListingPage';
import { PeoplePage } from '../features/people/PeoplePage';
import { ProfilePage } from '../features/profile/ProfilePage';
import { SearchPage } from '../features/search/SearchPage';
import { PageContainer } from '../components/PageContainer';
import { Skeleton } from '../components/Skeleton';
import { Layout } from './Layout';

// The dev-only kit gallery (spec 0009d): neither the route nor its chunk ships in a build.
const KitPreview = import.meta.env.DEV ? lazy(() => import('./KitPreview')) : null;

export function AppRoutes() {
  return (
    <Routes>
      {KitPreview && (
        <Route
          path="dev/kit"
          element={
            <Suspense
              fallback={
                <PageContainer>
                  <Skeleton />
                </PageContainer>
              }
            >
              <KitPreview />
            </Suspense>
          }
        />
      )}
      <Route element={<Layout />}>
        <Route index element={<AreasList />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route path="search" element={<SearchPage />} />
        {/* Public; the static `listings/new` below outranks `:id`. */}
        <Route path="listings/:id" element={<ListingPage />} />
        {/* Public (0008e A1): the page takes the token out of the hash before its own login check. */}
        <Route path="flatmates/join" element={<JoinFlatPage />} />
        <Route element={<RequireOwner />}>
          <Route path="listings/new" element={<NewListingPage />} />
          <Route path="me/listings" element={<MyListingsPage />} />
          <Route path="me/listings/:id/edit" element={<EditListingPage />} />
          <Route path="me/listings/:id/applicants" element={<ApplicantsPage />} />
          <Route path="me/listings/:id/people" element={<PeoplePage />} />
          <Route path="me/listings/:id/flatmates" element={<FlatmatesPage />} />
        </Route>
        <Route element={<RequireSeeker />}>
          <Route path="me/applications" element={<MyApplicationsPage />} />
          <Route path="me/likes" element={<MyLikesPage />} />
          <Route path="me/profile" element={<ProfilePage />} />
        </Route>
        <Route element={<RequireUser />}>
          <Route path="chat" element={<ChatListPage />} />
          <Route path="chat/:id" element={<ChatThreadPage />} />
          <Route path="me/flats" element={<MyFlatsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
