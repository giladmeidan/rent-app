import { useTranslation } from 'react-i18next';

import { usePageTitle } from '../../app/usePageTitle';
import { ListingWizard } from './ListingWizard';

export function NewListingPage() {
  const { t } = useTranslation();
  // The wizard's <h1>.
  usePageTitle(t('listings.new.title'));
  return (
    <section className="mx-auto flex w-full max-w-[480px] flex-col">
      <ListingWizard />
    </section>
  );
}
