import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import { expectNoAxeViolations } from '../a11y';
import { WAITLIST_PORT } from './port';

// The waitlist page (spec 0017), served from waitlist/public by playwright.waitlist.config.ts. Every
// API call is stubbed; the page gets the real `_headers` CSP, and any request that leaves the page's
// own origin fails the test (AC17), except the Turnstile script (spec 0017b), which is routed to a fake.

const HEADERS_FILE = fileURLToPath(new URL('../../../waitlist/public/_headers', import.meta.url));
const CSP = /Content-Security-Policy:\s*(.+)/.exec(readFileSync(HEADERS_FILE, 'utf8'))?.[1] ?? '';

const MESSAGES = {
  email: 'צריך אימייל תקין, למשל name@example.com',
  kindSeeker: 'צריך לבחור מה מחפשים',
  kindLister: 'צריך לבחור מה מפרסמים',
  city: 'צריך לבחור עיר',
  units: 'צריך לבחור כמה נכסים',
  available: 'צריך לבחור מתי הנכס מתפנה',
  consent: 'כדי להירשם צריך לסמן את האישור',
};
const ERROR_BANNER = 'משהו השתבש. אפשר לנסות שוב בעוד רגע.';
const CHALLENGE_BANNER = 'לא הצלחנו לוודא שזה לא בוט. אפשר לנסות שוב.';
const SENDING = 'בשליחה…';

// Turnstile (spec 0017b). Matched by host and path: a glob is unsafe with the `?render=` query.
const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const isTurnstileScript = (url: URL) =>
  url.hostname === 'challenges.cloudflare.com' && url.pathname === '/turnstile/v0/api.js';

/**
 * A fake `api.js`: `render` records its options and calls `callback('fake-token')` at once; `reset` is
 * counted and issues a new token the same way. `window.__turnstileFlags` (set with addInitScript) changes
 * that: `tokenDelay` (ms), `noToken`, or `error` (calls `error-callback` instead and records its return).
 * `window.__turnstileIssue(i)` hands widget i a token later.
 */
const FAKE_TURNSTILE = `(() => {
  const flags = window.__turnstileFlags || {};
  const record = { renders: [], resets: 0, errorReturns: [] };
  const widgets = [];
  window.__turnstileFake = record;
  function issue(options) {
    if (flags.error) {
      record.errorReturns.push(options['error-callback']('110100'));
      return;
    }
    if (flags.noToken) return;
    if (flags.tokenDelay) setTimeout(() => options.callback('fake-token'), flags.tokenDelay);
    else options.callback('fake-token');
  }
  window.turnstile = {
    render(element, options) {
      record.renders.push({
        side: element.closest('form').dataset.side,
        sitekey: options.sitekey,
        action: options.action,
        appearance: options.appearance,
        language: options.language,
        responseField: options['response-field'],
      });
      widgets.push(options);
      issue(options);
      return 'widget-' + (widgets.length - 1);
    },
    reset(id) {
      record.resets += 1;
      issue(widgets[Number(String(id).slice('widget-'.length))]);
    },
  };
  window.__turnstileIssue = (index) => widgets[index].callback('fake-token');
})();`;

type FakeRender = {
  side: string;
  sitekey: string;
  action: string;
  appearance: string;
  language: string;
  responseField: boolean;
};
type FakeRecord = { renders: FakeRender[]; resets: number; errorReturns: unknown[] };
type FakeFlags = { tokenDelay?: number; noToken?: boolean; error?: boolean };

function serveFakeTurnstile(route: Route) {
  return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_TURNSTILE });
}

function fake(page: Page): Promise<FakeRecord> {
  return page.evaluate(
    () => (window as unknown as { __turnstileFake: FakeRecord }).__turnstileFake,
  );
}

async function renderedSides(page: Page) {
  return (await fake(page)).renders.map((render) => render.side);
}

function setTurnstileFlags(page: Page, flags: FakeFlags) {
  return page.addInitScript((value) => {
    (window as unknown as { __turnstileFlags: FakeFlags }).__turnstileFlags = value;
  }, flags);
}

type Guard = { foreign: string[]; cspViolations: string[] };
const guards = new WeakMap<Page, Guard>();

test.beforeEach(async ({ page }) => {
  const guard: Guard = { foreign: [], cspViolations: [] };
  guards.set(page, guard);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (isTurnstileScript(url)) return;
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) guard.foreign.push(request.url());
  });
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy'))
      guard.cspViolations.push(message.text());
  });
  // The deployed page carries `_headers`' CSP; the python server sends none, so add it here.
  await page.route(
    (url) =>
      url.port === String(WAITLIST_PORT) &&
      (url.pathname === '/' || url.pathname.endsWith('.html')),
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': CSP },
      });
    },
  );
  await page.route(isTurnstileScript, serveFakeTurnstile);
  await page.route('**/api/count', (route) => json(route, 200, { total: null }));
  await page.route('**/api/signup', (route) => json(route, 500, { error: 'server' }));
});

