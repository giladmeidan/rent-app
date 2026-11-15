import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONTACT_EMAIL } from '../../../app/contact';
import i18n from '../../../app/i18n';
import { AppRoutes } from '../../../app/routes';
import he from '../../../locales/he.json';
import { json, mockApi, renderRoutes } from '../../auth/__tests__/harness';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Section = { title: string } & Record<string, string>;
type Doc = { title: string; intro: string } & Record<string, string | Section>;

/** A doc's sections (`s1`, `s2` …) in the catalogue's order, and every body line of the page. */
function expected(doc: Doc) {
  const sections = Object.entries(doc)
    .filter(([key]) => /^s\d+$/.test(key))
    .map(([, value]) => value as Section);
  const lines = [
    doc.intro,
    ...sections.flatMap((section) =>
      Object.entries(section)
        .filter(([key]) => key !== 'title')
        .map(([, line]) => line),
    ),
  ];
  return { titles: sections.map((s) => s.title), lines };
}

async function visit(path: string) {
  const api = mockApi({ 'GET /me': [() => json({ detail: 'unauthenticated' }, 401)] });
  renderRoutes(path, <AppRoutes />);
  await screen.findByRole('heading', { level: 1 });
  return api;
}

describe('LegalPage', () => {
  it.each([
    ['/terms', he.legal.terms],
    ['/privacy', he.legal.privacy],
  ] as const)('ac9_legal_pages %s', async (path, doc) => {
    await visit(path);
    const { titles, lines } = expected(doc as unknown as Doc);

    // h1, the updated line, then every section as an h2, in order; the page title is set.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(doc.title);
    expect(document.title).toContain(doc.title);
    expect(screen.getByText(i18n.t('legal.updated', { date: he.legal.date }))).toBeVisible();
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s.map((h) => h.textContent)).toEqual(titles);
    for (const h of h2s) expect(h.id).not.toBe('');

    // Every line of the catalogue is on the page, with the contact address in place of `{{email}}`
    // and no raw placeholder left over.
    const page = document.body.textContent ?? '';
    for (const line of lines) {
      expect(page).toContain(line.replaceAll('{{email}}', CONTACT_EMAIL));
    }
    expect(page).not.toContain('{{');
    // The address is a `<bdi>` run, with no invisible characters beside it.
    const bdis = [...document.querySelectorAll('bdi')];
    expect(bdis.length).toBeGreaterThan(0);
    for (const bdi of bdis) expect(bdi.textContent).toBe(CONTACT_EMAIL);
    expect(page).not.toMatch(/[\u2068\u2069]/);
    expect(page).toContain(CONTACT_EMAIL);
  });

  it('ac9_privacy_deletion_anchor', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    await visit('/privacy#deletion');
    const section = document.getElementById('deletion');
    expect(section).toBeInstanceOf(HTMLHeadingElement);
    expect(section).toHaveTextContent(he.legal.privacy.s6.title);
    expect(scroll.mock.contexts).toContain(section);
  });

  it('ac9_malformed_hash_does_not_crash', async () => {
    await visit('/privacy#%E0');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(he.legal.privacy.title);
  });

  it('ac12_privacy_states_retention_periods', async () => {
    await visit('/privacy');
    const page = document.body.textContent ?? '';
    // Spec 0013h: every kind of data has a period; none is kept without limit.
    expect(page).not.toContain('בלי הגבלת זמן');
    const { s1, s5, s6 } = he.legal.privacy;
    for (const line of [s1.i13, ...Object.values(s5), ...Object.values(s6)]) {
      expect(line).not.toContain('[');
    }
    for (const period of ['12 חודשים', '24 חודשים', '3 שנים', '5 שנים', '30 יום']) {
      expect(page).toContain(period);
    }
    expect(page).toContain(s5.i9);
  });
});
