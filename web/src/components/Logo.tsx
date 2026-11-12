import { useTranslation } from 'react-i18next';

import lockupEn from '../assets/brand/logos/homie-lockup-en.svg';
import lockupHe from '../assets/brand/logos/homie-lockup-he.svg';
import wordmarkEnWhite from '../assets/brand/logos/homie-wordmark-en-white.svg';
import wordmarkEn from '../assets/brand/logos/homie-wordmark-en.svg';
import wordmarkHeWhite from '../assets/brand/logos/homie-wordmark-he-white.svg';
import wordmarkHe from '../assets/brand/logos/homie-wordmark-he.svg';
import { cx } from './cx';

type LogoLang = 'he' | 'en';

/** There is no white lockup file, so the type forbids that pairing. */
export type LogoProps = (
  { variant?: 'wordmark'; tone?: 'dark' | 'white' } | { variant: 'lockup'; tone?: 'dark' }
) & {
  /** Hebrew is the primary version; `en` only in English contexts. */
  lang?: LogoLang;
  /** Empty `alt`, for a logo inside a link that already names itself. */
  decorative?: boolean;
  /** Layout and the height (e.g. `h-7`); the width is always `auto`. */
  className?: string;
};

const WORDMARK: Record<LogoLang, { dark: string; white: string }> = {
  he: { dark: wordmarkHe, white: wordmarkHeWhite },
  en: { dark: wordmarkEn, white: wordmarkEnWhite },
};
const LOCKUP: Record<LogoLang, string> = { he: lockupHe, en: lockupEn };

/**
 * The homie wordmark or lockup (design/brand/logos), as an `<img>`: never retyped, recoloured or
 * stretched. `dark` on surface / surface-subtle / accent-soft; `white` on ink and accent. Clear
 * space equal to the letter ו around it is the caller's.
 */
export function Logo(props: LogoProps) {
  const { t } = useTranslation();
  const { lang = 'he', decorative = false, className } = props;
  const src = props.variant === 'lockup' ? LOCKUP[lang] : WORDMARK[lang][props.tone ?? 'dark'];
  return (
    <img src={src} alt={decorative ? '' : t('app.title')} className={cx('w-auto', className)} />
  );
}
