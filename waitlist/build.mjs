// public/ → .dist/ with the public contact address and the site's origin written into index.html
// (spec 0017). Run by `make deploy-waitlist`; Node built-ins only. The committed public/index.html keeps
// the placeholders, so no real address is ever committed.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const CONTACT_PLACEHOLDER = 'contact@example.com';
const ORIGIN_PLACEHOLDER = 'https://join.example.com';

function fail(message) {
  process.stderr.write(`build.mjs: ${message}\n`);
  process.exit(1);
}

// The pattern also keeps `<`, `"` and `&` out of the HTML.
const contact = process.env.CONTACT_EMAIL ?? '';
if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(contact) || contact === CONTACT_PLACEHOLDER) {
  fail('CONTACT_EMAIL must be the real public contact address');
}

const toml = readFileSync(join(root, 'wrangler.toml'), 'utf8');
const origin = /^ALLOWED_ORIGIN\s*=\s*"([^"]*)"\s*$/m.exec(toml)?.[1] ?? '';
if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(origin) || origin === ORIGIN_PLACEHOLDER) {
  fail('ALLOWED_ORIGIN in wrangler.toml must be the site https:// origin (README, Setup step 2)');
}

const dist = join(root, '.dist');
rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'public'), dist, { recursive: true });
const page = join(dist, 'index.html');
const html = readFileSync(page, 'utf8')
  .replaceAll(CONTACT_PLACEHOLDER, contact)
  .replaceAll(ORIGIN_PLACEHOLDER, origin);
if (html.includes(CONTACT_PLACEHOLDER) || html.includes(ORIGIN_PLACEHOLDER)) {
  fail('a placeholder is still in .dist/index.html');
}
writeFileSync(page, html);
process.stdout.write(`build.mjs: .dist/ ready for ${origin}\n`);
