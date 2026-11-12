import { PageContainer } from '../../components/PageContainer';
import { ListingWizard } from './ListingWizard';

export function NewListingPage() {
  return (
    <PageContainer as="section" width="narrow" className="flex flex-col">
      <ListingWizard />
    </PageContainer>
  );
}
