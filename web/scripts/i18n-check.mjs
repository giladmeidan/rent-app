// Fails on hardcoded user-facing strings, on t('key') calls whose key is missing from he.json, and
// on plural families that are incomplete or called without a count.
//
// Usage: node scripts/i18n-check.mjs [srcDir]   (default: web/src; the catalogue is <srcDir>/locales/he.json)
//
// Files: every .tsx and .ts under srcDir except locales/, any __tests__/ directory, *.test.ts(x) and
// *.d.ts. Both are scanned for t() keys; only .tsx is scanned for hardcoded copy.
//
// Hardcoded copy (.tsx): a string literal, template chunk or JSX text is a hit when it contains a
// Hebrew letter or two consecutive Latin words (a word may hold an apostrophe, `don't`, and may be
// wrapped in brackets, `(beta)`). For the Latin check, JSX attribute values are ignored except
// title, placeholder, aria-label and alt; Hebrew fails in any attribute. The key of a t() call is
// not copy, but its later arguments are visited, so `t('k', { defaultValue: 'two words' })` is a
// hit. Only .tsx is scanned for copy, so the other allowed literals (web/public/
// manifest.webmanifest and vite.config.ts, which holds the PWA manifest name) are never read.
//
// Keys (.tsx and .ts): a literal key, or each literal branch of a conditional key
// (`t(c ? 'a.b' : 'c.d')`), must be a string leaf of he.json or the base of a plural family.
// `t(variable)` and template-literal keys are not checked.
//
// Plurals:
//   P1 A leaf whose last segment ends in _zero, _one, _two, _few, _many or _other is a form of its
//      base path (`a.count_one` -> `a.count`). Every family has each category of
//      Intl.PluralRules('he') (read at run time); _zero is optional; a form he never selects is an
//      error; the base path must not also exist as a string or an object.
//   P2 t('base') of a family needs a count: no second argument, or an object literal second argument
//      with neither a `count` property nor a spread, is an error. A non-literal argument passes.
//   P3 t('plain', { count }) on a plain string key passes.
//   P4 Plural and key checks also run on .ts files (copy is still only checked in .tsx).
//
// A line directly below a comment containing `i18n-ignore-next-line` is skipped. Prints
// file:line per hit; exits 1 on any.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HEBREW = /[֐-׿]/;
const LATIN_WORD = /^[([]?[A-Za-z]+(?:'[A-Za-z]+)*[)\]]?[,.!?:;]?$/;
const CHECKED_ATTRIBUTES = new Set(['title', 'placeholder', 'aria-label', 'alt']);
const IGNORE_MARKER = 'i18n-ignore-next-line';
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const HE_CATEGORIES = new Intl.PluralRules('he').resolvedOptions().pluralCategories;

const srcDir = resolve(
  process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src'),
);
const catalogue = JSON.parse(readFileSync(join(srcDir, 'locales', 'he.json'), 'utf8'));

/** Every string leaf of the catalogue as a dotted path. */
function* leaves(node, prefix = '') {
  for (const [name, value] of Object.entries(node)) {
    const path = prefix === '' ? name : `${prefix}.${name}`;
    if (typeof value === 'object' && value !== null) yield* leaves(value, path);
    else yield path;
  }
}

/** The catalogue node at `path`, or undefined. */
function lookup(path) {
  let node = catalogue;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, part)) return undefined;
    node = node[part];
  }
  return node;
}

/** base path -> set of categories present. */
const families = new Map();
for (const path of leaves(catalogue)) {
  const match = PLURAL_SUFFIX.exec(path);
  if (match === null) continue;
  const base = path.slice(0, -match[0].length);
  if (!families.has(base)) families.set(base, new Set());
  families.get(base).add(match[1]);
}

function catalogueProblems() {
  const problems = [];
  for (const [base, forms] of families) {
    for (const category of HE_CATEGORIES) {
      if (!forms.has(category))
        problems.push(`plural '${base}' is missing the form '${base}_${category}'`);
    }
    for (const form of forms) {
      if (form !== 'zero' && !HE_CATEGORIES.includes(form))
        problems.push(`plural '${base}' has the form '${base}_${form}': he never selects it`);
    }
    const clash = lookup(base);
    if (typeof clash === 'string')
      problems.push(`plural '${base}' also exists as a string; a base string hides a missing form`);
    else if (clash !== undefined)
      problems.push(`plural '${base}' also exists as an object; t('${base}') would break`);
  }
  return problems.map((problem) => `locales/he.json: ${problem}`);
}

