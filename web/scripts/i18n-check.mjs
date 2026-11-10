// Fails on hardcoded user-facing strings and on t('key') calls whose key is missing from he.json.
//
// Usage: node scripts/i18n-check.mjs [srcDir]   (default: web/src; the catalogue is <srcDir>/locales/he.json)
//
// Scans every .tsx under srcDir except locales/, any __tests__/ directory and *.test.tsx. A string
// literal, template chunk or JSX text is a hit when it contains a Hebrew letter or two consecutive
// Latin words. JSX attribute values are ignored except title, placeholder, aria-label and alt.
// Only .tsx is scanned, so the other allowed literals (web/public/manifest.webmanifest and
// vite.config.ts, which holds the PWA manifest name) are never read. A line directly below a
// comment containing `i18n-ignore-next-line` is skipped. Prints file:line per hit; exits 1 on any.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const HEBREW = /[֐-׿]/;
const LATIN_WORD = /^[A-Za-z]+[,.!?:;]?$/;
const CHECKED_ATTRIBUTES = new Set(['title', 'placeholder', 'aria-label', 'alt']);
const IGNORE_MARKER = 'i18n-ignore-next-line';

const srcDir = resolve(
  process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src'),
);
const catalogue = JSON.parse(readFileSync(join(srcDir, 'locales', 'he.json'), 'utf8'));

function* tsxFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== '__tests__' &&
        entry.name !== 'node_modules' &&
        path !== join(srcDir, 'locales')
      ) {
        yield* tsxFiles(path);
      }
    } else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) {
      yield path;
    }
  }
}

function hasKey(key) {
  let node = catalogue;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, part)) return false;
    node = node[part];
  }
  return typeof node === 'string';
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

function checkFile(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  const report = (node, message) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
    if (line > 0 && lines[line - 1].includes(IGNORE_MARKER)) return;
    hits.push(`${relative(process.cwd(), path)}:${line + 1}: ${message}`);
  };

  const visit = (node) => {
    if (isTranslateCall(node)) {
      const [first] = node.arguments;
      if (first !== undefined && ts.isStringLiteralLike(first)) {
        if (!hasKey(first.text)) report(first, `missing key '${first.text}' in locales/he.json`);
        return; // the key itself is not copy
      }
    }

    let value;
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      value = node.text;
    } else if (ts.isJsxText(node)) {
      value = node.text;
    }
    if (
      value !== undefined &&
      !ts.isImportDeclaration(node.parent) &&
      !ts.isExportDeclaration(node.parent)
    ) {
      const attribute = enclosingAttribute(node);
      if (attribute === undefined || CHECKED_ATTRIBUTES.has(attribute)) {
        if (HEBREW.test(value)) report(node, `hardcoded Hebrew ${JSON.stringify(value.trim())}`);
        else if (hasTwoLatinWords(value.trim()))
          report(node, `hardcoded text ${JSON.stringify(value.trim())}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

const hits = [...tsxFiles(srcDir)].flatMap(checkFile);
for (const hit of hits) console.log(hit);
if (hits.length > 0) {
  console.error(`i18n-check: ${hits.length} problem(s); move copy to locales/he.json`);
  process.exit(1);
}
console.log('i18n-check: ok');
