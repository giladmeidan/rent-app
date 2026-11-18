import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const checker = join(dirname(fileURLToPath(import.meta.url)), '..', 'build-check.mjs');
const headers = readFileSync(join(dirname(checker), '..', 'public', '_headers'), 'utf8');
const dirs: string[] = [];

type Files = Map<string, string | Buffer>;

/** A PNG signature and IHDR chunk; enough for the checker, which reads only the header. */
function png(width: number, height = width): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

const ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

const MANIFEST = {
  id: '/',
  name: 'App',
  short_name: 'App',
  description: 'An app',
  lang: 'he',
  dir: 'rtl',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#FFFFFF',
  theme_color: '#FFFFFF',
  icons: ICONS,
};

const HTML = `<!doctype html>
<html lang="he" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <title>App</title>
    <meta name="description" content="An app">
    <meta name="theme-color" content="#FFFFFF">
    <link rel="preload" as="font" type="font/woff2" crossorigin href="/assets/rubik-hebrew-wght-normal-abc.woff2">
  <link rel="manifest" href="/manifest.webmanifest"><script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script></head>
  <body><div id="root"></div></body>
</html>
`;

// workbox-build's AMD loader shim; it calls importScripts itself, which the checker must tolerate.
const SHIM =
  'if(!self.define){let e,s={};const i=(i,n)=>(i=new URL(i+".js",n).href,s[i]||new Promise(s=>{if("document"in self){const e=document.createElement("script");e.src=i,e.onload=s,document.head.appendChild(e)}else e=i,importScripts(i),s()}).then(()=>{let e=s[i];if(!e)throw new Error(`Module ${i} didn’t register its module`);return e}));self.define=(n,r)=>{const t=e||("document"in self?document.currentScript.src:"")||location.href;if(s[t])return;let o={};const l=e=>i(e,t),u={module:{uri:t},exports:o,require:l};s[t]=Promise.all(n.map(e=>u[e]||l(e))).then(e=>(r(...e),o))}}';
const ENTRIES =
  '{url:"registerSW.js",revision:"1"},{url:"index.html",revision:"2"},{url:"assets/index-abc.js",revision:null},{url:"icons/icon-192.png",revision:"3"}';
const ROUTE =
  'e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html"),{denylist:[/^\\/api\\//]}))';
const SW = `${SHIM}define(["./workbox-abc"],function(e){"use strict";self.skipWaiting(),e.clientsClaim(),e.precacheAndRoute([${ENTRIES}],{}),e.cleanupOutdatedCaches(),${ROUTE}});\n`;

function good(): Files {
  return new Map<string, string | Buffer>(
    Object.entries({
      _headers: headers,
      'index.html': HTML,
      'manifest.webmanifest': JSON.stringify(MANIFEST),
      'sw.js': SW,
      'workbox-abc.js': 'define(["exports"],function(t){});\n',
      'registerSW.js': "navigator.serviceWorker.register('/sw.js', { scope: '/' })\n",
      'assets/index-abc.js': 'console.log(1);\n',
      'assets/maplibre-gl-abc.js': 'console.log(2);\n',
      'assets/rubik-hebrew-wght-normal-abc.woff2': Buffer.from('wOF2'),
      'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
      'icons/icon-192.png': png(192),
      'icons/icon-512.png': png(512),
      'icons/icon-maskable-192.png': png(192),
      'icons/icon-maskable-512.png': png(512),
      'icons/apple-touch-icon.png': png(180),
      'icons/favicon-32.png': png(32),
    }),
  );
}