test.afterEach(({ page }) => {
  const guard = guards.get(page);
  expect(guard?.foreign, 'requests to another origin').toEqual([]);
  expect(guard?.cspViolations, 'CSP violations').toEqual([]);
});

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Opens the page and waits for app.js (it marks <html class="js"> last). */
async function open(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.locator('html')).toHaveClass(/\bjs\b/);
}

const seekerTab = (page: Page) => page.getByRole('tab', { name: 'מחפשים', exact: true });
const listerTab = (page: Page) => page.getByRole('tab', { name: 'משכירים', exact: true });
const seekerPanel = (page: Page) => page.locator('#panel-seeker');
const listerPanel = (page: Page) => page.locator('#panel-lister');
const submitButton = (panel: Locator) => panel.getByRole('button', { name: 'הרשמה לרשימה' });

// Spec 0017d: the referral block in the success panel.
const REF = 'k7m2pq9x';
const SHARE_MESSAGE =
  'מצאתי את הומי: דירות ושותפים ישר מאנשים פרטיים, בלי מתווכים ובחינם. נרשמים לרשימת ההמתנה כאן:';
const REFER_PRIVACY = 'נשמור מי נרשם מהקישור שלכם, רק כדי לצרף אתכם לגל הראשון.';
const FORM_PRIVACY_START =
  'שומרים רק את מה שמילאתם כאן, כדי לעדכן על ההשקה ולדעת כמה מחכים בכל עיר.';
const referBlock = (panel: Locator) => panel.locator('.refer');
const referLink = (panel: Locator) => panel.getByLabel('הקישור שלכם');
const whatsapp = (panel: Locator) => panel.getByRole('link', { name: 'שליחה בוואטסאפ' });
const copyButton = (panel: Locator) => panel.getByRole('button', { name: 'העתקת הקישור' });

async function fillSeeker(panel: Locator, email = 'Noa@Example.com') {
  await panel.getByLabel('אימייל').fill(email);
  await panel.getByRole('radio', { name: 'חדר בדירת שותפים' }).check();
  await panel.getByLabel('באיזו עיר?').selectOption('tel-aviv');
  await panel.getByRole('checkbox').check();
}

