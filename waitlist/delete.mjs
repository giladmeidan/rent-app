// Delete one address from the remote waitlist on request (spec 0017, Setup step 7; `make waitlist-delete`).
// Node built-ins only. The address comes from stdin, never argv or a make variable, so no shell ever sees
// it; it is normalised by validate.js and matched by the hex of its UTF-8 bytes, so it never enters the SQL
// as text. wrangler runs through execFileSync: no shell anywhere.
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import { normaliseEmail } from './public/validate.js';

/** The two statements for one address, or null when it is not a valid address. */
export function deleteStatements(address) {
  const email = normaliseEmail(address);
  if (email === null) return null;
  const hex = Buffer.from(email, 'utf8').toString('hex').toUpperCase();
  const where = `hex(email) = '${hex}'`;
  return {
    count: `SELECT COUNT(*) AS matching FROM signups WHERE ${where}`,
    remove: `DELETE FROM signups WHERE ${where}`,
  };
}

function fail(message) {
  process.stderr.write(`delete.mjs: ${message}\n`);
  process.exit(1);
}

/** Runs one statement on the remote D1 and returns wrangler's JSON result for it. */
function d1(version, sql) {
  const out = execFileSync(
    'pnpm',
    ['--silent', 'dlx', `wrangler@${version}`, 'd1', 'execute', 'homie-waitlist', '--remote', '--yes', '--json', '--command', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const start = out.search(/^\[/m);
  try {
    return JSON.parse(out.slice(start))[0];
  } catch {
    return fail(`could not read wrangler's answer:\n${out}`);
  }
}

/** The first line of stdin: a typed line ends at Enter, a piped one at its newline. */
async function firstLine() {
  const lines = createInterface({ input: process.stdin, terminal: false });
  for await (const line of lines) {
    lines.close();
    return line;
  }
  return '';
}

async function main() {
  const version = process.env.WRANGLER_VERSION ?? '';
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail('run it as `make waitlist-delete` (WRANGLER_VERSION is unset)');
  if (process.stdin.isTTY) process.stderr.write('The address to delete, then Enter: ');
  const address = await firstLine();
  const statements = deleteStatements(address);
  if (statements === null) fail('that is not a valid email address; nothing was deleted');

  const count = () => Number(d1(version, statements.count)?.results?.[0]?.matching ?? NaN);
  const matching = count();
  if (!Number.isFinite(matching)) fail('could not count the matching rows; nothing was deleted');
  process.stdout.write(`matching rows: ${matching} (one per side the address joined)\n`);
  if (matching === 0) return;
  d1(version, statements.remove);
  const left = count();
  process.stdout.write(`deleted; matching rows now: ${left}\n`);
  if (left !== 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
