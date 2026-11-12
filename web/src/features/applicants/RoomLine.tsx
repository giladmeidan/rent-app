import { useTranslation } from 'react-i18next';

import type { ApplicantRoom } from './api';

/** A room applicant's gender and, when given, age (0007c): plain text in the page's direction. */
export function RoomLine({ gender, age }: { gender: ApplicantRoom['gender']; age: number | null }) {
  const { t } = useTranslation();
  const word = t(`profile.room.gender.${gender}`);
  return (
    <p className="text-start text-caption text-ink-muted">
      {age === null ? word : t('applicants.room.line', { gender: word, age })}
    </p>
  );
}
