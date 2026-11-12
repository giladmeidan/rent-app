import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './Button';
import { focusMainIfLost } from './focus';

/**
 * A failed load with a retry. `page`: the error is the whole page (it replaces a page that has no
 * other `<h1>`), so the message is the page's `<h1>`. The retry is the kit's primary button (ink,
 * with the accent focus ring).
 *
 * When a successful retry unmounts the box while its button had focus, focus goes to `#main`
 * instead of `<body>` (spec 0009t); a box that unmounts while focus is elsewhere leaves it there.
 */
export function ErrorState({ onRetry, page = false }: { onRetry: () => void; page?: boolean }) {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Set on focus, cleared on blur: the rescue still runs when the browser drops focus from the
  // removed button without a `blur`.
  const hadFocus = useRef(false);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    return () => {
      if (hadFocus.current || (button !== null && document.activeElement === button)) {
        focusMainIfLost();
      }
    };
  }, []);

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-2xl border border-line bg-white px-4 py-[14px]"
    >
      {page ? <h1>{t('common.error')}</h1> : <p>{t('common.error')}</p>}
      <Button
        ref={buttonRef}
        variant="primary"
        shape="pill"
        onClick={onRetry}
        onFocus={() => {
          hadFocus.current = true;
        }}
        onBlur={() => {
          hadFocus.current = false;
        }}
      >
        {t('common.retry')}
      </Button>
    </div>
  );
}
