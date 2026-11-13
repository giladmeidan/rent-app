import { PageContainer } from '../../components/PageContainer';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { useMe } from '../auth/useMe';
import type { ListingType } from './api';
import { ListingWizard } from './ListingWizard';

/** `?type=apartment|room` (spec 0010a) preselects the type and skips the type step; any other
 * value is ignored. Only an owner posts an apartment (spec 0010b): a non-owner always gets the
 * room flow, whatever `?type=` says, and never sees the type step. */
function typeParam(value: string | null): ListingType | undefined {
  return value === 'apartment' || value === 'room' ? value : undefined;
}

export function NewListingPage() {
  const { t } = useTranslation();
  // The wizard's <h1>.
  usePageTitle(t('listings.new.title'));
  const [searchParams] = useSearchParams();
  // `RequireUser` has loaded `me`.
  const owner = useMe().data?.role === 'owner';
  return (
    <PageContainer as="section" width="wide">
      <ListingWizard initialType={owner ? typeParam(searchParams.get('type')) : 'room'} />
    </PageContainer>
  );
}
