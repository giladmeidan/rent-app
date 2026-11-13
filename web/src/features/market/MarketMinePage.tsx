import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { TabPanel, Tabs } from '../../components/Tabs';
import { MyApplicationsPage } from '../applications/MyApplicationsPage';
import { MyListingsPage } from '../listings/MyListingsPage';

type Panel = 'listings' | 'applications';

// No roles in the market (spec 0010b): every account has both panels.
const PANELS: readonly Panel[] = ['listings', 'applications'];

/**
 * `/market/mine`, "שלי" (spec 0010a), signed in (`RequireUser`): the person's rooms and room
 * applications as the two panels of a pill tablist, for every account (spec 0010b);
 * `?tab=applications` deep-links the second, any other `?tab` shows the first. The tab labels the
 * panel (`TabPanel`), so a panel has no heading of its own. One container width for both, so
 * switching tabs never moves the tablist.
 */
export function MarketMinePage() {
  const { t } = useTranslation();
  usePageTitle(t('market.mine.title'));
  const panelId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const panel: Panel = PANELS.find((p) => p === requested) ?? 'listings';
  const labels: Record<Panel, string> = {
    listings: t('market.mine.tabs.listings'),
    applications: t('market.mine.tabs.applications'),
  };

  return (
    <PageContainer as="section" width="wide" className="flex flex-col gap-4">
      <PageHeader title={t('market.mine.title')} />
      <Tabs
        variant="pill"
        label={t('market.mine.tabs.label')}
        items={PANELS.map((value) => ({ value, label: labels[value] }))}
        value={panel}
        onChange={(next) =>
          setSearchParams(next === 'applications' ? { tab: 'applications' } : {}, {
            replace: true,
          })
        }
        panelId={panelId}
        className="self-start"
      />
      <TabPanel panelId={panelId} value={panel}>
        {panel === 'listings' ? (
          <MyListingsPage type="room" panel />
        ) : (
          // The applications' reading column inside the wide page.
          <div className="max-w-page">
            <MyApplicationsPage type="room" panel />
          </div>
        )}
      </TabPanel>
    </PageContainer>
  );
}
