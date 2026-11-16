// public/ → .dist/ with the public contact address, the site's origin (spec 0017) and the Turnstile site
// key (0017b) written into index.html. Run by `make deploy-waitlist`; Node built-ins only. The committed
// public/index.html keeps the placeholders, so no real address or key is ever committed.
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const CONTACT_PLACEHOLDER = 'contact@example.com';
const ORIGIN_PLACEHOLDER = 'https://join.example.com';
const SITE_KEY_PLACEHOLDER = 'TURNSTILE_SITE_KEY_PLACEHOLDER';
/** Cloudflare's test site keys (pass, fail, invisible, forced challenge): never on a real deploy. */
const TEST_SITE_KEY = /^[123]x0{20}[A-F]{2}$/;

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

// The pattern also keeps the key HTML-safe. A test key passes only for a `.test` origin (RFC 6761: never a
// real deploy), the one README's local try uses.
const siteKey = process.env.TURNSTILE_SITE_KEY ?? '';
if (!/^[0-9A-Za-z_-]{10,64}$/.test(siteKey) || siteKey === SITE_KEY_PLACEHOLDER) {
  fail("TURNSTILE_SITE_KEY must be the Turnstile widget's site key (README, Setup step 4)");
}
if (TEST_SITE_KEY.test(siteKey) && !new URL(origin).hostname.endsWith('.test')) {
  fail('TURNSTILE_SITE_KEY is a Cloudflare test key: use the real site key (test keys only with a .test origin)');
}

const dist = join(root, '.dist');
rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'public'), dist, { recursive: true });
const page = join(dist, 'index.html');
const html = readFileSync(page, 'utf8')
  .replaceAll(CONTACT_PLACEHOLDER, contact)
  .replaceAll(ORIGIN_PLACEHOLDER, origin)
  .replaceAll(SITE_KEY_PLACEHOLDER, siteKey);
if (
  html.includes(CONTACT_PLACEHOLDER) ||
  html.includes(ORIGIN_PLACEHOLDER) ||
  html.includes(SITE_KEY_PLACEHOLDER)
) {
  fail('a placeholder is still in .dist/index.html');
}
writeFileSync(page, html);
process.stdout.write(`build.mjs: .dist/ ready for ${origin}\n`);
