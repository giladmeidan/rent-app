import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { AppRoutes } from '../../../app/routes';
import he from '../../../locales/he.json';
import { json, mockApi, renderRoutes, testQueryClient } from '../../auth/__tests__/harness';
import { listings } from '../../search/__tests__/fixtures';
import { EXAMPLE_SCORE } from '../example';

afterEach(() => {
  vi.unstubAllGlobals();
});

// The title's line break (whitespace-pre-line) reads as a space.
const TITLE = he.landing.title.replace('\n', ' ');
const byTitle = (name: string) => name.replace(/\s+/g, ' ') === TITLE;

const OWNER_SIGNUP = '/signup?role=owner&next=%2Flistings%2Fnew';
const LATEST = ['landing', 'latest'];

type Reply = Response | Promise<Response>;

/** A logged-out visitor (`/me` 401) on `/`, through the real routes and shell. Without a
 * `GET /listings` reply the harness answers 599, so the listings section stays absent. */
async function visitLanding(listingsReply?: Reply) {
  const api = mockApi({
    'GET /me': [json({ detail: 'unauthenticated' }, 401)],
    ...(listingsReply === undefined ? {} : { 'GET /listings': [listingsReply] }),
  });
  const client = testQueryClient();
  const view = renderRoutes('/', <AppRoutes />, client);
  await screen.findByRole('heading', { level: 1, name: byTitle });
  return { api, view, client };
}

const region = (name: string | ((n: string) => boolean)) => screen.getByRole('region', { name });

