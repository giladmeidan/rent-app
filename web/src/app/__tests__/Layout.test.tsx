import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../i18n';
import he from '../../locales/he.json';
import { application } from '../../features/applications/__tests__/fixtures';
import { MY_APPLICATIONS_KEY } from '../../features/applications/useMyApplications';
import {
  currentPath,
  deferred,
  json,
  mockApi,
  renderRoutes,
  testQueryClient,
} from '../../features/auth/__tests__/harness';
import { ME_KEY } from '../../features/auth/useMe';
import { conversation, message, thread } from '../../features/chat/__tests__/fixtures';
import { threadKey } from '../../features/chat/useThread';
import { gushDan, owner, seeker } from '../../features/listings/__tests__/fixtures';
import { profile } from '../../features/profile/__tests__/fixtures';
import { PROFILE_KEY } from '../../features/profile/useProfile';
import { page } from '../../features/search/__tests__/fixtures';
import { AppRoutes } from '../routes';

// jsdom has no WebGL: the map view renders the stand-in.
vi.mock(
  '../../components/map/MapCanvas',
  () => import('../../components/map/__tests__/fakeMapCanvas'),
);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const classesOf = (el: Element | null | undefined) =>
  (el?.getAttribute('class') ?? '').split(/\s+/);
const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
const main = () => document.getElementById('main');
const unauthenticated = () => json({ detail: 'unauthenticated' }, 401);

/** The router's `navigate`, captured from inside the tree (for POP and plain PUSHes). */
const router: { navigate: NavigateFunction } = { navigate: () => undefined };
function NavigateProbe() {
  const navigate = useNavigate();
  useEffect(() => {
    router.navigate = navigate;
  }, [navigate]);
  return null;
}

