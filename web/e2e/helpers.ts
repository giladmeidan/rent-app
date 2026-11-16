import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };

// The api's file email backend writes one JSON file per email here (relative to Playwright's cwd,
// web/); `make dev` bind-mounts it into the api container.
const OUTBOX = '../.outbox';

type OutboxMessage = {
  to: string;
  subject: string;
  body: string;
  sent_at: string;
  attachments?: { filename: string; content_type: string; content: string }[];
};

/** The 6-digit code in the newest outbox email sent to `email`, or null while none has arrived. */
export async function latestCode(email: string): Promise<string | null> {
  let newest: OutboxMessage | null = null;
  for (const name of await readdir(OUTBOX)) {
    if (!name.endsWith('.json')) continue;
    const message = JSON.parse(await readFile(join(OUTBOX, name), 'utf8')) as OutboxMessage;
    if (message.to !== email) continue;
    if (!/\b\d{6}\b/.test(message.body)) continue; // a tour email (spec 0018c), not a code
    if (newest === null || Date.parse(message.sent_at) > Date.parse(newest.sent_at)) {
      newest = message;
    }
  }
  return newest?.body.match(/\b\d{6}\b/)?.[0] ?? null;
}

/** A fresh address per run, so a signup never meets an existing account. */
export function uniqueEmail(): string {
  return `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

// `localhost`, not 127.0.0.1, so the session cookie set for the web's site is sent with
// `page.request`. `make e2e` exports API_PORT.
export const API = 'http://localhost:' + (process.env.API_PORT ?? '8000');

/** Clicks "שליחת קוד", waits for that `POST /auth/otp/request` and asserts its 204, then asserts
 * the code field has focus and returns it. A refused request (429: the OTP budget per IP) fails
 * here with its status, not as a missing code field. */
export async function requestCode(page: Page): Promise<Locator> {
  const [answer] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/auth/otp/request',
    ),
    page.getByRole('button', { name: he.auth.sendCode }).click(),
  ]);
  expect(answer.status(), 'POST /auth/otp/request').toBe(204);
  const codeInput = page.getByLabel(he.auth.code.label);
  await expect(codeInput).toBeFocused();
  return codeInput;
}

type SignUpOptions = {
  /** Where the signup form is opened, e.g. the listing page's `/signup?role=seeker&next=…`. */
  start?: string;
  /** The URL expected after the code is verified. Default: the role's home (an owner's
   * `/me/listings`, a seeker's `/search`), where `/` sends a signed-in person (spec 0009a). */
  expectUrl?: string;
  /** The display name, to tell two people in one test apart. */
  name?: string;
  /** Signup from the market (spec 0010b): opens `/signup?next=%2Fmarket`, where no role is asked
   * (the account is stored as a seeker), and ends on `/market` unless `start` / `expectUrl` say
   * otherwise. `role` must be `'seeker'`. */
  market?: boolean;
};

/** Signs up a fresh `role` through the outbox (as 0001b AC7) and returns the address. The page
 * ends on `expectUrl` with the session cookie set. `{ market: true }`: from the market, with no
 * role question (spec 0010b). */
export async function signUp(
  page: Page,
  role: 'owner' | 'seeker',
  {
    market = false,
    start = market ? '/signup?next=%2Fmarket' : '/signup',
    expectUrl = market ? '/market' : role === 'owner' ? '/me/listings' : '/search',
    name = '\u05d3\u05e0\u05d4',
  }: SignUpOptions = {},
): Promise<string> {
  expect(market && role !== 'seeker', 'a market signup stores a seeker').toBe(false);
  const email = uniqueEmail();
  await page.goto(start);
  if (market) {
    await expect(page.getByRole('group', { name: he.auth.role.label })).toHaveCount(0);
  } else {
    await page.getByText(he.auth.role[role], { exact: true }).click();
  }
  await page.getByLabel(he.auth.name.label).fill(name);
  await page.getByLabel(he.auth.email.label).fill(email);
  const codeInput = await requestCode(page);
  let code: string | null = null;
  await expect
    .poll(async () => (code = await latestCode(email)), { timeout: 10_000 })
    .toMatch(/^\d{6}$/);
  await codeInput.fill(code ?? '');
  await page.getByRole('button', { name: he.auth.verify }).click();
  await expect(page).toHaveURL(expectUrl);
  return email;
}

/** Signs up a fresh owner; the page ends on `/me/listings` (the owner's home, via `/`) with the
 * session cookie set. */
export async function signUpOwner(page: Page): Promise<string> {
  return signUp(page, 'owner');
}

/** Signs up a fresh `role` through the API with the page's context (`page.request` shares its
 * cookie jar), so the page is signed in; returns the address. For a person whose signup is not
 * what the test is about: no page load, no form. It does not navigate. `{ market: true }` stores a
 * seeker, as the market's UI signup does. */
export async function signUpApi(
  page: Page,
  role: 'owner' | 'seeker',
  { name = '\u05d3\u05e0\u05d4', market = false }: Pick<SignUpOptions, 'name' | 'market'> = {},
): Promise<string> {
  expect(market && role !== 'seeker', 'a market signup stores a seeker').toBe(false);
  const email = uniqueEmail();
  const requested = await page.request.post(API + '/auth/otp/request', { data: { email } });
  expect(requested.status(), 'POST /auth/otp/request').toBe(204);
  let code: string | null = null;
  await expect
    .poll(async () => (code = await latestCode(email)), { timeout: 10_000 })
    .toMatch(/^\d{6}$/);
  const verified = await page.request.post(API + '/auth/otp/verify', {
    data: { email, code, profile: { display_name: name, role } },
  });
  expect(verified.status(), 'POST /auth/otp/verify').toBe(201);
  expect(await verified.json()).toMatchObject({ display_name: name, role });
  return email;
}

/** Creates (or rotates) the invite link of the room `listingId` through the API with the page's
 * (owner) session (0008d) and returns its token; a caller builds the link as
 * `/flatmates/join#${token}`. */
export async function createInvite(page: Page, listingId: string): Promise<string> {
  const created = await page.request.post(`${API}/listings/${listingId}/flatmate-invite`);
  expect(created.status()).toBe(201);
  const { token } = (await created.json()) as { token: string };
  return token;
}

/** `YYYY-MM-DD`, `days` from today in Israel. */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Posts a live apartment on `street` through the API with the page's (owner) session, as
 * search.spec.ts does; returns its id. `overrides` replace fields of the body (e.g. `price_ils`). */
export async function postListing(
  page: Page,
  street: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const areas = await page.request.get(API + '/areas');
  expect(areas.ok()).toBe(true);
  const [area] = (await areas.json()) as { id: string }[];
  expect(area).toBeDefined();
  const created = await page.request.post(API + '/listings', {
    data: {
      listing_type: 'apartment',
      area_id: area?.id,
      city: '\u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd',
      street,
      rooms: 3.5,
      floor: 3,
      total_floors: 5,
      size_sqm: 95,
      price_ils: 7200,
      available_from: israelDay(30),
      entry_flexible: false,
      elevator: true,
      parking_spots: 1,
      furnished: 'partial',
      pets_allowed: true,
      shelter: 'none', // required since 0015b
      arnona_ils: null,
      vaad_ils: null,
      description: null,
      ...overrides,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  return id;
}

/** Saves a housing profile (spec 0006a `P`: budget 7500, a couple, no pets, non-smoker, 24 months,
 * one parking spot, the first area) through the API with the page's (seeker) session, so the
 * seeker can apply. `overrides` replace or add fields of the body (e.g. `{ gender: 'man' }`, or
 * 0007a's room section: `gender`, `birth_year`, `lifestyle`). PUT replaces the whole profile:
 * without `overrides` the room section is cleared. */
export async function putProfile(
  page: Page,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const areas = await page.request.get(API + '/areas');
  expect(areas.ok()).toBe(true);
  const [area] = (await areas.json()) as { id: string }[];
  expect(area).toBeDefined();
  const saved = await page.request.put(API + '/me/profile', {
    data: {
      budget_max_ils: 7500,
      move_in_date: israelDay(30),
      move_in_flexible: false,
      area_ids: [area?.id],
      household: 'couple',
      has_pets: false,
      smoker: false,
      contract_months: 24,
      parking_needed: 1,
      ...overrides,
    },
  });
  expect(saved.status()).toBe(200);
}

/** Likes a person for a room through the API with the page's (owner) session: `personId` is the
 * `id` of a card on `GET /listings/{id}/people` (spec 0008a). The like is an invite (spec 0010l):
 * it never creates an application; the person's application answers it. */
export async function likePerson(page: Page, listingId: string, personId: string): Promise<void> {
  const liked = await page.request.put(`${API}/listings/${listingId}/people/${personId}/like`);
  expect(liked.status()).toBe(200);
  expect(await liked.json()).toEqual({ liked: true });
}

// A 1x1 transparent PNG: every OSM tile is answered locally, so a run never calls OpenStreetMap.
export const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** Every OSM tile (MapLibre's workers included) is the 1x1 PNG, except the first `failing`
 * requests, answered 500. Routed on the page's context, so every page in it is covered. */
export async function routeTiles(page: Page, failing = 0) {
  let seen = 0;
  await page.context().route('https://tile.openstreetmap.org/**', (route) => {
    seen += 1;
    return seen <= failing
      ? route.fulfill({ status: 500, body: '' })
      : route.fulfill({ status: 200, contentType: 'image/png', body: TILE });
  });
}

// Google Identity Services, stubbed (spec 0016b): `initialize` keeps the callback and `renderButton`
// draws a plain button that hands the page `window.__GSI_CREDENTIAL__` (set with `addInitScript`).
const GIS_STUB = `window.google = { accounts: { id: {
  initialize: (cfg) => { window.__GSI_CFG__ = cfg; },
  renderButton: (el) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Google (stub)';
    button.addEventListener('click', () =>
      window.__GSI_CFG__.callback({ credential: window.__GSI_CREDENTIAL__ }));
    el.replaceChildren(button);
  },
} } };`;

/** The stub button's accessible name. */
export const GIS_STUB_BUTTON = 'Google (stub)';

/** Answers Google's GIS script with the stub and aborts every other `accounts.google.com` request,
 * for every page of `context`: no e2e test reaches Google (CI renders the button). */
export async function routeGis(context: BrowserContext) {
  await context.route('https://accounts.google.com/**', (route) =>
    route.request().url() === 'https://accounts.google.com/gsi/client'
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: GIS_STUB })
      : route.abort(),
  );
}

/**
 * The latitude `px` screen pixels north of `lat` at `zoom`, by Web Mercator with MapLibre's 512 px
 * tiles (about 1.01 m per px at zoom 16 and latitude 32). Spec 0009w: a map centred there shows a
 * pin at `lat` `px` below the map's centre.
 */
export function latNorthBy(lat: number, px: number, zoom: number): number {
  const world = 512 * 2 ** zoom;
  const phi = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * world - px;
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) * 180) / Math.PI;
}

/**
 * How far below a phone map's centre a pin sits inside the docked card's band: its centre 92 px
 * above the map's bottom edge, while the card is docked 32 px up (`bottom-8`) and is at least
 * ~150 px tall, so the 44 px pin starts fully covered.
 */
export const intoTheDockedCard = (mapHeight: number) => mapHeight / 2 - 92;
