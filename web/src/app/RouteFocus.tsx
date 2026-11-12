import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/**
 * After an in-app navigation (PUSH or REPLACE) to a new path: scroll to the top and focus
 * `<main id="main">`, so a screen reader starts at the new page. Never on the first render, on POP
 * (Back / Forward keep the browser's scroll restoration) or when only the search or hash changed.
 * A REPLACE redirect right after load (a guard sending to `/login`, `*` sending to `/`) does count,
 * on purpose: the page shown is not the one loaded.
 *
 * A layout effect runs before the new page's passive effects, so a page that focuses or scrolls
 * something itself on mount (the profile's `?section=room` heading, a chat thread's latest message)
 * still wins.
 */
export function RouteFocus() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const previous = useRef(pathname);

  useLayoutEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (navigationType !== 'PUSH' && navigationType !== 'REPLACE') return;
    window.scrollTo(0, 0);
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname, navigationType]);

  return null;
}
