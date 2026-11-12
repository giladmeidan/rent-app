import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from './Button';
import { Card } from './Card';
import { focusMainIfLost } from './focus';
import { useOnline } from './useOnline';

/**
 * A failed load with a retry, in a card. `page`: the error is the whole page (it replaces a page
 * that has no other `<h1>`), so the message is the page's `<h1>`. The retry is the kit's primary
 * button as a pill (ink, with the accent focus ring). Offline, the message says so (0009f).
 *
 * When a successful retry unmounts the box while its button had focus, focus goes to `#main`
 * instead of `<body>` (spec 0009t); a box that unmounts while focus is elsewhere leaves it there.
 *
 * An `onRetry` that returns a promise (a query's `refetch()`) makes the button busy until it
 * settles (spec 0009g): `aria-busy` and `aria-disabled`, a click does nothing, and it is never
 * `disabled`, so it keeps focus. A void `onRetry` never turns it busy.
 */
export function ErrorState({ onRetry, page = false }: { onRetry: () => unknown; page?: boolean }) {
  const { t } = useTranslation();
  const online = useOnline();
  const text = online ? t('common.error') : t('common.offline');
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Set on focus, cleared on blur: the rescue still runs when the browser drops focus from the
  // removed button without a `blur`.
  const hadFocus = useRef(false);
  const [busy, setBusy] = useState(false);
  // Same-tick guard: a second click before the busy render calls `onRetry` once.
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function retry() {
    if (pending.current) return;
    const result = onRetry();
    if (!(result instanceof Promise)) return;
    pending.current = true;
    setBusy(true);
    const done = () => {
      pending.current = false;
      if (mounted.current) setBusy(false);
    };
    void result.then(done, done);
  }

  useLayoutEffect(() => {
    const button = buttonRef.current;
    return () => {
      if (hadFocus.current || (button !== null && document.activeElement === button)) {
        focusMainIfLost();
      }
    };
  }, []);

  return (
    <Card role="alert" padding="md" className="flex flex-col items-start gap-3">
      {page ? (
        <h1 className="text-body text-ink">{text}</h1>
      ) : (
        <p className="text-body text-ink">{text}</p>
      )}
      <Button
        ref={buttonRef}
        variant="primary"
        shape="pill"
        busy={busy}
        onClick={retry}
        onFocus={() => {
          hadFocus.current = true;
        }}
        onBlur={() => {
          hadFocus.current = false;
        }}
      >
        {t('common.retry')}
      </Button>
    </Card>
  );
}