describe('LandingPage', () => {
  it('ac1_hero', async () => {
    document.title = 'stale';
    await visitLanding();
    const hero = within(region(byTitle));

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(hero.getByRole('heading', { level: 1 })).toBe(h1s[0]);
    expect(h1s[0]).toHaveClass('font-display', 'text-h1', 'lg:text-display', 'whitespace-pre-line');
    expect(hero.getByText(he.landing.badge)).toBeVisible();
    expect(hero.getByText(he.landing.subtitle)).toBeVisible();
    expect(document.title).toBe(he.app.title);

    // The two CTAs and the market link: same destinations, variants and chevrons as before.
    const owner = hero.getByRole('link', { name: he.landing.cta.owner });
    const seeker = hero.getByRole('link', { name: he.landing.cta.seeker });
    const market = hero.getByRole('link', { name: he.landing.cta.market });
    expect(owner).toHaveAttribute('href', OWNER_SIGNUP);
    expect(seeker).toHaveAttribute('href', '/search');
    expect(market).toHaveAttribute('href', '/market');
    expect(owner).toHaveClass('bg-ink', 'text-on-ink', 'justify-between', 'min-h-13');
    expect(seeker).toHaveClass('border-border-strong', 'bg-surface', 'justify-between');
    expect(market).toHaveClass('text-accent', 'w-full', 'lg:w-auto');
    for (const cta of [owner, seeker]) {
      expect(cta.lastElementChild).toHaveAttribute('aria-hidden', 'true');
      expect(cta.compareDocumentPosition(market) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    // The three trust claims, a list inside the hero (the strip at the page's end is gone).
    const trust = hero.getByText(he.landing.trust.verified).closest('ul') as HTMLElement;
    const claims = within(trust).getAllByRole('listitem');
    expect(claims.map((li) => li.textContent)).toEqual([
      he.landing.trust.verified,
      he.landing.trust.noBrokers,
      he.landing.trust.free,
    ]);
    expect(screen.getAllByText(he.landing.trust.verified)).toHaveLength(1);

    // The page's one turtle, decorative, in the hero.
    const mascots = document.querySelectorAll('main img[src*="homie-turtle"]');
    expect(mascots).toHaveLength(1);
    expect(mascots[0]).toHaveAttribute('alt', '');
    expect(mascots[0]?.getAttribute('src')).toMatch(/homie-turtle-hello/);
    expect(region(byTitle).contains(mascots[0] as Node)).toBe(true);
  });

  it('ac2_example_and_why', async () => {
    await visitLanding();
    const figure = screen.getByRole('figure');
    const card = within(figure);

    // The caption tells a screen reader the card is an example.
    expect(card.getByText(he.landing.example.caption).tagName).toBe('FIGCAPTION');
    expect(i18n.t('match.badge', { score: EXAMPLE_SCORE })).toBe('התאמה 91%');
    expect(card.getByText('התאמה 91%')).toBeVisible();
    const text = figure.textContent ?? '';
    for (const fact of ['7,200', he.landing.example.street, he.landing.example.city]) {
      expect(text).toContain(fact);
    }

    // Why it matches: a list named by its caption, three lines.
    const whyTitle = i18n.t('landing.example.why.title', { score: EXAMPLE_SCORE });
    expect(whyTitle).toBe('לדוגמה: למה 91%');
    const why = card.getByRole('list', { name: whyTitle });
    const lines = within(why).getAllByRole('listitem');
    expect(lines.map((li) => li.textContent)).toEqual([
      he.landing.example.why.fits1,
      he.landing.example.why.fits2,
      he.landing.example.why.partial,
    ]);
    // Two fit (success check), one differs (muted dash).
    expect(lines[0]?.firstElementChild).toHaveClass('text-success');
    expect(lines[1]?.firstElementChild).toHaveClass('text-success');
    expect(lines[2]?.firstElementChild).toHaveClass('text-ink-muted');

    // Not a link, and no heading in the page outline.
    expect(card.queryByRole('link')).toBeNull();
    expect(card.queryByRole('heading')).toBeNull();
  });

  const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it('ac3_doors', async () => {
    await visitLanding();
    const doors = region(he.landing.doors.title);
    expect(
      within(doors).getByRole('heading', { level: 2, name: he.landing.doors.title }),
    ).toHaveClass('font-display', 'text-h2');

    const links = within(doors).getAllByRole('link');
    const copy = he.landing.doors;
    expect(links).toHaveLength(4);
    const expected = [
      { title: copy.map.title, text: copy.map.text, href: '/search?view=map', more: copy.map.more },
      {
        title: copy.match.title,
        text: copy.match.text,
        href: '/signup?role=seeker&next=%2Fme%2Fprofile',
        more: copy.match.more,
      },
      { title: copy.market.title, text: copy.market.text, href: '/market', more: copy.market.more },
      { title: copy.owner.title, text: copy.owner.text, href: OWNER_SIGNUP, more: copy.owner.more },
    ];
    expected.forEach((door, i) => {
      const link = links[i] as HTMLElement;
      // Label in Name (WCAG 2.5.3): the name is the visible text, title first.
      const byTitle = (name: string) => name.startsWith(door.title);
      expect(within(doors).getByRole('link', { name: byTitle })).toBe(link);
      expect(link).toHaveAccessibleName(
        expect.stringMatching(new RegExp(`^${escapeRe(door.title)}`)),
      );
      expect(link).toHaveAccessibleName(expect.stringContaining(door.text));
      expect(link).toHaveAccessibleName(expect.stringContaining(door.more));
      expect(link).toHaveAttribute('href', door.href);
      expect(within(link).getByRole('heading', { level: 3, name: door.title })).toBeVisible();
      expect(within(link).getByText(door.more)).toBeVisible();
      // One decorative mini-illustration per door.
      expect(link.querySelectorAll('[aria-hidden="true"] > *').length).toBeGreaterThan(0);
    });
    // The owner door's name ends in its "more" label, "פרסום דירה", but is not that name alone.
    expect(within(doors).queryByRole('link', { name: he.landing.cta.owner })).toBeNull();

    // The illustrations' words and numbers are hidden from assistive technology.
    const hidden = (text: string) =>
      within(doors)
        .getAllByText(text)
        .every((node) => node.closest('[aria-hidden="true"]') !== null);
    expect(hidden('7,200 ₪')).toBe(true);
    expect(hidden('91%')).toBe(true);
    expect(hidden(copy.match.caption)).toBe(true);
    expect(hidden(copy.market.badge)).toBe(true);
    expect(hidden(copy.owner.row1.name)).toBe(true);
    expect(hidden('94%')).toBe(true);
    // No image is loaded for them.
    expect(doors.querySelector('img')).toBeNull();
  });

  it('ac4_latest_listings', async () => {
    const items = listings(3);
    const { api } = await visitLanding(json({ items, total: 3, sort: 'newest' }));

    const heading = await screen.findByRole('heading', {
      level: 2,
      name: he.landing.latest.title,
    });
    const latest = region(he.landing.latest.title);
    expect(latest.contains(heading)).toBe(true);
    const cards = within(latest).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    cards.forEach((card, i) => {
      const listing = items[i];
      const link = within(card).getByRole('link');
      expect(link).toHaveAttribute('href', `/listings/${listing?.id ?? ''}`);
      expect(link.closest('h3')).not.toBeNull();
      // A visitor's card: no score, no chips.
      expect(within(card).queryByTestId('match-badge')).toBeNull();
      expect(within(card).queryByTestId('listing-chips')).toBeNull();
    });
    expect(within(latest).getByRole('link', { name: he.landing.latest.all })).toHaveAttribute(
      'href',
      '/search',
    );

    // One request, the newest three apartments; nothing else besides `/me`.
    const requests = api.calls('GET /listings');
    expect(requests).toHaveLength(1);
    const params = new URL(requests[0]?.request.url ?? '').searchParams;
    expect(params.get('listing_type')).toBe('apartment');
    expect(params.get('sort')).toBe('newest');
    expect(params.get('limit')).toBe('3');
    expect(params.get('offset')).toBe('0');
    expect(api.fetchMock.mock.calls.length).toBe(api.calls('GET /me').length + 1);
  });

  it('ac5_latest_absent', async () => {
    const cases: { label: string; reply: Reply; status: 'pending' | 'error' | 'success' }[] = [
      { label: 'pending', reply: new Promise<Response>(() => undefined), status: 'pending' },
      { label: 'fails', reply: json({}, 500), status: 'error' },
      {
        label: 'fewer',
        reply: json({ items: listings(2), total: 2, sort: 'newest' }),
        status: 'success',
      },
    ];
    for (const { label, reply, status } of cases) {
      const { api, view, client } = await visitLanding(reply);
      await waitFor(() => expect(api.calls('GET /listings')).toHaveLength(1));
      await waitFor(() => expect(client.getQueryState(LATEST)?.status).toBe(status));

      expect(screen.queryByRole('heading', { name: he.landing.latest.title }), label).toBeNull();
      expect(screen.queryByText(he.landing.latest.subtitle), label).toBeNull();
      // alert / skeleton / aria-busy guard against a future loading or error UI; the query-state
      // check and the missing heading carry the test.
      expect(screen.queryByRole('alert'), label).toBeNull();
      expect(screen.queryByTestId('skeleton'), label).toBeNull();
      expect(document.querySelector('main [aria-busy="true"]'), label).toBeNull();
      // Every other section is there.
      for (const name of [
        he.landing.doors.title,
        he.landing.how.title,
        he.landing.faq.title,
        he.landing.closing.title,
      ]) {
        expect(region(name), `${label}: ${name}`).toBeVisible();
      }
      expect(region(byTitle)).toBeVisible();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac6_how_both_sides', async () => {
    await visitLanding();
    const how = within(region(he.landing.how.title));
    const copy = he.landing.how;

    const sides = [
      {
        label: copy.seeker,
        steps: [copy.step1, copy.step2, copy.step3],
        cta: he.landing.cta.seeker,
        href: '/search',
      },
      {
        label: copy.owner.label,
        steps: [copy.owner.step1, copy.owner.step2, copy.owner.step3],
        cta: he.landing.cta.owner,
        href: OWNER_SIGNUP,
      },
    ];
    for (const side of sides) {
      const list = how.getByRole('list', { name: side.label });
      expect(list.tagName).toBe('OL');
      // The label is a tag, not a heading.
      expect(how.queryByRole('heading', { name: side.label })).toBeNull();
      const items = within(list).getAllByRole('listitem');
      expect(items).toHaveLength(3);
      side.steps.forEach((step, i) => {
        const item = within(items[i] as HTMLElement);
        expect(item.getByRole('heading', { level: 3, name: step.title })).toBeVisible();
        expect(item.getByText(step.text)).toBeVisible();
      });
      // The side's CTA follows its list.
      const cta = list.nextElementSibling as HTMLElement;
      expect(cta).toHaveRole('link');
      expect(cta).toHaveAccessibleName(side.cta);
      expect(cta).toHaveAttribute('href', side.href);
    }
    // Owner step 3: chat opens on shortlist, never on an "approval".
    expect(copy.owner.step3.text).toContain('לרשימה הקצרה');
    expect(document.body.textContent).not.toContain('מאשרים');
  });

  it('ac7_faq', async () => {
    await visitLanding();
    const faq = region(he.landing.faq.title);
    const copy = he.landing.faq;
    const questions = [copy.q1, copy.q2, copy.q3, copy.q4, copy.q5];

    const details = [...faq.querySelectorAll('details')];
    expect(details).toHaveLength(5);
    details.forEach((item, i) => {
      const summary = item.querySelector('summary');
      expect(summary).not.toBeNull();
      expect(summary?.textContent).toBe(questions[i]?.q);
      expect(item.textContent).toContain(questions[i]?.a);
      expect(item.open).toBe(i === 0);
    });
    // Answer 4: flatmates are not promised to a visitor.
    expect(copy.q4.a).not.toContain('רואים מי גר');
  });

  it('ac8_closing_no_footer', async () => {
    await visitLanding();
    const band = region(he.landing.closing.title);
    const closing = within(band);

    expect(closing.getByRole('heading', { level: 2, name: he.landing.closing.title })).toHaveClass(
      'font-display',
    );
    expect(closing.getByText(he.landing.closing.text)).toHaveClass('text-on-ink');
    const links = closing.getAllByRole('link');
    expect(links).toHaveLength(2);
    const [seeker, owner] = links as [HTMLElement, HTMLElement];
    // The seeker CTA first: `secondary`; the owner CTA: `inverse` (an outline on ink).
    expect(seeker).toHaveAccessibleName(he.landing.cta.seeker);
    expect(seeker).toHaveAttribute('href', '/search');
    expect(seeker).toHaveClass('border-border-strong', 'bg-surface', 'text-ink');
    expect(owner).toHaveAccessibleName(he.landing.cta.owner);
    expect(owner).toHaveAttribute('href', OWNER_SIGNUP);
    expect(owner).toHaveClass('border-on-ink', 'bg-transparent', 'text-on-ink');
    expect(owner).not.toHaveClass('bg-ink');
    // No turtle on ink.
    expect(band.querySelector('img')).toBeNull();

    // The band ends the page: no footer, no footer links.
    expect(document.querySelector('footer')).toBeNull();
    for (const name of ['תנאי שימוש', 'פרטיות', 'צור קשר']) {
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
  });

  it('ac9_headings', async () => {
    await visitLanding(json({ items: listings(3), total: 3, sort: 'newest' }));
    await screen.findByRole('heading', { level: 2, name: he.landing.latest.title });

    const main = screen.getByRole('main');
    const levels = [...main.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) =>
      Number(h.tagName.slice(1)),
    );
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level).toBeLessThanOrEqual((levels[i - 1] ?? 1) + 1);
    });
    // Six sections, each a region named by its heading.
    expect(within(main).getAllByRole('region')).toHaveLength(6);
    expect(
      within(main)
        .getAllByRole('heading', { level: 2 })
        .map((h) => h.textContent),
    ).toEqual([
      he.landing.doors.title,
      he.landing.latest.title,
      he.landing.how.title,
      he.landing.faq.title,
      he.landing.closing.title,
    ]);
  });
});