test('ac10_tabs_and_deep_link', async ({ page }) => {
  await open(page);
  await expect(seekerTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(seekerPanel(page)).toBeVisible();
  await expect(listerPanel(page)).toBeHidden();

  // The hero's secondary button opens the lister tab.
  await page.getByRole('link', { name: 'משכירים נכס' }).click();
  await expect(listerTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(listerPanel(page)).toBeVisible();
  await expect(seekerPanel(page)).toBeHidden();
  await expect(listerTab(page)).toBeFocused();

  // A door card's link selects its own side.
  await page.locator('#sides').getByRole('link', { name: 'להצטרפות ←' }).first().click();
  await expect(seekerTab(page)).toHaveAttribute('aria-selected', 'true');

  // The deep link selects the tab and, with no hash of its own, opens on the form.
  await open(page, '/?side=lister');
  await expect(listerTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(listerPanel(page)).toBeVisible();
  await expect(listerTab(page)).toBeInViewport();
  await expect(page.locator('#hero-title')).not.toBeInViewport();

  // Arrows follow the visual order: in RTL the first tab is on the right, so the left arrow moves on
  // and the right arrow moves back; neither wraps.
  await open(page);
  const seekerBox = await seekerTab(page).boundingBox();
  const listerBox = await listerTab(page).boundingBox();
  expect(seekerBox?.x ?? 0).toBeGreaterThan(listerBox?.x ?? Infinity);
  await seekerTab(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(seekerTab(page)).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(listerTab(page)).toBeFocused();
  await expect(listerTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(listerPanel(page)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(seekerTab(page)).toBeFocused();
  await expect(seekerTab(page)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(listerTab(page)).toBeFocused();
  await expect(listerTab(page)).toHaveAttribute('tabindex', '0');
  await expect(seekerTab(page)).toHaveAttribute('tabindex', '-1');
});

test('ac11_field_errors', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/signup', (route) => {
    requests += 1;
    return json(route, 400, { error: 'invalid', fields: ['city'] });
  });
  await open(page);

  // Empty seeker form: every required field's message, focus on the email, no request.
  const seeker = seekerPanel(page);
  await submitButton(seeker).click();
  for (const message of [MESSAGES.email, MESSAGES.kindSeeker, MESSAGES.city, MESSAGES.consent]) {
    await expect(seeker.getByText(message)).toBeVisible();
  }
  const email = seeker.getByLabel('אימייל');
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAccessibleDescription(MESSAGES.email);
  await expect(seeker.getByRole('radiogroup', { name: 'מה מחפשים?' })).toHaveAccessibleDescription(
    MESSAGES.kindSeeker,
  );
  expect(requests).toBe(0);

  // Empty lister form: its own messages, the phone and neighbourhood optional.
  await listerTab(page).click();
  const lister = listerPanel(page);
  await submitButton(lister).click();
  for (const message of [
    MESSAGES.email,
    MESSAGES.kindLister,
    MESSAGES.city,
    MESSAGES.units,
    MESSAGES.available,
    MESSAGES.consent,
  ]) {
    await expect(lister.getByText(message)).toBeVisible();
  }
  await expect(lister.getByLabel('טלפון (לא חובה)')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(lister.getByLabel('אימייל')).toBeFocused();
  expect(requests).toBe(0);

  // A bad phone is caught before sending.
  await lister.getByLabel('טלפון (לא חובה)').fill('123');
  await submitButton(lister).click();
  await expect(lister.getByText('מספר הטלפון לא נראה תקין. אפשר גם להשאיר ריק.')).toBeVisible();
  expect(requests).toBe(0);

  // A server 400 maps its fields to the same messages.
  await seekerTab(page).click();
  await fillSeeker(seeker);
  await expect(seeker.getByText(MESSAGES.email)).toBeHidden();
  await submitButton(seeker).click();
  await expect(seeker.getByText(MESSAGES.city)).toBeVisible();
  await expect(seeker.getByLabel('באיזו עיר?')).toBeFocused();
  await expect(seeker.getByLabel('באיזו עיר?')).toHaveAttribute('aria-invalid', 'true');
  expect(requests).toBe(1);
});

test('ac12_success_and_other_side', async ({ page }) => {
  const bodies: unknown[] = [];
  await page.route('**/api/signup', (route) => {
    bodies.push(route.request().postDataJSON());
    return json(route, 200, { ok: true });
  });
  await open(page);
  const seeker = seekerPanel(page);
  await fillSeeker(seeker, '  Noa@Example.com ');
  await submitButton(seeker).click();

  const title = seeker.getByRole('heading', { name: 'נרשמתם!' });
  await expect(title).toBeVisible();
  await expect(title).toBeFocused();
  await expect(seeker.locator('img[src$="homie-turtle-celebrate.svg"]')).toBeVisible();
  await expect(seeker.getByText('noa@example.com')).toBeVisible();
  await expect(seeker.getByText('ברגע שהומי עולה לאוויר. לאט לאט? ממש לא.')).toBeVisible();
  await expect(seeker.locator('form')).toBeHidden();
  expect(bodies).toEqual([
    {
      side: 'seeker',
      email: 'Noa@Example.com', // an email input trims its own value; the server lower-cases
      kind: 'room',
      city: 'tel-aviv',
      consent: true,
      website: '',
      turnstile: 'fake-token',
    },
  ]);

  await seeker.getByRole('button', { name: 'גם משכירים? להרשמה גם שם' }).click();
  await expect(listerTab(page)).toHaveAttribute('aria-selected', 'true');
  const lister = listerPanel(page);
  await expect(lister.getByLabel('אימייל')).toHaveValue('noa@example.com');
  await expect(lister.locator('form')).toBeVisible();

  // The lister side: the optional phone goes as typed (the server normalises it).
  await lister.getByLabel('טלפון (לא חובה)').fill('052-123-4567');
  await lister.getByRole('radio', { name: 'דירה', exact: true }).check();
  await lister.getByLabel('באיזו עיר?').selectOption('holon');
  await lister.getByRole('radio', { name: '3 ומעלה' }).check();
  await lister.getByRole('radio', { name: 'כבר עכשיו' }).check();
  await lister.getByRole('checkbox').check();
  await submitButton(lister).click();
  await expect(lister.getByRole('heading', { name: 'נרשמתם!' })).toBeFocused();
  // Both sides have joined: neither success state offers the other side any more.
  await expect(lister.getByRole('button', { name: 'גם מחפשים? להרשמה גם שם' })).toBeHidden();
  await seekerTab(page).click();
  await expect(seeker.getByRole('heading', { name: 'נרשמתם!' })).toBeVisible();
  await expect(seeker.getByRole('button', { name: 'גם משכירים? להרשמה גם שם' })).toBeHidden();
  expect(bodies[1]).toEqual({
    side: 'lister',
    email: 'noa@example.com',
    kind: 'apartment',
    city: 'holon',
    phone: '052-123-4567',
    neighbourhood: '',
    units: '3+',
    available: 'now',
    consent: true,
    website: '',
    turnstile: 'fake-token',
  });
});

test('ac13_error_and_single_submit', async ({ page, context }) => {
  await open(page);
  const seeker = seekerPanel(page);
  await fillSeeker(seeker, 'noa@example.com');
  await submitButton(seeker).click();

  const alert = seeker.getByRole('alert');
  await expect(alert).toHaveText(ERROR_BANNER);
  await expect(seeker.getByLabel('אימייל')).toHaveValue('noa@example.com');
  await expect(seeker.getByRole('radio', { name: 'חדר בדירת שותפים' })).toBeChecked();
  await expect(seeker.getByLabel('באיזו עיר?')).toHaveValue('tel-aviv');
  await expect(seeker.getByRole('checkbox')).toBeChecked();

  // 403 and 413 show the same banner.
  for (const status of [403, 413]) {
    await page.route('**/api/signup', (route) => json(route, status, { error: 'x' }));
    await submitButton(seeker).click();
    await expect(alert).toHaveText(ERROR_BANNER);
  }

  // Offline says so instead.
  await context.setOffline(true);
  await submitButton(seeker).click();
  await expect(alert).toHaveText('אין חיבור לאינטרנט');
  await context.setOffline(false);

  // A double click while the first request is in flight sends one request.
  let requests = 0;
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/signup', async (route) => {
    requests += 1;
    await held;
    await json(route, 200, { ok: true });
  });
  const button = submitButton(seeker);
  await button.dblclick();
  await expect(seeker.getByRole('button', { name: 'בשליחה…' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  // A third click on the busy button (aria-disabled, so Playwright needs force) is ignored too.
  await seeker.getByRole('button', { name: 'בשליחה…' }).click({ force: true });
  release();
  await expect(seeker.getByRole('heading', { name: 'נרשמתם!' })).toBeVisible();
  expect(requests).toBe(1);
});

test('ac14_counter', async ({ page }) => {
  const counter = page.locator('#counter');

  await page.route('**/api/count', (route) => json(route, 200, { total: 1234 }));
  await open(page);
  await expect(counter).toBeVisible();
  await expect(counter).toHaveText('כבר 1,234 נרשמו לרשימה');
  const shown = await counter.boundingBox();

  await page.route('**/api/count', (route) => json(route, 200, { total: null }));
  await open(page);
  await expect(counter).toBeHidden();
  await expect(counter).toHaveText('');
  // The line's height is kept, so nothing moves when it appears.
  expect((await counter.boundingBox())?.height).toBe(shown?.height);

  await page.route('**/api/count', (route) => json(route, 500, { error: 'server' }));
  await open(page);
  await expect(counter).toBeHidden();
  await expect(counter).toHaveText('');
});

test('ac15_video_click_to_play', async ({ page }) => {
  // Playwright's Chromium has no H.264 decoder: record play() instead of playing.
  await page.addInitScript(() => {
    const calls: number[] = [];
    Object.defineProperty(window, '__plays', { value: calls });
    HTMLMediaElement.prototype.play = function play() {
      calls.push(Date.now());
      return Promise.resolve();
    };
  });
  const videoRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('homie-promo.mp4')) videoRequests.push(request.url());
  });
  await open(page);

  const video = page.locator('video');
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video).toHaveAttribute('poster', 'media/homie-promo-poster.webp');
  await expect(video).toHaveAttribute('aria-label', 'סרטון ההיכרות של הומי');
  await video.scrollIntoViewIfNeeded();
  await page.waitForLoadState('networkidle');
  expect(videoRequests).toEqual([]);

  // The native controls wait under the play button, then take over.
  await expect(video).not.toHaveAttribute('controls');
  const play = page.getByRole('button', { name: 'צפייה בסרטון' });
  await play.click();
  await expect(play).toBeHidden();
  await expect(video).toHaveAttribute('controls', '');
  expect(
    await page.evaluate(() => (window as unknown as { __plays: number[] }).__plays.length),
  ).toBe(1);

  // A file that fails to load leaves the poster and a line saying so, which takes the focus.
  await video.dispatchEvent('error');
  const failed = page
    .getByRole('status')
    .filter({ hasText: 'הסרטון לא נטען. אפשר לנסות שוב מאוחר יותר.' });
  await expect(failed).toBeVisible();
  await expect(failed).toBeFocused();
});

/** Scrolls every fading section into view and waits until it is fully shown. */
async function revealAll(page: Page) {
  for (const section of await page.locator('.reveal').all()) {
    await section.scrollIntoViewIfNeeded();
    await expect(section).toHaveCSS('opacity', '1');
  }
}

test('ac16_axe_and_reduced_motion', async ({ page }) => {
  await page.route('**/api/count', (route) => json(route, 200, { total: 1234 }));
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 800 },
  ]) {
    const size = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await page.route('**/api/signup', (route) => json(route, 500, { error: 'server' }));
    await open(page);
    await revealAll(page);
    await expectNoAxeViolations(page, `empty ${size}`);

    await listerTab(page).click();
    await expectNoAxeViolations(page, `empty lister ${size}`);
    await submitButton(listerPanel(page)).click();
    await expect(listerPanel(page).getByText(MESSAGES.units)).toBeVisible();
    await expectNoAxeViolations(page, `field errors ${size}`);

    await seekerTab(page).click();
    await fillSeeker(seekerPanel(page));
    await submitButton(seekerPanel(page)).click();
    await expect(seekerPanel(page).getByRole('alert')).toHaveText(ERROR_BANNER);
    await expectNoAxeViolations(page, `error banner ${size}`);

    await page.route('**/api/signup', (route) => json(route, 403, { error: 'challenge' }));
    await submitButton(seekerPanel(page)).click();
    await expect(seekerPanel(page).getByRole('alert')).toHaveText(CHALLENGE_BANNER);
    await expectNoAxeViolations(page, `challenge banner ${size}`);

    await page.route('**/api/signup', (route) => json(route, 200, { ok: true, ref: REF }));
    await submitButton(seekerPanel(page)).click();
    await expect(seekerPanel(page).getByRole('heading', { name: 'נרשמתם!' })).toBeFocused();
    await expect(referLink(seekerPanel(page))).toBeVisible();
    await expectNoAxeViolations(page, `success ${size}`);

    // Spec 0017d NF1: the block's controls are reached in order: field, WhatsApp, copy.
    await seekerPanel(page).getByRole('button', { name: 'גם משכירים? להרשמה גם שם' }).focus();
    await page.keyboard.press('Tab');
    await expect(referLink(seekerPanel(page))).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(whatsapp(seekerPanel(page))).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(copyButton(seekerPanel(page))).toBeFocused();
  }

  // Tap targets: the small header button, the footer link and the consent row are 44 px tall at least.
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  for (const target of [
    page.getByRole('link', { name: 'הצטרפות לרשימה' }),
    page.locator('.site-footer__contact'),
    seekerPanel(page).locator('label.consent'),
  ]) {
    expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(
    (await seekerPanel(page).getByRole('checkbox').boundingBox())?.height ?? 0,
  ).toBeGreaterThanOrEqual(24);

  // With motion welcome the turtle floats, so the check below can see an animation when there is one.
  await open(page);
  expect(await page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.getByRole('link', { name: 'משכירים נכס' }).click();
  await expect(page.locator('#sides')).toHaveCSS('opacity', '1');
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test('ac17_no_third_party_requests', async ({ page }) => {
  const seen: string[] = [];
  page.on('request', (request) => seen.push(request.url()));
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });
  // Spec 0017d NF3: with the referral block shown, its WhatsApp link requests nothing (never followed here).
  await page.route('**/api/signup', (route) => json(route, 200, { ok: true, ref: REF }));
  await open(page);
  await revealAll(page);
  await page.getByRole('button', { name: 'צפייה בסרטון' }).click();
  await fillSeeker(seekerPanel(page));
  await submitButton(seekerPanel(page)).click();
  await expect(seekerPanel(page).getByRole('heading', { name: 'נרשמתם!' })).toBeVisible();
  await expect(whatsapp(seekerPanel(page))).toBeVisible();
  await page.waitForLoadState('networkidle');

  // Fonts, images, the poster and both APIs were all fetched, and only from the page's own origin; the
  // one exception is the Turnstile script (routed to the fake), requested once.
  const origin = new URL(page.url()).origin;
  expect(seen.length).toBeGreaterThan(10);
  for (const url of seen) {
    if (url.startsWith('data:') || url === TURNSTILE_URL) continue;
    expect(url.startsWith(`${origin}/`), url).toBe(true);
  }
  expect(seen.filter((url) => url === TURNSTILE_URL)).toHaveLength(1);
  expect(seen.some((url) => url.endsWith('.woff2'))).toBe(true);
  // The afterEach guard also fails on any CSP violation under `_headers`' policy.
});

// ---------------------------------------------------------------------------------------------
// Spec 0017b: Turnstile, against the fake api.js.

test('ac6b_token_sent', async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/signup', (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return json(route, 200, { ok: true });
  });
  await open(page);

  // The default tab's widget, with the committed page's placeholder key; the lister's is not rendered yet.
  await expect
    .poll(() => fake(page).then((record) => record.renders))
    .toEqual([
      {
        side: 'seeker',
        sitekey: 'TURNSTILE_SITE_KEY_PLACEHOLDER',
        action: 'signup',
        appearance: 'interaction-only',
        language: 'he',
        responseField: false,
      },
    ]);
  await expect(
    page.locator('form[data-side="seeker"] input[name="cf-turnstile-response"]'),
  ).toHaveCount(0);

  const seeker = seekerPanel(page);
  await fillSeeker(seeker, 'noa@example.com');
  await submitButton(seeker).click();
  await expect(seeker.getByRole('heading', { name: 'נרשמתם!' })).toBeVisible();
  expect(bodies).toEqual([expect.objectContaining({ side: 'seeker', turnstile: 'fake-token' })]);

  // "The other side" after a success shows the lister panel for the first time: its widget renders.
  await seeker.getByRole('button', { name: 'גם משכירים? להרשמה גם שם' }).click();
  await expect.poll(() => renderedSides(page)).toEqual(['seeker', 'lister']);
  expect((await fake(page)).renders[1]).toMatchObject({
    sitekey: 'TURNSTILE_SITE_KEY_PLACEHOLDER',
    action: 'signup',
    appearance: 'interaction-only',
  });
  // Switching tabs again renders nothing more: one widget per form.
  await seekerTab(page).click();
  await listerTab(page).click();
  await seekerTab(page).click();
  expect(await renderedSides(page)).toEqual(['seeker', 'lister']);

  // A tab click, an arrow key, a hero link and the deep link each render the lister widget on first show.
  await open(page);
  await expect.poll(() => renderedSides(page)).toEqual(['seeker']);
  await listerTab(page).click();
  await expect.poll(() => renderedSides(page)).toEqual(['seeker', 'lister']);

  await open(page);
  await expect.poll(() => renderedSides(page)).toEqual(['seeker']);
  await seekerTab(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => renderedSides(page)).toEqual(['seeker', 'lister']);

  await open(page);
  await expect.poll(() => renderedSides(page)).toEqual(['seeker']);
  await page.getByRole('link', { name: 'משכירים נכס' }).click();
  await expect.poll(() => renderedSides(page)).toEqual(['seeker', 'lister']);

  await open(page, '/?side=lister');
  await expect.poll(() => renderedSides(page)).toEqual(['lister']);
});

