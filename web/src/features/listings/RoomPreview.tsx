import { useTranslation } from 'react-i18next';

import { Card } from '../../components/Card';
import { Tag } from '../../components/Tag';
import { LIFESTYLE_KEYS } from '../lifestyle/keys';
import { withUnknownAges } from '../rooms/flatmates';
import type { ListingInBody, RoomFactKey } from './api';
import { useGenderPreferenceLabels } from './RoomFields';

type Props = {
  body: Pick<
    ListingInBody,
    'gender_preference' | 'flatmates_count' | 'flatmate_ages' | 'lifestyle' | RoomFactKey
  >;
};

/**
 * The wizard preview's room chips (spec 0007e), in `OwnerPreferences`' style: who the room is for
 * (not for "לא משנה"), the flatmates with their ages, how much of the flat's questionnaire is
 * answered, and one chip per flat fact that was said (0010f; a private bathroom and a balcony only
 * when there is one, bills either way). The wizard's own: the public listing page's room facts are 0007f's.
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
  if (body.room_size_sqm !== null && body.room_size_sqm !== undefined) {
    chips.push(t('listings.roomPreview.roomSize', { size: body.room_size_sqm }));
  }
  if (body.private_bathroom === true) chips.push(t('listings.roomPreview.privateBathroom'));
  if (body.balcony === true) chips.push(t('listings.roomPreview.balcony'));
  if (body.bills_included === true) chips.push(t('listings.roomPreview.bills.included'));
  if (body.bills_included === false) chips.push(t('listings.roomPreview.bills.notIncluded'));
  if (body.poster !== null && body.poster !== undefined) {
    // `i18n-check` does not see this dynamic key; `rooms/__tests__/poster.test.ts` covers it.
    chips.push(t(`listings.room.poster.${body.poster}`));
  }
  if (chips.length === 0) return null;

  return (
    <>
      <Card padding="md">
        <ul aria-label={t('listings.room.title')} className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <Tag key={chip} tone="neutral" as="li">
              {chip}
            </Tag>
          ))}
        </ul>
      </Card>
      {showsPrivate && (
        <p className="text-body-sm text-ink-muted">{t('listings.room.privacyNote')}</p>
      )}
    </>
  );
}
