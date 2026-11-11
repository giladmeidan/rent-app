import type { TFunction } from 'i18next';

import type { LifestyleKey } from './keys';

/** "ניקיון", as the questionnaire calls the topic. A literal map, so `i18n-check` sees every key. */
export function lifestyleTopic(key: LifestyleKey, t: TFunction): string {
  return {
    cleanliness: t('lifestyle.cleanliness.topic'),
    guests: t('lifestyle.guests.topic'),
    night: t('lifestyle.night.topic'),
    social: t('lifestyle.social.topic'),
    kosher: t('lifestyle.kosher.topic'),
    shabbat: t('lifestyle.shabbat.topic'),
    work_from_home: t('lifestyle.work_from_home.topic'),
  }[key];
}
