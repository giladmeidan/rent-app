import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

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
