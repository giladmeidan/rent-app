// Checks a production build (web/dist) against itself (spec 0009e): the PWA manifest and its icons,
// the head tags of index.html, and the service-worker caching policy.
//
// Usage: node scripts/build-check.mjs [distDir]   (default: web/dist; `make build-check`)
//
// Prints one line per problem and exits 1 on any; exits 2 when distDir is missing. That these values
// equal he.json and the brand tokens is pwa.test.ts's job; this script only proves the build is
// complete and consistent.
//
// manifest.webmanifest: id, start_url and scope are `/`, lang `he`, dir `rtl`, display `standalone`;
//   name, short_name and description are non-empty; background_color and theme_color are #RRGGBB;
//   exactly four icons, 192 and 512 for each of `any` and `maskable`, each a PNG file whose IHDR
//   has the declared size.
// index.html: exactly one <title>, equal to the manifest's name; the description and theme-color
//   metas equal the manifest's description and theme_color; the manifest link, apple-touch-icon,
//   SVG favicon, PNG favicon, font preload and /registerSW.js each point at a file that exists.
// sw.js: the AMD header define(["./workbox-<hex>"]) with that runtime file present (an inlined runtime
//   would mangle the class names and hide a runtime strategy); at least one precache entry, with
//   index.html among them; every precache URL a relative path to an existing file, none containing
//   http, sw.js, workbox- or maplibre-gl; exactly one registerRoute( and one NavigationRoute (the
//   app-shell route; the precache route is registered inside precacheAndRoute); no importScripts and
//   no NetworkFirst, NetworkOnly, CacheFirst or StaleWhileRevalidate. The body checks start at the
//   AMD header: the loader shim in front of it calls importScripts to load the runtime itself.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = resolve(
  process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'),
);

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(`${distDir}: no such directory; run make build-web first`);
  process.exit(2);
}

const problems = [];
const fail = (message) => problems.push(message);

