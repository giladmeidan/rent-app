import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cx } from './cx';
import { focusRing } from './focusRing';

/**
 * The first stop of the Tab key: hidden until focused, then a pill at the inline start of the
 * viewport. Enter moves focus to `<main id="main">` by hand, so the URL keeps no `#main` hash and
 * later router navigations are untouched.
 */
export function SkipLink() {
  const { t } = useTranslation();
  function skip(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const main = document.getElementById('main');
    if (main === null) return;
    main.focus({ preventScroll: true });
    main.scrollIntoView();
  }
  return (
    <a
      href="#main"
      onClick={skip}
      className={cx(
        'sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:inline-flex focus:min-h-[44px] focus:items-center focus:rounded-full focus:bg-surface focus:px-4 focus:font-semibold',
        focusRing,
      )}
    >
      {t('a11y.skipToMain')}
    </a>
  );
}
