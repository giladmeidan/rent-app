import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { ListingPublic } from '../listings/api';
import { LIFESTYLE_KEYS, type LifestyleAnswers } from '../lifestyle/keys';
import { lifestyleTopic } from '../lifestyle/topic';
import { flatmatesText, genderPreferenceLabel } from './flatmates';

// The cards of `ListingFacts`' grid.
const factCard =
  'flex flex-col items-center gap-[6px] rounded-[14px] border border-border bg-surface px-[10px] py-3 text-center';

/**
 * A room's "על החדר" on its listing page: who it is for, its flatmates and, when the room's side
 * answered any, "אורח החיים בדירה". Renders what the response holds: a visitor or an owner gets no
 * ages and no answers (PRODUCT.md "Rooms", room privacy), so they see neither, with no empty block.
 */
export function RoomFacts({ listing }: { listing: ListingPublic }) {
  const { t } = useTranslation();
  const headingId = useId();

  const rows = [
    { label: t('rooms.facts.gender'), value: genderPreferenceLabel(t, listing.gender_preference) },
  ];
  const flatmates = flatmatesText(t, listing);
  if (flatmates !== null) rows.push({ label: t('rooms.facts.flatmates'), value: flatmates });

  const answers: LifestyleAnswers = listing.lifestyle;
  const answered = LIFESTYLE_KEYS.flatMap((key) => {
    const answer = answers[key];
    // `i18n-check` does not see these dynamic keys; 0007d's catalogue test covers them.
    return answer === undefined
      ? []
      : [
          {
            key,
            topic: lifestyleTopic(key, t),
            value: t(`lifestyle.${key}.answer.${String(answer)}`),
          },
        ];
  });

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-[10px]">
      <h2 id={headingId} className="text-[17px] font-extrabold">
        {t('rooms.facts.title')}
      </h2>
      <dl data-testid="room-facts" className="grid grid-cols-2 gap-[10px] sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className={factCard}>
            <dt className="text-xs text-ink-muted">{row.label}</dt>
            <dd className="text-sm font-bold">{row.value}</dd>
          </div>
        ))}
      </dl>
      {answered.length > 0 && (
        <>
          <h3 className="pt-1 text-[15px] font-bold">{t('lifestyle.title.flat')}</h3>
          <dl
            data-testid="room-lifestyle"
            className="flex flex-col divide-y divide-border rounded-[14px] border border-border bg-surface"
          >
            {answered.map((row) => (
              <div
                key={row.key}
                className="flex items-center justify-between gap-3 px-[14px] py-[10px]"
              >
                <dt className="text-sm text-ink-muted">{row.topic}</dt>
                <dd className="text-sm font-bold">{row.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
