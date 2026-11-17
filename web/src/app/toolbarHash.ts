// posthog-js reads `#__posthog=…` (or `#state=…`) when its module is evaluated and, for a link
// carrying our public key, stores toolbar settings in localStorage. Nothing may be stored (spec
// 0019b), and the option list has no switch for it, so the parameters are removed from the address
// first. Imported by `analytics.ts` before posthog-js; a no-op while PostHog is off.

const TOOLBAR_PARAM = /^(__posthog|state)=/;

export function dropToolbarHash(): void {
  if (!import.meta.env.VITE_POSTHOG_KEY) return;
  const { hash, pathname, search } = window.location;
  const parts = hash.slice(1).split('&');
  const kept = parts.filter((part) => !TOOLBAR_PARAM.test(part));
  if (kept.length === parts.length) return;
  const rest = kept.join('&');
  window.history.replaceState(
    window.history.state,
    '',
    `${pathname}${search}${rest ? `#${rest}` : ''}`,
  );
}

dropToolbarHash();
