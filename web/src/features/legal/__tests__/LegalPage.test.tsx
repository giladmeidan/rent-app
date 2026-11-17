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

  it('ac14_privacy_names_google_sign_in', async () => {
    await visit('/privacy');
    const { s1, s3 } = he.legal.privacy;
    // Spec 0016b: the Google item is in section 3's list, right after OpenStreetMap.
    const section = screen.getByRole('heading', { level: 2, name: s3.title }).parentElement;
    const items = [...(section?.querySelectorAll('li') ?? [])].map((li) => li.textContent);
    expect(items.indexOf(s3.i6)).toBe(items.indexOf(s3.i3) + 1);
    expect(s3.i6).toContain('Google');
    expect(s1.i1).toContain('Google');
    expect(document.body.textContent).toContain(s1.i1);
  });

  it('ac18_privacy_names_calendar_feed', async () => {
    await visit('/privacy');
    const { s3 } = he.legal.privacy;
    // Spec 0018d: the calendar feed item is in section 3's list, right after Google's.
    const section = screen.getByRole('heading', { level: 2, name: s3.title }).parentElement;
    const items = [...(section?.querySelectorAll('li') ?? [])].map((li) => li.textContent);
    expect(items.indexOf(s3.i7)).toBe(items.indexOf(s3.i6) + 1);
    expect(s3.i7).toContain('Google Calendar');
  });

  it('ac11_privacy_names_sentry', async () => {
    await visit('/privacy');
    const { s3 } = he.legal.privacy;
    // Spec 0019a: the Sentry item is in section 3's list, right after the calendar feed.
    const section = screen.getByRole('heading', { level: 2, name: s3.title }).parentElement;
    const items = [...(section?.querySelectorAll('li') ?? [])].map((li) => li.textContent);
    expect(items.indexOf(s3.i8)).toBe(items.indexOf(s3.i7) + 1);
    expect(s3.i8).toContain('Sentry');
    expect(s3.i8).toContain('30 יום');
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
    // Each rule's period is in its own line.
    const periods: [string, string[]][] = [
      [s5.i3, ['12 חודשים']],
      [s5.i4, ['24 חודשים']],
      [s5.i5, ['3 שנים']],
      [s5.i6, ['12 חודשים']],
      [s5.i8, ['30 יום']],
      [s5.i9, ['30 יום']],
      [s5.i10, ['3 שנים', '12 חודשים']],
      [s5.i11, ['3 שנים']],
      [s5.i12, ['5 שנים']],
      [s5.i13, ['12 חודשים']],
      [s6.i7, ['5 שנים']],
      [s1.i13, ['30 יום']],
    ];
    for (const [line, expected] of periods) {
      for (const period of expected) expect(line).toContain(period);
    }
    // Spec 0018c: tours in section 1 (with the account email's use) and with the email provider.
    expect(page).toContain(s1.i16);
    expect(page).toContain(s5.i13);
    expect(s1.i1).toContain('ולסיורים');
    expect(he.legal.privacy.s3.i2).toContain('סיורים');
    // The terms point to section 5.
    expect(he.legal.terms.s9.p1).toContain('סעיף 5');
    expect(he.legal.terms.s9.p1).toContain(s5.title.replace(/^5\. /, ''));
  });
});
