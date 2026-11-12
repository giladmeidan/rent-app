import { useTranslation } from 'react-i18next';

import { LIFESTYLE_KEYS } from '../lifestyle/keys';
import { withUnknownAges } from '../rooms/flatmates';
import type { ListingInBody } from './api';
import { useGenderPreferenceLabels } from './RoomFields';

type Props = {
  body: Pick<
    ListingInBody,
    'gender_preference' | 'flatmates_count' | 'flatmate_ages' | 'lifestyle'
  >;
};

/**
 * The wizard preview's room chips (spec 0007e), in `OwnerPreferences`' style: who the room is for
 * (not for "לא משנה"), the flatmates with their ages, and how much of the flat's questionnaire is
 * answered. The wizard's own: the public listing page's room facts are 0007f's.
 */
export function RoomPreview({ body }: Props) {
  const { t } = useTranslation();
  const genders = useGenderPreferenceLabels();

  const chips: string[] = [];
  let showsPrivate = false;
  if (body.gender_preference !== 'any') {
    chips.push(t('listings.roomPreview.for', { who: genders[body.gender_preference] }));
  }
  const count = body.flatmates_count;
  if (count !== null) {
    // A copy: `body` is the caller's.
    const known = [...body.flatmate_ages].sort((a, b) => a - b);
    if (known.length > 0) showsPrivate = true;
    // A missing age shows as "?" after the known ones (spec 0009b).
    const ages = withUnknownAges(t, known, count);
    chips.push(
      ages.length === 0
        ? t('listings.roomPreview.flatmates', { count })
        : t('listings.roomPreview.flatmatesAges', { count, ages: ages.join(', ') }),
    );
  }
  const answered = LIFESTYLE_KEYS.filter((key) => body.lifestyle[key] !== undefined).length;
  if (answered > 0) {
    showsPrivate = true;
    chips.push(
      t('listings.roomPreview.lifestyle', { count: answered, total: LIFESTYLE_KEYS.length }),
    );
  }
  if (chips.length === 0) return null;

  return (
    <>
      <ul
        aria-label={t('listings.room.title')}
        className="flex flex-wrap gap-2 rounded-2xl border border-border bg-surface px-4 py-[14px]"
      >
        {chips.map((chip) => (
          <li
            key={chip}
            className="rounded-full border border-border bg-surface-subtle px-3 py-[6px] text-[13px] font-semibold"
          >
            {chip}
          </li>
        ))}
      </ul>
      {showsPrivate && <p className="text-sm text-ink-muted">{t('listings.room.privacyNote')}</p>}
    </>
  );
}
