import { useTranslation } from 'react-i18next';

import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';

/** `/account-deleted` (spec 0013f): public and static, where a deleted person lands. */
export function AccountDeletedPage() {
  const { t } = useTranslation();
  usePageTitle(t('accountDeleted.title'));
  return (
    <PageContainer as="section" width="narrow" className="flex flex-col items-start gap-4">
      <PageHeader title={t('accountDeleted.title')} />
      <p className="text-body">{t('accountDeleted.body')}</p>
      <Button to="/" variant="primary">
        {t('accountDeleted.home')}
      </Button>
    </PageContainer>
  );
}
