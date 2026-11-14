import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ArnonaIcon,
  ElevatorIcon,
  FlatmatesIcon,
  FurnishedIcon,
  PersonIcon,
  VaadIcon,
} from '../listings/factIcons';
import type { ListingPublic } from '../listings/api';
import { FactCell } from '../listings/ListingFacts';
import { LIFESTYLE_KEYS, type LifestyleAnswers } from '../lifestyle/keys';
import { lifestyleTopic } from '../lifestyle/topic';
import { flatmatesText, genderPreferenceLabel } from './flatmates';

/** The answered questionnaire keys as topic / answer rows, in `LIFESTYLE_KEYS` order; nothing when
 * none is answered. The room's answers here, a person's own on `FlatPeople` (0010f). */
export function AnswerList({ answers, testId }: { answers: LifestyleAnswers; testId?: string }) {
  const { t } = useTranslation();
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
  if (answered.length === 0) return null;
  return (
    <dl
      data-testid={testId}
      className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface"
    >
      {answered.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
          <dt className="text-body-sm text-ink-muted">{row.topic}</dt>
          <dd className="text-body-sm font-bold">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A room's "על החדר" on its listing page: who it is for, its flatmates, then one cell per flat fact
 * the lister said (0010f: the room's size, a private bathroom, a balcony, bills, who is posting;
 * none when `null`) and, when the room's side answered any, "אורח החיים בדירה". Renders what the response holds: a visitor or an owner gets no
 * ages and no answers (PRODUCT.md "Rooms", room privacy), so they see neither, with no empty block.
 */
export function RoomFacts({ listing }: { listing: ListingPublic }) {
  const { t } = useTranslation();
  const headingId = useId();

  const rows = [
    {
      label: t('rooms.facts.gender'),
      value: genderPreferenceLabel(t, listing.gender_preference),
      icon: <PersonIcon />,
    },
  ];
  const flatmates = flatmatesText(t, listing);
  if (flatmates !== null) {
    rows.push({ label: t('rooms.facts.flatmates'), value: flatmates, icon: <FlatmatesIcon /> });
  }
  const has = (value: boolean) => t(value ? 'rooms.facts.values.yes' : 'rooms.facts.values.no');
  if (listing.room_size_sqm !== null) {
    rows.push({
      label: t('rooms.facts.roomSize'),
      value: t('rooms.facts.values.sqm', { size: listing.room_size_sqm }),
      icon: <FurnishedIcon />,
    });
  }
  if (listing.private_bathroom !== null) {
    rows.push({
      label: t('rooms.facts.privateBathroom'),
      value: has(listing.private_bathroom),
      icon: <ElevatorIcon />,
    });
  }
  if (listing.balcony !== null) {
    rows.push({
      label: t('rooms.facts.balcony'),
      value: has(listing.balcony),
      icon: <ArnonaIcon />,
    });
  }
  if (listing.bills_included !== null) {
    rows.push({
      label: t('rooms.facts.bills'),
      value: t(
        listing.bills_included
          ? 'rooms.facts.values.billsIncluded'
          : 'rooms.facts.values.billsNotIncluded',
      ),
      icon: <VaadIcon />,
    });
  }
  if (listing.poster !== null) {
    rows.push({
      label: t('rooms.facts.poster'),
      // `i18n-check` does not see this dynamic key; `__tests__/poster.test.ts` covers it.
      value: t(`rooms.facts.values.poster.${listing.poster}`),
      icon: <PersonIcon />,
    });
  }

  const answered = LIFESTYLE_KEYS.some((key) => listing.lifestyle[key] !== undefined);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <h2 id={headingId} className="text-h3 font-semibold">
        {t('rooms.facts.title')}
      </h2>
      <dl data-testid="room-facts" className="grid grid-cols-3 gap-2.5">
        {rows.map((row) => (
          <FactCell key={row.label} icon={row.icon} label={row.label} value={row.value} />
        ))}
      </dl>
      {answered && (
        <>
          <h3 className="pt-1 text-body font-medium">{t('lifestyle.title.flat')}</h3>
          <AnswerList answers={listing.lifestyle} testId="room-lifestyle" />
        </>
      )}
    </section>
  );
}
