import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { AppRoutes } from '../../../app/routes';
import he from '../../../locales/he.json';
import { json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { addDays, formatDate, todayInIsrael } from '../../listings/format';
import { EXAMPLE_SCORE } from '../example';

afterEach(() => {
  vi.unstubAllGlobals();
});

// The title's line break (whitespace-pre-line) reads as a space.
const TITLE = he.landing.title.replace('\n', ' ');
const byTitle = (name: string) => name.replace(/\s+/g, ' ') === TITLE;

/** A logged-out visitor (`/me` 401) on `/`, through the real routes and shell. */
async function visitLanding() {
  const api = mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
  const view = renderRoutes('/', <AppRoutes />);
  await screen.findByRole('heading', { level: 1, name: byTitle });
  return { api, view };
}

describe('LandingPage', () => {
  it('ac1_hero', async () => {
    document.title = 'stale';
    await visitLanding();

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveClass('font-display', 'text-h1', 'lg:text-display', 'whitespace-pre-line');
    expect(screen.getByText(he.landing.badge)).toBeVisible();
    expect(screen.getByText(he.landing.subtitle)).toBeVisible();
    // The old areas list is gone.
    expect(screen.queryByText(he.areas.empty)).toBeNull();
    expect(screen.queryByRole('heading', { name: /אזורי השקה/ })).toBeNull();
    expect(document.title).toBe(he.app.title);
    // The one turtle, decorative.
    const mascots = document.querySelectorAll('main img');
    expect(mascots).toHaveLength(1);
    expect(mascots[0]).toHaveAttribute('alt', '');
    expect(mascots[0]?.getAttribute('src')).toMatch(/homie-turtle-hello/);
  });

  it('ac2_ctas', async () => {
    const { api } = await visitLanding();
    const main = within(screen.getByRole('main'));

    expect(main.getByRole('link', { name: he.landing.cta.owner })).toHaveAttribute(
      'href',
      '/signup?role=owner&next=%2Flistings%2Fnew',
    );
    const seeker = main.getByRole('link', { name: he.landing.cta.seeker });
    expect(seeker).toHaveAttribute('href', '/search');
    // Primary ink and secondary; each with an aria-hidden chevron at the end.
    const owner = main.getByRole('link', { name: he.landing.cta.owner });
    expect(owner).toHaveClass('bg-ink', 'text-on-ink', 'justify-between', 'min-h-13');
    expect(seeker).toHaveClass('border-border-strong', 'bg-surface', 'justify-between');
    for (const cta of [owner, seeker]) {
      expect(cta.lastElementChild).toHaveAttribute('aria-hidden', 'true');
    }
    // Static: the page makes no call of its own.
    expect(api.fetchMock.mock.calls.length).toBe(api.calls('GET /me').length);
  });

  it('ac3_example_card', async () => {
    await visitLanding();
    const figure = screen.getByRole('figure');
    const card = within(figure);

    expect(card.getByText(he.landing.example.caption).tagName).toBe('FIGCAPTION');
    expect(card.getByText(i18n.t('match.badge', { score: EXAMPLE_SCORE }))).toBeVisible();
    expect(i18n.t('match.badge', { score: EXAMPLE_SCORE })).toBe('התאמה 91%');
    const text = figure.textContent ?? '';
    for (const fact of ['7,200', he.landing.example.street, he.landing.example.city]) {
      expect(text).toContain(fact);
    }
    // The entry date is after today (45 days on), never "immediate".
    const today = todayInIsrael();
    const entry = addDays(today, 45);
    expect(entry > today).toBe(true);
    expect(text).toContain(formatDate(entry));
    expect(text).not.toContain(he.listings.card.immediate);
    // Not a link, and no heading in the page outline.
    expect(card.queryByRole('link')).toBeNull();
    expect(card.queryByRole('heading')).toBeNull();
  });

  it('ac4_steps_trust_no_footer', async () => {
    await visitLanding();

    // "איך זה עובד", then a list of three steps, each with its h3 and text.
    const how = screen.getByRole('heading', { level: 2, name: he.landing.how.title });
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(how).toHaveClass('font-display', 'text-h2');
    const steps = how.nextElementSibling as HTMLElement;
    expect(steps.tagName).toBe('OL');
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    const copy = he.landing.how;
    [copy.step1, copy.step2, copy.step3].forEach((step, i) => {
      const item = within(items[i] as HTMLElement);
      expect(item.getByRole('heading', { level: 3, name: step.title })).toBeVisible();
      expect(item.getByText(step.text)).toBeVisible();
    });

    // The trust strip: exactly three items, the separators inside them; nothing says "טלפון".
    const trust = screen.getByText(he.landing.trust.verified).closest('ul') as HTMLElement;
    const claims = within(trust).getAllByRole('listitem');
    expect(claims).toHaveLength(3);
    expect(trust.children).toHaveLength(3);
    expect(claims[1]).toHaveTextContent(he.landing.trust.noBrokers);
    expect(claims[2]).toHaveTextContent(he.landing.trust.free);
    expect(document.body.textContent).not.toContain('טלפון');

    // No footer links (Q3).
    for (const name of ['תנאי שימוש', 'פרטיות', 'צור קשר']) {
      expect(screen.queryByRole('link', { name })).toBeNull();
    }
    expect(document.querySelector('footer')).toBeNull();
  });
});