function hasKey(key) {
  return typeof lookup(key) === 'string' || families.has(key);
}

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== '__tests__' &&
        entry.name !== 'node_modules' &&
        path !== join(srcDir, 'locales')
      ) {
        yield* sourceFiles(path);
      }
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      yield path;
    }
  }
}

function hasTwoLatinWords(text) {
  const words = text.split(/\s+/);
  return words.some((word, i) => LATIN_WORD.test(word) && LATIN_WORD.test(words[i + 1] ?? ''));
}

/** Name of the JSX attribute `node` sits in, or undefined when it is not inside one. */
function enclosingAttribute(node) {
  for (let p = node.parent; p !== undefined; p = p.parent) {
    if (ts.isJsxAttribute(p)) return p.name.getText();
    if (ts.isJsxElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxFragment(p))
      return undefined;
  }
  return undefined;
}

function isTranslateCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === 't') ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 't')
  );
}

/** The literal keys of a t() first argument: a literal, or the literal branches of a conditional. */
function literalKeys(node) {
  while (ts.isParenthesizedExpression(node)) node = node.expression;
  if (ts.isStringLiteralLike(node)) return [node];
  if (ts.isConditionalExpression(node))
    return [...literalKeys(node.whenTrue), ...literalKeys(node.whenFalse)];
  return [];
}

/** True when the t() options argument can carry a count (P2). */
function passesCount(options) {
  if (options === undefined) return false;
  if (!ts.isObjectLiteralExpression(options)) return true; // a variable: not checked
  return options.properties.some(
    (p) =>
      ts.isSpreadAssignment(p) ||
      ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        p.name !== undefined &&
        (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) &&
        p.name.text === 'count'),
  );
}

function checkFile(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const isTsx = path.endsWith('.tsx');
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits = [];
  const report = (node, message) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    if (line > 0 && lines[line - 1].includes(IGNORE_MARKER)) return;
    hits.push(`${relative(process.cwd(), path)}:${line + 1}: ${message}`);
  };

  const skip = new Set();
  const visit = (node) => {
    if (skip.has(node)) return;
    if (isTranslateCall(node) && node.arguments.length > 0) {
      const [first, options] = node.arguments;
      const keys = literalKeys(first);
      for (const key of keys) {
        if (!hasKey(key.text)) report(key, `missing key '${key.text}' in locales/he.json`);
        else if (families.has(key.text) && !passesCount(options))
          report(key, `plural key '${key.text}' called without count`);
      }
      // The literal keys themselves are not copy; everything else in the key argument and every
      // later argument is.
      keys.forEach((key) => skip.add(key));
      visit(first);
      node.arguments.slice(1).forEach(visit);
      return;
    }

    if (isTsx) {
      let value;
      if (
        ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)
      ) {
        value = node.text;
      }
      if (
        value !== undefined &&
        !ts.isImportDeclaration(node.parent) &&
        !ts.isExportDeclaration(node.parent)
      ) {
        // Hebrew fails anywhere; the attribute exemption applies to the Latin heuristic only.
        const attribute = enclosingAttribute(node);
        if (HEBREW.test(value)) report(node, `hardcoded Hebrew ${JSON.stringify(value.trim())}`);
        else if (
          (attribute === undefined || CHECKED_ATTRIBUTES.has(attribute)) &&
          hasTwoLatinWords(value.trim())
        )
          report(node, `hardcoded text ${JSON.stringify(value.trim())}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

const hits = [...catalogueProblems(), ...[...sourceFiles(srcDir)].flatMap(checkFile)];
for (const hit of hits) console.log(hit);
if (hits.length > 0) {
  console.error(`i18n-check: ${hits.length} problem(s); move copy to locales/he.json`);
  process.exit(1);
}
console.log('i18n-check: ok');
