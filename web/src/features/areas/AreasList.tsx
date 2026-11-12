import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { fetchAreas } from './api';

const card = 'break-words rounded-2xl border border-border bg-surface px-4 py-[14px]';

export function AreasList() {
  const { t } = useTranslation();
  const areas = useQuery({ queryKey: ['areas'], queryFn: fetchAreas });

  let body;
  if (areas.isPending) {
    body = (
      <ul aria-busy="true" aria-label={t('common.loading')} className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <Skeleton />
          </li>
        ))}
      </ul>
    );
  } else if (areas.isError) {
    body = <ErrorState onRetry={() => void areas.refetch()} />;
  } else if (areas.data.length === 0) {
    body = <EmptyState message={t('areas.empty')} />;
  } else {
    body = (
      <ul className="flex flex-col gap-3">
        {areas.data.map((area) => (
          <li key={area.id} className={card}>
            {area.name_he}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-start text-[22px] font-extrabold">{t('areas.heading')}</h2>
      {body}
    </section>
  );
}