function run(dir: string) {
  const result = spawnSync(process.execPath, [checker, dir], { encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

/** Writes the `good` template, with `mutate` applied, into a fresh temp dir and runs the checker on it. */
function runOn(mutate: (files: Files) => void = () => {}) {
  const files = good();
  mutate(files);
  const dir = mkdtempSync(join(tmpdir(), 'build-check-'));
  dirs.push(dir);
  for (const [path, content] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return run(dir);
}

const edit = (name: string, from: string | RegExp, to: string) => (files: Files) => {
  const before = String(files.get(name));
  const after = before.replace(from, to);
  if (after === before) throw new Error(`fixture edit did not change ${name}: ${String(from)}`);
  files.set(name, after);
};
const html = (from: string | RegExp, to: string) => edit('index.html', from, to);
const sw = (from: string | RegExp, to: string) => edit('sw.js', from, to);
const manifest = (change: (m: typeof MANIFEST) => void) => (files: Files) => {
  const m = structuredClone(MANIFEST);
  change(m);
  files.set('manifest.webmanifest', JSON.stringify(m));
};
const remove = (name: string) => (files: Files) => {
  files.delete(name);
};

/** [defect, mutation of the good template, a line the checker must print]. */
const DEFECTS: [string, (files: Files) => void, string][] = [
  ['no <title>', html('<title>App</title>', ''), '0 <title> elements'],
  ['two <title>s', html('<title>App</title>', '<title>App</title><title>App</title>'), '2 <title>'],
  [
    'a <title> unlike the name',
    html('<title>App</title>', '<title>Other</title>'),
    'differs from the manifest name',
  ],
  ['no description', html(/<meta name="description"[^>]*>/, ''), '0 description metas'],
  [
    'a theme-color unlike the manifest',
    html('content="#FFFFFF"', 'content="#000000"'),
    'theme-color #000000 differs',
  ],
  [
    'no manifest link',
    html('<link rel="manifest" href="/manifest.webmanifest">', ''),
    'no manifest link',
  ],
  ['no apple-touch-icon', html(/<link rel="apple-touch-icon"[^>]*>/, ''), 'no apple-touch-icon'],
  ['no SVG favicon', html(/<link rel="icon" href="\/favicon.svg"[^>]*>/, ''), 'no SVG favicon'],
  [
    'no PNG favicon',
    html(/<link rel="icon" href="\/icons\/favicon-32.png"[^>]*>/, ''),
    'no PNG favicon',
  ],
  ['no preload', html(/<link rel="preload"[^>]*>/, ''), 'no font preload'],
  [
    'a preload of a missing file',
    remove('assets/rubik-hebrew-wght-normal-abc.woff2'),
    'the font preload /assets/rubik-hebrew-wght-normal-abc.woff2 is missing',
  ],
  [
    'no registerSW.js',
    html(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/, ''),
    'no /registerSW.js script',
  ],
  [
    'an icon file missing',
    remove('icons/icon-maskable-512.png'),
    'icon /icons/icon-maskable-512.png is missing',
  ],
  [
    'an icon of 191 px',
    (files) => void files.set('icons/icon-192.png', png(191)),
    'icon /icons/icon-192.png is 191x191, declared 192x192',
  ],
  ['three icons', manifest((m) => void m.icons.pop()), '3 icons, expected 4'],
  ['dir ltr', manifest((m) => void (m.dir = 'ltr')), 'dir is "ltr", expected "rtl"'],
  [
    'no define(["./workbox-…"]) header',
    sw('define(["./workbox-abc"],', 'define([],'),
    'no define(["./workbox-<hex>"]) header',
  ],
  ['a missing workbox runtime', remove('workbox-abc.js'), 'workbox-abc.js is missing'],
  [
    'NetworkFirst',
    sw('e.cleanupOutdatedCaches(),', 'e.cleanupOutdatedCaches(),new e.NetworkFirst,'),
    'runtime strategy NetworkFirst',
  ],
  [
    'two registerRoute( calls',
    sw('e.cleanupOutdatedCaches(),', 'e.cleanupOutdatedCaches(),e.registerRoute(/x/,h),'),
    '2 registerRoute( calls',
  ],
  [
    'importScripts',
    sw('"use strict";', '"use strict";importScripts("https://cdn.example/x.js");'),
    'importScripts',
  ],
  [
    'a precache URL starting with http',
    sw('{url:"index.html"', '{url:"https://api.example/me",revision:"9"},{url:"index.html"'),
    'precache URL https://api.example/me contains http',
  ],
  [
    'a precache URL sw.js',
    sw('{url:"index.html"', '{url:"sw.js",revision:"9"},{url:"index.html"'),
    'precache URL sw.js contains sw.js',
  ],
  [
    'a precache URL containing maplibre-gl',
    sw('{url:"index.html"', '{url:"assets/maplibre-gl-abc.js",revision:null},{url:"index.html"'),
    'contains maplibre-gl',
  ],
  ['zero precache entries', sw(ENTRIES, ''), 'no precache entries'],
  [
    'no index.html entry',
    sw('{url:"index.html",revision:"2"},', ''),
    'index.html is not precached',
  ],
  ['zero NavigationRoutes', sw('new e.NavigationRoute(', 'new e.Route('), '0 NavigationRoute'],
  [
    'two NavigationRoutes',
    sw('e.cleanupOutdatedCaches(),', 'e.cleanupOutdatedCaches(),new e.NavigationRoute(h),'),
    '2 NavigationRoute',
  ],
  [
    'an unminified "url": entry for a missing file',
    sw('{url:"index.html"', '{"url": "assets/gone.js", "revision": null},{url:"index.html"'),
    'precache URL assets/gone.js is missing from dist',
  ],
];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// Each case spawns the checker in a fresh node process; a busy machine or CI runner overruns vitest's 5 s default.
describe('ac6_good_passes_and_each_defect_fails', { timeout: 30_000 }, () => {
  it('the good template passes', () => {
    const { status, output } = runOn();
    expect(output).toContain('ok');
    expect(status).toBe(0);
  });

  it.each(DEFECTS)('%s fails', (_defect, mutate, line) => {
    const { status, output } = runOn(mutate);
    expect(output).toContain(line);
    expect(status).toBe(1);
  });

  it('a missing directory exits 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-check-'));
    rmSync(dir, { recursive: true });
    const { status, output } = run(dir);
    expect(output).toContain('run make build-web first');
    expect(status).toBe(2);
  });
});

describe('ac10_no_source_maps_served', { timeout: 30_000 }, () => {
  it('a .map file anywhere in dist fails; none passes', () => {
    const withMap = runOn((files) => void files.set('assets/index-abc.js.map', '{}'));
    expect(withMap.output).toContain('assets/index-abc.js.map: source map must not be served');
    expect(withMap.status).toBe(1);

    const without = runOn();
    expect(without.output).not.toContain('source map');
    expect(without.status).toBe(0);
  });
});

describe('ac7_pages_headers', { timeout: 30_000 }, () => {
  const onlyProblem = (output: string) => {
    expect(output).toContain('build-check: 1 problem(s)');
    return output.split('\n')[0];
  };

  it('ac7_headers_present', () => {
    const { status, output } = runOn();
    expect(output).not.toContain('_headers');
    expect(status).toBe(0);

    const missing = runOn(remove('_headers'));
    expect(onlyProblem(missing.output)).toBe('_headers: missing');
    expect(missing.status).toBe(1);
  });

  it.each([
    ['/*', 'X-Frame-Options: DENY', 'X-Frame-Options: SAMEORIGIN', 'X-Frame-Options differs'],
    [
      '/*',
      "script-src 'self' ",
      "script-src 'self' 'unsafe-eval' ",
      'Content-Security-Policy differs',
    ],
    ['/assets/*', ', immutable', '', 'Cache-Control differs'],
  ])('ac7_header_changed_fails: %s %s', (path, from, to, line) => {
    const { status, output } = runOn(edit('_headers', from, to));
    expect(onlyProblem(output)).toBe(`_headers: ${path} ${line} from the expected value`);
    expect(status).toBe(1);
  });

  it('ac7_header_changed_fails: a removed header or path', () => {
    const header = runOn(edit('_headers', /^ {2}X-Content-Type-Options:.*\n/m, ''));
    expect(onlyProblem(header.output)).toBe('_headers: /* has no X-Content-Type-Options');
    expect(header.status).toBe(1);

    const path = runOn(edit('_headers', /^\/sw\.js\n.*\n/m, ''));
    expect(onlyProblem(path.output)).toBe('_headers: /sw.js has no Cache-Control');
    expect(path.status).toBe(1);
  });

  it('ac7_404_html_fails', () => {
    const { status, output } = runOn((files) => void files.set('404.html', '<!doctype html>'));
    expect(onlyProblem(output)).toContain('404.html: must not exist');
    expect(status).toBe(1);
  });
});
