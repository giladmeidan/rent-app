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

/** Signs up a fresh owner through the outbox (as 0001b AC7) and returns the address. The page ends
 * on `/` with the session cookie set. */
export async function signUpOwner(page: Page): Promise<string> {
  const email = uniqueEmail();
  await page.goto('/signup');
  await page.getByText(he.auth.role.owner, { exact: true }).click();
  await page.getByLabel(he.auth.name.label).fill('\u05d3\u05e0\u05d4');
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
  await expect(page).toHaveURL('/');
  return email;
}
