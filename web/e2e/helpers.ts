import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, type Page } from '@playwright/test';

import he from '../src/locales/he.json' with { type: 'json' };

// The api's file email backend writes one JSON file per email here (relative to Playwright's cwd,
// web/); `make dev` bind-mounts it into the api container.
const OUTBOX = '../.outbox';

type OutboxMessage = { to: string; subject: string; body: string; sent_at: string };

/** The 6-digit code in the newest outbox email sent to `email`, or null while none has arrived. */
export async function latestCode(email: string): Promise<string | null> {
  let newest: OutboxMessage | null = null;
  for (const name of await readdir(OUTBOX)) {
    if (!name.endsWith('.json')) continue;
    const message = JSON.parse(await readFile(join(OUTBOX, name), 'utf8')) as OutboxMessage;
    if (message.to !== email) continue;
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

type SignUpOptions = {
  /** Where the signup form is opened, e.g. the listing page's `/signup?role=seeker&next=…`. */
  start?: string;
  /** The URL expected after the code is verified. */
  expectUrl?: string;
  /** The display name, to tell two people in one test apart. */
  name?: string;
};

/** Signs up a fresh `role` through the outbox (as 0001b AC7) and returns the address. The page
 * ends on `expectUrl` with the session cookie set. */
export async function signUp(
  page: Page,
  role: 'owner' | 'seeker',
  { start = '/signup', expectUrl = '/', name = '\u05d3\u05e0\u05d4' }: SignUpOptions = {},
): Promise<string> {
  const email = uniqueEmail();
  await page.goto(start);
  await page.getByText(he.auth.role[role], { exact: true }).click();
  await page.getByLabel(he.auth.name.label).fill(name);
  await page.getByLabel(he.auth.email.label).fill(email);
  await page.getByRole('button', { name: he.auth.sendCode }).click();
  const codeInput = page.getByLabel(he.auth.code.label);
  await expect(codeInput).toBeFocused();
  let code: string | null = null;
  await expect
    .poll(async () => (code = await latestCode(email)), { timeout: 10_000 })
    .toMatch(/^\d{6}$/);
  await codeInput.fill(code ?? '');
  await page.getByRole('button', { name: he.auth.verify }).click();
  await expect(page).toHaveURL(expectUrl);
  return email;
}

/** Signs up a fresh owner; the page ends on `/` with the session cookie set. */
export async function signUpOwner(page: Page): Promise<string> {
  return signUp(page, 'owner');
}

/** `YYYY-MM-DD`, `days` from today in Israel. */
function israelDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Posts a live apartment on `street` through the API with the page's (owner) session, as
 * search.spec.ts does; returns its id. */
export async function postListing(page: Page, street: string): Promise<string> {
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
      arnona_ils: null,
      vaad_ils: null,
      description: null,
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  return id;
}
