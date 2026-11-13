import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { TabPanel, Tabs } from '../../components/Tabs';
import { MyApplicationsPage } from '../applications/MyApplicationsPage';
import { useMe } from '../auth/useMe';
import { MyListingsPage } from '../listings/MyListingsPage';

type Panel = 'listings' | 'applications';

/**
 * `/market/mine`, "שלי" (spec 0010a), signed in (`RequireUser`): the person's rooms and room
 * applications as panels of a pill tablist (`?tab=applications` deep-links the second). While
 * roles apply there is one panel per role and no tablist: an owner's rooms, a seeker's room
 * applications; `0010b` gives every account both. An unknown or unavailable `?tab` shows the first.
 */
export function MarketMinePage() {
  const { t } = useTranslation();
  usePageTitle(t('market.mine.title'));
  const me = useMe();
  const panelId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const panels: readonly Panel[] = me.data?.role === 'owner' ? ['listings'] : ['applications'];
  const requested = searchParams.get('tab');
  const panel: Panel = panels.find((p) => p === requested) ?? panels[0] ?? 'listings';

  const content =
    panel === 'listings' ? (
      <MyListingsPage type="room" panel />
    ) : (
      <MyApplicationsPage type="room" panel />
    );
  const labels: Record<Panel, string> = {
    listings: t('market.mine.tabs.listings'),
    applications: t('market.mine.tabs.applications'),
  };

  const page = (
    <>
      <PageHeader title={t('market.mine.title')} />
      {panels.length > 1 ? (
        <>
          <Tabs
            variant="pill"
            label={t('market.mine.tabs.label')}
            items={panels.map((value) => ({ value, label: labels[value] }))}
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
            {content}
          </TabPanel>
        </>
      ) : (
        content
      )}
    </>
  );

  // Each panel at its own page's width: the room cards' grid, the applications' column.
  return panel === 'listings' ? (
    <PageContainer as="section" width="wide" className="flex flex-col gap-4">
      {page}
    </PageContainer>
  ) : (
    <PageContainer as="section" width="default" className="flex flex-col gap-4">
      {page}
    </PageContainer>
  );
}
