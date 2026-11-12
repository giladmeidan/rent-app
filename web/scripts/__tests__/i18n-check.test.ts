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

  it('fails on Hebrew in any attribute, not only the checked ones', () => {
    const { status, output } = runOn({
      'C.tsx': 'export const C = () => <EmptyState message="אין אזורים" />;\n',
    });
    expect(status).toBe(1);
    expect(output).toContain('C.tsx:1: hardcoded Hebrew');
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
  it('ac1_plural_family_needs_every_he_form', () => {
    const run = (x: Record<string, unknown>) =>
      runOn({ 'locales/he.json': JSON.stringify({ areas: { heading: 'h' }, ...x }) });

    let { status, output } = run({ x_one: 'a', x_other: 'b' });
    expect(status).toBe(1);
    expect(output).toContain("locales/he.json: plural 'x' is missing the form 'x_two'");

    ({ status, output } = run({ x_one: 'a', x_two: 'b', x_other: 'c' }));
    expect(output).toContain('i18n-check: ok');
    expect(status).toBe(0);
    ({ status } = run({ x_zero: 'z', x_one: 'a', x_two: 'b', x_other: 'c' }));
    expect(status).toBe(0);

    ({ status, output } = run({ x_one: 'a', x_two: 'b', x_many: 'm', x_other: 'c' }));
    expect(status).toBe(1);
    expect(output).toContain("'x_many': he never selects it");

    ({ status, output } = run({ x: 's', x_one: 'a', x_two: 'b', x_other: 'c' }));
    expect(status).toBe(1);
    expect(output).toContain("plural 'x' also exists as a string");
    // The forms sit inside `n`, next to an object `n.x`.
    ({ status, output } = run({
      n: { x: { y: 'o' }, x_one: 'a', x_two: 'b', x_other: 'c' },
    }));
    expect(status).toBe(1);
    expect(output).toContain("plural 'n.x' also exists as an object");
  });

  it('ac1_plural_call_needs_count', () => {
    const he = JSON.stringify({ x_one: 'a', x_two: 'b', x_other: 'c', plain: 'p' });
    const run = (call: string) =>
      runOn({
        'locales/he.json': he,
        'P.tsx': `export const P = ({ n, count, opts, rest }) => <p>{${call}}</p>;\n`,
      });

    for (const call of ["t('x')", "t('x', { other: 1 })"]) {
      const { status, output } = run(call);
      expect(status, call).toBe(1);
      expect(output, call).toContain("P.tsx:1: plural key 'x' called without count");
    }
    for (const call of [
      "t('x', { count: n })",
      "t('x', { count })",
      "t('x', opts)",
      "t('x', { ...rest })",
      "t('plain', { count })",
    ]) {
      const { status, output } = run(call);
      expect(output, call).toContain('i18n-check: ok');
      expect(status, call).toBe(0);
    }
    const { status, output } = run("t('missing', { count })");
    expect(status).toBe(1);
    expect(output).toContain("P.tsx:1: missing key 'missing'");
  });

  it('ac1_ts_files_checked_for_keys', () => {
    let { status, output } = runOn({ 'a.ts': "export const a = t('does.not.exist');\n" });
    expect(status).toBe(1);
    expect(output).toContain("a.ts:1: missing key 'does.not.exist'");

    ({ status, output } = runOn({ 'a.ts': "export const a = '\u05e9\u05dc\u05d5\u05dd';\n" }));
    expect(output).toContain('i18n-check: ok');
    expect(status).toBe(0);

    ({ status, output } = runOn({
      'types.d.ts': "declare const x: string;\nexport const a = t('does.not.exist');\n",
    }));
    expect(output).toContain('i18n-check: ok');
    expect(status).toBe(0);
  });

  it('ac1_later_arguments_and_conditional_keys', () => {
    let { status, output } = runOn({
      'D.tsx':
        "export const D = () => <p>{t('areas.heading', { defaultValue: 'two words' })}</p>;\n",
    });
    expect(status).toBe(1);
    expect(output).toContain('D.tsx:1: hardcoded text "two words"');

    ({ status, output } = runOn({
      'E.tsx': "export const E = ({ c }) => <p>{t(c ? 'areas.heading' : 'nope')}</p>;\n",
    }));
    expect(status).toBe(1);
    expect(output).toContain("E.tsx:1: missing key 'nope'");
    expect(output).not.toContain("'areas.heading'");

    ({ status, output } = runOn({
      'F.tsx': [
        'export const F = () => (',
        '  <>',
        "    <p>don't stop</p>",
        '    <p>(beta) version</p>',
        '  </>',
        ');',
      ].join('\n'),
    }));
    expect(status).toBe(1);
    expect(output).toContain('F.tsx:3:');
    expect(output).toContain('F.tsx:4:');
  });
});
