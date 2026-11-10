import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const checker = join(dirname(fileURLToPath(import.meta.url)), '..', 'i18n-check.mjs');
const dirs: string[] = [];

/** Writes `files` (path → content) plus locales/he.json into a fresh temp dir and runs the checker on it. */
function runOn(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-check-'));
  dirs.push(dir);
  const all = { 'locales/he.json': JSON.stringify({ areas: { heading: 'x' } }), ...files };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  const result = spawnSync(process.execPath, [checker, dir], { encoding: 'utf8' });
  return { status: result.status, output: result.stdout + result.stderr };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('i18n-check', () => {
  it('ac5_fails_on_hardcoded_hebrew', () => {
    const { status, output } = runOn({
      'features/Hello.tsx': 'export const Hello = () => <p>שלום</p>;\n',
    });
    expect(status).not.toBe(0);
    expect(output).toContain('Hello.tsx:1');
  });

  it('ac6_ignores_test_files', () => {
    const test = "it('renders two areas', () => { expect(render(<p>שלום</p>)).toBeTruthy(); });\n";
    const { status, output } = runOn({
      'features/Hello.test.tsx': test,
      'features/__tests__/Other.tsx': test,
    });
    expect(output).toContain('i18n-check: ok');
    expect(status).toBe(0);
  });

  it('ac7_fails_on_missing_key', () => {
    const { status, output } = runOn({
      'features/Keys.tsx':
        "export const K = () => <p>{t('areas.heading')}{t('does.not.exist')}</p>;\n",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("Keys.tsx:1: missing key 'does.not.exist'");
    expect(output).not.toContain("'areas.heading'");
  });

  it('flags two latin words in text and checked attributes only', () => {
    const { status, output } = runOn({
      'A.tsx': [
        'export const A = () => (',
        '  <div className="flex items-center gap-2" data-x="two words">',
        '    <img alt="a house" src="x.svg" />',
        '    Hello world',
        '    <span>OK</span>',
        '  </div>',
        ');',
      ].join('\n'),
    });
    expect(status).toBe(1);
    expect(output).toContain('A.tsx:3:');
    expect(output).toContain('A.tsx:4:');
    expect(output).not.toContain('A.tsx:2:');
    expect(output).not.toContain('A.tsx:5:');
  });

  it('skips the line after an i18n-ignore-next-line comment', () => {
    const { status, output } = runOn({
      'B.tsx': [
        '// i18n-ignore-next-line',
        "const dev = 'not user facing';",
        "const copy = 'user facing text';",
        'export { dev, copy };',
      ].join('\n'),
    });
    expect(status).toBe(1);
    expect(output).not.toContain('B.tsx:2:');
    expect(output).toContain('B.tsx:3:');
  });
});
