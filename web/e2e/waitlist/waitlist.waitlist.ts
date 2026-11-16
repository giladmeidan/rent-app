import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import { expectNoAxeViolations } from '../a11y';

// The waitlist page (spec 0017), served from waitlist/public by playwright.waitlist.config.ts. Every
// API call is stubbed; the page gets the real `_headers` CSP, and any request that leaves the page's
// own origin fails the test (AC17).

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

type Guard = { foreign: string[]; cspViolations: string[] };
const guards = new WeakMap<Page, Guard>();

test.beforeEach(async ({ page }) => {
  const guard: Guard = { foreign: [], cspViolations: [] };
  guards.set(page, guard);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) guard.foreign.push(request.url());
  });
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy'))
      guard.cspViolations.push(message.text());
  });
  // The deployed page carries `_headers`' CSP; the python server sends none, so add it here.
  await page.route(
    (url) => url.port === '4179' && (url.pathname === '/' || url.pathname.endsWith('.html')),
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': CSP },
      });
    },
  );
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

  // The deep link.
  await open(page, '/?side=lister');
  await expect(listerTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(listerPanel(page)).toBeVisible();

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
  await expect(lister.getByRole('button', { name: 'גם מחפשים? להרשמה גם שם' })).toBeVisible();
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

  // A file that fails to load leaves the poster and a line saying so.
  await video.dispatchEvent('error');
  await expect(page.getByText('הסרטון לא נטען. אפשר לנסות שוב מאוחר יותר.')).toBeVisible();
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

    await page.route('**/api/signup', (route) => json(route, 200, { ok: true }));
    await submitButton(seekerPanel(page)).click();
    await expect(seekerPanel(page).getByRole('heading', { name: 'נרשמתם!' })).toBeFocused();
    await expectNoAxeViolations(page, `success ${size}`);
  }

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
  await page.route('**/api/signup', (route) => json(route, 200, { ok: true }));
  await open(page);
  await revealAll(page);
  await page.getByRole('button', { name: 'צפייה בסרטון' }).click();
  await fillSeeker(seekerPanel(page));
  await submitButton(seekerPanel(page)).click();
  await expect(seekerPanel(page).getByRole('heading', { name: 'נרשמתם!' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  // Fonts, images, the poster and both APIs were all fetched, and only from the page's own origin.
  const origin = new URL(page.url()).origin;
  expect(seen.length).toBeGreaterThan(10);
  for (const url of seen) {
    if (url.startsWith('data:')) continue;
    expect(url.startsWith(`${origin}/`), url).toBe(true);
  }
  expect(seen.some((url) => url.endsWith('.woff2'))).toBe(true);
  // The afterEach guard also fails on any CSP violation under `_headers`' policy.
});