/** The dist file a root-relative URL (`/icons/x.png`) or a relative one (`icons/x.png`) points at. */
function fileFor(url) {
  const path = url.split(/[?#]/)[0].replace(/^\/+/, '');
  if (path === '' || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return null;
  const full = normalize(join(distDir, path));
  return full.startsWith(distDir + sep) ? full : null;
}

const isFile = (path) => path !== null && existsSync(path) && statSync(path).isFile();

function read(name) {
  const path = join(distDir, name);
  if (!isFile(path)) {
    fail(`${name}: missing`);
    return null;
  }
  return readFileSync(path, 'utf8');
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** [width, height] from a PNG's IHDR, or null when the file is not a PNG. */
function pngSize(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const decode = (text) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

// ---- manifest.webmanifest ----------------------------------------------------------------------
let manifest = {};
const manifestText = read('manifest.webmanifest');
if (manifestText !== null) {
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    fail(`manifest.webmanifest: not JSON (${error.message})`);
  }
}
if (manifestText !== null) {
  const expected = {
    id: '/',
    start_url: '/',
    scope: '/',
    lang: 'he',
    dir: 'rtl',
    display: 'standalone',
  };
  for (const [key, value] of Object.entries(expected)) {
    if (manifest[key] !== value) {
      fail(`manifest.webmanifest: ${key} is ${JSON.stringify(manifest[key])}, expected "${value}"`);
    }
  }
  for (const key of ['name', 'short_name', 'description']) {
    if (typeof manifest[key] !== 'string' || manifest[key].trim() === '') {
      fail(`manifest.webmanifest: ${key} is empty`);
    }
  }
  for (const key of ['background_color', 'theme_color']) {
    if (typeof manifest[key] !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(manifest[key])) {
      fail(`manifest.webmanifest: ${key} ${JSON.stringify(manifest[key])} is not #RRGGBB`);
    }
  }
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  if (icons.length !== 4) fail(`manifest.webmanifest: ${icons.length} icons, expected 4`);
  for (const purpose of ['any', 'maskable']) {
    for (const size of [192, 512]) {
      const matches = icons.filter(
        (icon) => (icon.purpose ?? 'any') === purpose && icon.sizes === `${size}x${size}`,
      );
      if (matches.length !== 1) {
        fail(
          `manifest.webmanifest: ${matches.length} ${purpose} icons of ${size}x${size}, expected 1`,
        );
      }
    }
  }
  for (const icon of icons) {
    const src = String(icon.src);
    const path = fileFor(src);
    if (!isFile(path)) {
      fail(`manifest.webmanifest: icon ${src} is missing`);
      continue;
    }
    if (icon.type !== 'image/png') fail(`manifest.webmanifest: icon ${src} type is not image/png`);
    const size = pngSize(path);
    const declared = /^(\d+)x(\d+)$/.exec(String(icon.sizes));
    if (size === null) {
      fail(`manifest.webmanifest: icon ${src} is not a PNG`);
    } else if (declared === null) {
      fail(`manifest.webmanifest: icon ${src} sizes ${JSON.stringify(icon.sizes)} is not WxH`);
    } else if (size[0] !== Number(declared[1]) || size[1] !== Number(declared[2])) {
      fail(`manifest.webmanifest: icon ${src} is ${size[0]}x${size[1]}, declared ${icon.sizes}`);
    }
  }
}

// ---- index.html --------------------------------------------------------------------------------
const html = read('index.html');
if (html !== null) {
  /** Every <meta>, <link> and <script> start tag, as a lower-cased attribute map. */
  const tags = [...html.matchAll(/<(meta|link|script)\b([^>]*)>/gi)].map(([, name, rest]) => {
    const attrs = { tag: name.toLowerCase() };
    for (const [, key, d, s, bare] of rest.matchAll(
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g,
    )) {
      attrs[key.toLowerCase()] = decode(d ?? s ?? bare ?? '');
    }
    return attrs;
  });
  const find = (predicate) => tags.filter(predicate);
  const rels = (attrs) => (attrs.rel ?? '').toLowerCase().split(/\s+/);

  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map(([, t]) =>
    decode(t),
  );
  if (titles.length !== 1) fail(`index.html: ${titles.length} <title> elements, expected 1`);
  else if (titles[0] !== manifest.name) {
    fail(`index.html: <title> "${titles[0]}" differs from the manifest name "${manifest.name}"`);
  }

  const metas = (name) => find((t) => t.tag === 'meta' && (t.name ?? '').toLowerCase() === name);
  const description = metas('description');
  if (description.length !== 1)
    fail(`index.html: ${description.length} description metas, expected 1`);
  else if (description[0].content !== manifest.description) {
    fail('index.html: the description meta differs from the manifest description');
  }
  const themeColor = metas('theme-color');
  if (themeColor.length !== 1)
    fail(`index.html: ${themeColor.length} theme-color metas, expected 1`);
  else if (themeColor[0].content !== manifest.theme_color) {
    fail(
      `index.html: theme-color ${themeColor[0].content} differs from the manifest's ${manifest.theme_color}`,
    );
  }

  /** Fails unless at least one tag matches and the first one's `attr` names an existing file. */
  function pointsAtFile(label, matches, attr) {
    if (matches.length === 0) {
      fail(`index.html: no ${label}`);
      return;
    }
    const url = matches[0][attr] ?? '';
    if (!isFile(fileFor(url))) fail(`index.html: the ${label} ${url} is missing from dist`);
  }
  const links = find((t) => t.tag === 'link');
  pointsAtFile(
    'manifest link',
    links.filter((t) => rels(t).includes('manifest')),
    'href',
  );
  pointsAtFile(
    'apple-touch-icon',
    links.filter((t) => rels(t).includes('apple-touch-icon')),
    'href',
  );
  const icons = links.filter((t) => rels(t).includes('icon'));
  pointsAtFile(
    'SVG favicon',
    icons.filter((t) => t.type === 'image/svg+xml'),
    'href',
  );
  pointsAtFile(
    'PNG favicon',
    icons.filter((t) => t.type === 'image/png'),
    'href',
  );
  pointsAtFile(
    'font preload',
    links.filter((t) => rels(t).includes('preload') && t.as === 'font'),
    'href',
  );
  pointsAtFile(
    '/registerSW.js script',
    find((t) => t.tag === 'script' && /(^|\/)registerSW\.js$/.test(t.src ?? '')),
    'src',
  );
}

// ---- sw.js -------------------------------------------------------------------------------------
const sw = read('sw.js');
if (sw !== null) {
  const header = /\bdefine\(\s*\[\s*["']\.\/(workbox-[0-9a-f]+)["']\s*\]/.exec(sw);
  // Everything from the AMD header on; the loader shim before it is workbox-build's own.
  let body = sw;
  if (header === null) {
    fail('sw.js: no define(["./workbox-<hex>"]) header (an inlined runtime hides the strategies)');
  } else {
    body = sw.slice(header.index);
    if (!isFile(join(distDir, `${header[1]}.js`))) fail(`sw.js: ${header[1]}.js is missing`);
  }

  const urls = [...body.matchAll(/(?:\burl\s*:\s*|"url"\s*:\s*)["']([^"']*)["']/g)].map(
    ([, u]) => u,
  );
  if (urls.length === 0) fail('sw.js: no precache entries');
  else if (!urls.includes('index.html')) fail('sw.js: index.html is not precached');
  for (const url of urls) {
    for (const banned of ['http', 'sw.js', 'workbox-', 'maplibre-gl']) {
      if (url.includes(banned)) fail(`sw.js: precache URL ${url} contains ${banned}`);
    }
    if (url.startsWith('/') || url.includes('..') || url.includes('//')) {
      fail(`sw.js: precache URL ${url} is not a relative path`);
    } else if (!isFile(fileFor(url))) {
      fail(`sw.js: precache URL ${url} is missing from dist`);
    }
  }

  const count = (pattern) => body.match(pattern)?.length ?? 0;
  const routes = count(/\bregisterRoute\(/g);
  if (routes !== 1) fail(`sw.js: ${routes} registerRoute( calls, expected 1 (the app-shell route)`);
  const navigation = count(/\bNavigationRoute\b/g);
  if (navigation !== 1) fail(`sw.js: ${navigation} NavigationRoute, expected 1`);
  if (/\bimportScripts\b/.test(body)) fail('sw.js: importScripts loads code beyond the build');
  for (const strategy of ['NetworkFirst', 'NetworkOnly', 'CacheFirst', 'StaleWhileRevalidate']) {
    if (body.includes(strategy))
      fail(`sw.js: runtime strategy ${strategy} (no runtime caching allowed)`);
  }
}

for (const problem of problems) console.log(problem);
if (problems.length > 0) {
  console.log(`build-check: ${problems.length} problem(s) in ${distDir}`);
  process.exit(1);
}
console.log(`build-check: ${distDir} ok`);