test('ac7b_waits_for_token', async ({ page }) => {
  let requests: Record<string, unknown>[] = [];
  await page.route('**/api/signup', (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    return json(route, 200, { ok: true });
  });
  // The page's timers stand still from the start; the test moves them.
  await page.clock.install({ time: new Date('2026-11-16T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-16T10:00:01Z'));

  // The token comes 2 s after the click: "בשליחה…" meanwhile, then one request with it.
  await setTurnstileFlags(page, { tokenDelay: 2000 });
  await open(page);
  await expect.poll(() => renderedSides(page)).toEqual(['seeker']);
  const seeker = seekerPanel(page);
  await fillSeeker(seeker, 'noa@example.com');
  await submitButton(seeker).click();
  const busy = seeker.getByRole('button', { name: SENDING });
  await expect(busy).toHaveAttribute('aria-disabled', 'true');
  await page.clock.runFor(1999);
  await expect(busy).toBeVisible();
  expect(requests).toEqual([]);
  await page.clock.runFor(1);
  await expect(seeker.getByRole('heading', { name: 'נרשמתם!' })).toBeVisible();
  expect(requests).toEqual([expect.objectContaining({ turnstile: 'fake-token' })]);

  // No token within 10 s: the challenge banner, and nothing is sent.
  requests = [];
  await setTurnstileFlags(page, { noToken: true });
  await open(page);
  await expect.poll(() => renderedSides(page)).toEqual(['seeker']);
  await fillSeeker(seeker, 'noa@example.com');
  await submitButton(seeker).click();
  await expect(busy).toHaveAttribute('aria-disabled', 'true');
  await page.clock.runFor(9999);
  await expect(busy).toBeVisible();
  await expect(seeker.locator('.banner')).toBeEmpty();
  await page.clock.runFor(1);
  await expect(seeker.getByRole('alert')).toHaveText(CHALLENGE_BANNER);
  await expect(submitButton(seeker)).not.toHaveAttribute('aria-disabled');
  expect(requests).toEqual([]);
  // The widget is reset, so the next try gets a fresh challenge without a reload.
  expect((await fake(page)).resets).toBe(1);
});

test('ac8b_challenge_banner_and_reset', async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/signup', (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return json(route, 403, { error: 'challenge' });
  });
  await open(page);
  const seeker = seekerPanel(page);
  await fillSeeker(seeker, 'noa@example.com');
  await submitButton(seeker).click();

  const alert = seeker.getByRole('alert');
  await expect(alert).toHaveText(CHALLENGE_BANNER);
  await expect(seeker.getByLabel('אימייל')).toHaveValue('noa@example.com');
  await expect(seeker.getByRole('radio', { name: 'חדר בדירת שותפים' })).toBeChecked();
  await expect(seeker.getByLabel('באיזו עיר?')).toHaveValue('tel-aviv');
  await expect(seeker.getByRole('checkbox')).toBeChecked();
  await expect(submitButton(seeker)).not.toHaveAttribute('aria-disabled');
  expect((await fake(page)).resets).toBe(1);

  // A 500 keeps the generic banner and also resets; the new token went with the retry.
  await page.route('**/api/signup', (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return json(route, 500, { error: 'server' });
  });
  await submitButton(seeker).click();
  await expect(alert).toHaveText(ERROR_BANNER);
  expect((await fake(page)).resets).toBe(2);
  expect(bodies).toHaveLength(2);
  expect(bodies.every((body) => body.turnstile === 'fake-token')).toBe(true);

  // A thrown fetch (the request fails) shows the generic banner and resets as well.
  await page.route('**/api/signup', (route) => route.abort());
  await submitButton(seeker).click();
  await expect(alert).toHaveText(ERROR_BANNER);
  await expect(submitButton(seeker)).not.toHaveAttribute('aria-disabled');
  expect((await fake(page)).resets).toBe(3);
});

