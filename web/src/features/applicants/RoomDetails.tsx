import { useTranslation } from 'react-i18next';

import { compareLifestyle, LIFESTYLE_KEYS, type LifestyleAnswers } from '../lifestyle/keys';
import { DifferIcon } from '../match/icons';
import type { ApplicantRoom } from './api';

type Props = {
  room: ApplicantRoom;
  /** The listing's own answers (`MyListingOut.lifestyle`); `{}` when it has none. */
  flat: LifestyleAnswers;
  /** Whether the listing is a room now (it may have become an apartment since the application). */
  flatIsRoom: boolean;
};

/** The "עוד פרטים" panel of a room applicant (0007c): their questionnaire answers next to the
 * flat's, the differing ones marked in words. Later details join here. */
export function RoomDetails({ room, flat, flatIsRoom }: Props) {
  const { t } = useTranslation();
  const theirs: LifestyleAnswers = room.lifestyle;
  const answered = LIFESTYLE_KEYS.filter((key) => theirs[key] !== undefined);
  if (answered.length === 0) {
    return <p className="text-start text-sm text-[#44403C]">{t('applicants.room.noAnswers')}</p>;
  }
  const { shared, same, differing } = compareLifestyle(theirs, flat);
  const flatAnswered = LIFESTYLE_KEYS.some((key) => flat[key] !== undefined);
  return (
    <div className="flex flex-col gap-2">
      {!flatAnswered && flatIsRoom && (
        <p className="text-start text-sm text-muted">{t('applicants.room.noFlatAnswers')}</p>
      )}
      {shared > 0 && (
        <p className="text-start text-sm font-semibold">
          {t('applicants.room.summary', { same, shared })}
        </p>
      )}
      <ul className="flex flex-col gap-[10px]">
        {answered.map((key) => {
          const flatAnswer = flat[key];
          return (
            <li
              key={key}
              className="flex min-w-0 flex-col gap-[2px] rounded-xl bg-[#F5F5F4] px-3 py-[10px] text-start text-sm"
            >
              <span className="font-bold">{t(`lifestyle.${key}.topic`)}</span>
              <span className="[overflow-wrap:anywhere]">
                {t('applicants.room.theirs', {
                  answer: t(`lifestyle.${key}.answer.${String(theirs[key])}`),
                })}
              </span>
              {flatAnswer !== undefined && (
                <span className="[overflow-wrap:anywhere]">
                  {t('applicants.room.flat', {
                    answer: t(`lifestyle.${key}.answer.${String(flatAnswer)}`),
                  })}
                </span>
              )}
              {differing.includes(key) && (
                <span className="flex flex-wrap items-center gap-2 font-semibold text-warn-text">
                  <DifferIcon />
                  {t('applicants.room.differs')}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