describe('Layout', () => {
  it('ac1_skip_link_focuses_main', async () => {
    mockApi({
      'GET /me': [unauthenticated],
      'GET /listings': [() => json(page([]))],
      'GET /areas': [() => json([gushDan])],
    });
    renderRoutes('/search', <AppRoutes />);
    await screen.findByRole('heading', { level: 1, name: he.search.title });

    // The first focusable element in document order is the skip link.
    const first = document.querySelector(FOCUSABLE);
    const skip = screen.getByRole('link', { name: he.a11y.skipToMain });
    expect(first).toBe(skip);
    expect(skip).toHaveAttribute('href', '#main');

    // <main> takes focus programmatically only.
    const target = main();
    expect(target?.tagName).toBe('MAIN');
    expect(target).toHaveAttribute('tabindex', '-1');

    // A click focuses <main> and leaves the URL without a hash.
    fireEvent.click(skip);
    expect(document.activeElement).toBe(target);
    expect(window.location.hash).toBe('');
    expect(currentPath()).toBe('/search');
  });

  it('ac2_route_change_focus_and_scroll', async () => {
    const room = thread({ messages: [message()] });
    const client = testQueryClient();
    client.setQueryData(ME_KEY, seeker);
    client.setQueryData(MY_APPLICATIONS_KEY, [application()]);
    client.setQueryData(PROFILE_KEY, profile());
    client.setQueryData(['areas'], [gushDan]);
    client.setQueryData(threadKey(room.id), room);
    mockApi({
      'GET /me': [() => json(seeker)],
      'GET /listings': [() => json(page([]))],
      'GET /listings/map': [() => json({ items: [], truncated: false })],
      'GET /areas': [() => json([gushDan])],
      'GET /me/applications': [() => json([application()])],
      'GET /me/profile': [() => json(profile())],
      'GET /me/conversations': [() => json([])],
      'GET /me/likes': [() => json({ liked_me: [], mine: [] })],
      'GET /me/flats': [() => json([])],
      [`GET /conversations/${room.id}`]: [() => json(room)],
    });
    const scrollTo = vi.spyOn(window, 'scrollTo');
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView');
    renderRoutes(
      '/search',
      <>
        <AppRoutes />
        <NavigateProbe />
      </>,
      client,
    );
    await screen.findByRole('heading', { level: 1, name: he.search.title });
    // The first render moves nothing.
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);

    // PUSH by a link click: scrolled to the top, focus on <main>.
    fireEvent.click(screen.getByRole('link', { name: he.nav.applications }));
    await screen.findByRole('heading', { level: 1, name: he.applications.mine.title });
    expect(currentPath()).toBe('/me/applications');
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    expect(document.activeElement).toBe(main());

    // POP (Back): the browser's own scroll restoration; focus stays where it is.
    const button = screen.getAllByRole('link')[0] as HTMLElement;
    button.focus();
    scrollTo.mockClear();
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByRole('heading', { level: 1, name: he.search.title });
    expect(currentPath()).toBe('/search');
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(main());

    // Only the search changes (?view=map): neither.
    const toMap = screen.getByRole('button', { name: he.search.view.map });
    toMap.focus();
    fireEvent.click(toMap);
    await waitFor(() => {
      expect(currentPath()).toBe('/search?view=map');
    });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(main());

    // PUSH to the profile's room section with the profile cached: the page's own focus wins.
    await act(async () => {
      await router.navigate('/me/profile?section=room');
    });
    const roomHeading = await screen.findByRole('heading', {
      level: 2,
      name: he.profile.room.title,
    });
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    await waitFor(() => {
      expect(document.activeElement).toBe(roomHeading);
    });

    // PUSH to a cached chat thread: the top first, then the page's scroll to the latest message.
    scrollTo.mockClear();
    scrollIntoView.mockClear();
    await act(async () => {
      await router.navigate(`/chat/${room.id}`);
    });
    await screen.findByRole('heading', { level: 1, name: room.other_name });
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    const scrolledTop = scrollTo.mock.invocationCallOrder[0] ?? Infinity;
    const scrolledToLatest = scrollIntoView.mock.invocationCallOrder[0] ?? -Infinity;
    expect(scrolledTop).toBeLessThan(scrolledToLatest);
  });

  it('ac3_full_width_shell', async () => {
    mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)], 'GET /areas': [json([])] });
    const view = renderRoutes('/login', <AppRoutes />);
    await screen.findByRole('heading', { level: 1, name: he.auth.login.title });

    // The header spans the page; its one child is the wide container holding the header row.
    const header = document.querySelector('header');
    expect(header).not.toBeNull();
    const inner = header?.children ?? [];
    expect(inner).toHaveLength(1);
    expect(classesOf(inner[0])).toContain('max-w-wide');
    expect(inner[0]?.querySelector('a[href="/"]')).not.toBeNull();

    // <main> spans the page too: no width or padding of its own; its child is the page's container.
    const main = document.querySelector('main');
    expect(main).not.toBeNull();
    for (const c of classesOf(main)) {
      expect(c).not.toMatch(/^(max-w-|px-|ps-|pe-)/);
    }
    expect(main?.children).toHaveLength(1);
    const page = main?.firstElementChild;
    expect(classesOf(page)).toContain('max-w-narrow');
    expect(page?.contains(screen.getByRole('heading', { level: 1 }))).toBe(true);

    expect(document.querySelector('.max-w-\\[640px\\]')).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A protected route while /me is pending: the guard's skeleton sits in the default column.
    const me = deferred();
    mockApi({ 'GET /me': [me.promise] });
    renderRoutes('/me/listings', <AppRoutes />);
    const skeleton = await vi.waitFor(() => {
      const el = document.querySelector('main [data-testid="skeleton"]');
      expect(el).not.toBeNull();
      return el as Element;
    });
    const column = skeleton.closest('.max-w-page');
    expect(column).not.toBeNull();
    expect(column?.parentElement?.tagName).toBe('MAIN');
  });

  it('ac6_anonymous_header', async () => {
    const nav = () =>
      within(screen.getByRole('banner')).getByRole('navigation', { name: he.nav.label });
    const linksOf = (el: HTMLElement) =>
      within(el)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]);
    const noSignupOrTagline = () => {
      const banner = screen.getByRole('banner');
      expect(within(banner).queryByRole('link', { name: he.header.signup })).toBeNull();
      expect(within(banner).queryByText(he.header.signup)).toBeNull();
      expect(banner.textContent).not.toContain(he.app.tagline);
    };

    // On `/`: the brand link (named by the lockup's app.title) and, in the nav, "כניסה" only.
    mockApi({ 'GET /me': [unauthenticated] });
    let view = renderRoutes('/', <AppRoutes />);
    await screen.findByRole('heading', { level: 1 });
    const banner = screen.getByRole('banner');
    const brand = within(banner).getByRole('link', { name: he.app.title });
    expect(brand).toHaveAttribute('href', '/');
    expect(linksOf(nav())).toEqual([[he.header.login, '/login']]);
    expect(within(banner).getAllByRole('navigation')).toHaveLength(1);
    noSignupOrTagline();
    view.unmount();
    vi.unstubAllGlobals();

    // On /search: "חיפוש דירות", then "כניסה".
    mockApi({ 'GET /me': [unauthenticated], 'GET /listings': [() => json(page([]))] });
    view = renderRoutes('/search', <AppRoutes />);
    await screen.findByRole('heading', { level: 1, name: he.search.title });
    await within(screen.getByRole('banner')).findByRole('navigation', { name: he.nav.label });
    expect(linksOf(nav())).toEqual([
      [he.header.search, '/search'],
      [he.header.login, '/login'],
    ]);
    noSignupOrTagline();
    view.unmount();
    vi.unstubAllGlobals();

    // While /me is pending: the brand and the skeleton; no "חיפוש דירות" and no nav yet.
    const me = deferred();
    mockApi({ 'GET /me': [me.promise], 'GET /listings': [() => json(page([]))] });
    renderRoutes('/search', <AppRoutes />);
    const pending = screen.getByRole('banner');
    expect(within(pending).getByRole('link', { name: he.app.title })).toHaveAttribute('href', '/');
    expect(within(pending).getByTestId('skeleton')).toBeInTheDocument();
    expect(within(pending).queryByRole('link', { name: he.header.search })).toBeNull();
    expect(within(pending).queryByRole('navigation')).toBeNull();
    noSignupOrTagline();
  });

  it('ac7_signed_in_nav', async () => {
    const tabs = async () => {
      const nav = await within(screen.getByRole('banner')).findByRole('navigation', {
        name: he.nav.label,
      });
      return {
        nav,
        links: within(nav)
          .getAllByRole('link')
          .map((a) => [a.textContent, a.getAttribute('href')]),
      };
    };
    const signedIn = (me: typeof owner, extra: Record<string, (() => Response)[]> = {}) =>
      mockApi({
        'GET /me': [() => json(me)],
        'GET /me/conversations': [() => json([])],
        'GET /me/likes': [() => json({ liked_me: [], mine: [] })],
        'GET /listings': [() => json(page([]))],
        ...extra,
      });

    // A seeker: one nav, five tabs in order; logout sits outside it.
    signedIn(seeker);
    let view = renderRoutes('/search', <AppRoutes />);
    let { nav, links } = await tabs();
    expect(links).toEqual([
      [he.nav.search, '/search'],
      [he.header.likes, '/me/likes'],
      [he.nav.applications, '/me/applications'],
      [he.header.chat, '/chat'],
      [he.nav.profile, '/me/profile'],
    ]);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);
    expect(nav).toHaveAttribute('data-bottom-nav');
    const logout = screen.getByRole('button', { name: he.header.logout });
    expect(nav.contains(logout)).toBe(false);
    expect(within(screen.getByRole('banner')).getByRole('button', { name: he.header.logout })).toBe(
      logout,
    );
    // DOM order: brand, nav, then the greeting and logout.
    const brand = within(screen.getByRole('banner')).getByRole('link', { name: he.app.title });
    expect(brand.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    view.unmount();
    vi.unstubAllGlobals();

    // An owner with two new chats: "המודעות שלי", "צ'אט" (named with the count), "חיפוש".
    signedIn(owner, {
      'GET /me/conversations': [
        () => json([conversation({ unread_count: 2 }), conversation({ is_new: true })]),
      ],
    });
    view = renderRoutes('/search', <AppRoutes />);
    ({ nav, links } = await tabs());
    expect(links.map(([, href]) => href)).toEqual(['/me/listings', '/chat', '/search']);
    expect(within(nav).getByRole('link', { name: he.header.myListings })).toBeVisible();
    const chat = await within(nav).findByRole('link', {
      name: `${he.header.chat} ${i18n.t('header.chatNew', { count: 2 })}`,
    });
    expect(chat).toHaveAccessibleName(
      `${he.header.chat} ${i18n.t('header.chatNew', { count: 2 })}`,
    );
    expect(within(nav).getByRole('link', { name: he.nav.search })).toHaveAttribute(
      'aria-current',
      'page',
    );
    view.unmount();
    vi.unstubAllGlobals();

    // A nested path keeps "המודעות שלי" current.
    signedIn(owner);
    view = renderRoutes('/me/listings/L/applicants', <AppRoutes />);
    ({ nav } = await tabs());
    expect(within(nav).getByRole('link', { name: he.header.myListings })).toHaveAttribute(
      'aria-current',
      'page',
    );
    view.unmount();
    vi.unstubAllGlobals();

    // Focused routes hide the bar below lg (it stays in the top bar from lg); others keep it.
    for (const [path, hidden] of [
      ['/listings/new', true],
      ['/me/listings/L/edit', true],
      ['/listings/L', true],
      ['/chat/C', true],
      ['/search', false],
      ['/chat', false],
    ] as const) {
      signedIn(owner);
      view = renderRoutes(path, <AppRoutes />);
      ({ nav } = await tabs());
      if (hidden) {
        expect(nav, path).toHaveAttribute('data-hidden-mobile');
        expect(classesOf(nav), path).toContain('max-lg:hidden');
      } else {
        expect(nav, path).not.toHaveAttribute('data-hidden-mobile');
        expect(classesOf(nav), path).not.toContain('max-lg:hidden');
      }
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