test('ac9b_script_blocked', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/signup', (route) => {
    requests += 1;
    return json(route, 200, { ok: true });
  });

  // The script is blocked: the banner at once (well within the 10 s wait), nothing sent.
  await page.route(isTurnstileScript, (route) => route.abort());
  await open(page);
  const seeker = seekerPanel(page);
  await fillSeeker(seeker, 'noa@example.com');
  await submitButton(seeker).click();
  await expect(seeker.getByRole('alert')).toHaveText(CHALLENGE_BANNER, { timeout: 3000 });
  await expect(submitButton(seeker)).not.toHaveAttribute('aria-disabled');
  expect(requests).toBe(0);

  // The widget fires error-callback: handled (returns true), the banner on submit, nothing sent.
  await page.unroute(isTurnstileScript);
  await page.route(isTurnstileScript, serveFakeTurnstile);
  await setTurnstileFlags(page, { error: true });
  await open(page);
  await expect.poll(() => fake(page).then((record) => record.errorReturns)).toEqual([true]);
  await fillSeeker(seeker, 'noa@example.com');
  await submitButton(seeker).click();
  await expect(seeker.getByRole('alert')).toHaveText(CHALLENGE_BANNER, { timeout: 3000 });
  expect(requests).toBe(0);
  // The failed widget is reset at once (here the fake fails again: the error-callback runs twice).
  expect(await fake(page)).toMatchObject({ resets: 1, errorReturns: [true, true] });

  // A later token clears the failure: the next submit goes out.
  await page.evaluate(() =>
    (window as unknown as { __turnstileIssue: (index: number) => void }).__turnstileIssue(0),
  );
  await submitButton(seeker).click();
  await expect(seeker.getByRole('heading', { name: 'נרשמתם!' })).toBeVisible();
  expect(requests).toBe(1);
});

// ---------------------------------------------------------------------------------------------
// Spec 0017d: sources and referrals.

test('ac11d_sends_attribution', async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/signup', (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return json(route, 200, { ok: true, ref: REF });
  });
  await open(page, '/?utm_source=instagram&utm_campaign=bio&ref=abcdefgh');
  await fillSeeker(seekerPanel(page), 'noa@example.com');
  await submitButton(seekerPanel(page)).click();
  await expect(seekerPanel(page).getByRole('heading', { name: 'נרשמתם!' })).toBeVisible();
  expect(bodies).toEqual([
    {
      side: 'seeker',
      email: 'noa@example.com',
      kind: 'room',
      city: 'tel-aviv',
      consent: true,
      website: '',
      source: 'instagram',
      campaign: 'bio',
      ref: 'abcdefgh',
      turnstile: 'fake-token',
    },
  ]);

  await open(page);
  await fillSeeker(seekerPanel(page), 'noa@example.com');
  await submitButton(seekerPanel(page)).click();
  await expect(seekerPanel(page).getByRole('heading', { name: 'נרשמתם!' })).toBeVisible();
  expect(bodies).toHaveLength(2);
  for (const key of ['source', 'campaign', 'ref']) expect(bodies[1]).not.toHaveProperty(key);
});

test('ac12d_referral_block', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/api/signup', (route) => json(route, 200, { ok: true, ref: REF }));
  await open(page);
  const seeker = seekerPanel(page);
  await fillSeeker(seeker, 'noa@example.com');
  await submitButton(seeker).click();
  await expect(seeker.getByRole('heading', { name: 'נרשמתם!' })).toBeFocused();

  const origin = new URL(page.url()).origin;
  const link = `${origin}/?ref=${REF}&utm_source=referral`;
  const block = referBlock(seeker);
  await expect(block).toBeVisible();
  await expect(block.getByRole('heading', { name: 'רוצים להיכנס בגל הראשון?' })).toBeVisible();
  await expect(block.getByText('שלושה חברים שנרשמים מהקישור שלכם, ואתם בגל הראשון.')).toBeVisible();
  await expect(referLink(seeker)).toHaveValue(link);
  await expect(referLink(seeker)).toHaveAttribute('readonly', '');
  await expect(referLink(seeker)).toHaveAttribute('dir', 'ltr');

  const share = whatsapp(seeker);
  await expect(share).toHaveAttribute('target', '_blank');
  await expect(share).toHaveAttribute('rel', 'noopener');
  const href = new URL((await share.getAttribute('href')) ?? '');
  expect(`${href.origin}${href.pathname}`).toBe('https://wa.me/');
  expect(href.searchParams.get('text')).toBe(`${SHARE_MESSAGE} ${link}`);

  await expect(block.locator('.refer__privacy')).toHaveText(REFER_PRIVACY);
  // The forms' privacy line is unchanged.
  for (const line of await page.locator('form .privacy').all()) {
    await expect(line).toContainText(FORM_PRIVACY_START);
  }

  await copyButton(seeker).click();
  await expect(block.getByRole('button', { name: 'הקישור הועתק' })).toBeVisible();
  await expect(block.locator('[aria-live="polite"]')).toHaveText('הקישור הועתק');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  // After 2 s the button says "copy" again.
  await expect(copyButton(seeker)).toBeVisible({ timeout: 4000 });

  // An answer without a code (an older Function) or without a readable body: today's panel, no block.
  for (const fulfil of [
    (route: Route) => json(route, 200, { ok: true }),
    (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: 'not json' }),
  ]) {
    await page.route('**/api/signup', fulfil);
    await open(page);
    await fillSeeker(seeker, 'noa@example.com');
    await submitButton(seeker).click();
    await expect(seeker.getByRole('heading', { name: 'נרשמתם!' })).toBeFocused();
    await expect(seeker.getByText('ברגע שהומי עולה לאוויר. לאט לאט? ממש לא.')).toBeVisible();
    await expect(seeker.getByRole('button', { name: 'גם משכירים? להרשמה גם שם' })).toBeVisible();
    await expect(referBlock(seeker)).toBeHidden();
  }
});

test('ac13d_copy_fallback', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => undefined });
  });
  await page.route('**/api/signup', (route) => json(route, 200, { ok: true, ref: REF }));
  await open(page);
  const seeker = seekerPanel(page);
  await fillSeeker(seeker, 'noa@example.com');
  await submitButton(seeker).click();
  await expect(referLink(seeker)).toBeVisible();

  await copyButton(seeker).click();
  await expect(referLink(seeker)).toBeFocused();
  const selection = await referLink(seeker).evaluate((field: HTMLInputElement) => [
    field.selectionStart,
    field.selectionEnd,
    field.value.length,
  ]);
  expect(selection[0]).toBe(0);
  expect(selection[1]).toBe(selection[2]);
  expect(selection[2]).toBeGreaterThan(0);
  // Nothing else changes: the button keeps its text and nothing is announced.
  await expect(copyButton(seeker)).toBeVisible();
  await expect(referBlock(seeker).locator('[aria-live="polite"]')).toHaveText('');
  expect(errors).toEqual([]);
});
