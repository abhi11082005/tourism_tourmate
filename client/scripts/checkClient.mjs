#!/usr/bin/env node
/*
 * Offline sanity checker for the React client.
 *
 * The sandbox has no npm registry access, so `vite build` cannot run. This does
 * the checks that catch the mistakes a build would have caught:
 *   1. bracket balance, using a tokenizer that skips strings, template literals,
 *      comments and regex literals;
 *   2. every relative import resolves to a file that exists;
 *   3. every named import exists as an export in the target module;
 *   4. every `api.<name>(` call exists on the api object;
 *   5. no leftover PLACEHOLDER markers.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const ROOT = resolve(process.argv[2] ?? 'src');
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(js|jsx)$/.test(entry)) files.push(full);
  }
})(ROOT);

const problems = [];
const report = (file, msg) => problems.push(`${relative(process.cwd(), file)}: ${msg}`);

/** Strip strings/comments/regex so bracket counting is meaningful. */
function stripLiterals(src) {
  let out = '';
  let i = 0;
  let prevSignificant = '';
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i += 1;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
      out += '""';
      prevSignificant = '"';
      continue;
    }
    if (c === '`') {
      // Template literal: keep ${...} contents, they carry real brackets.
      i += 1;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          let depth = 1;
          out += '${';
          i += 2;
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth += 1;
            if (src[i] === '}') depth -= 1;
            out += src[i];
            i += 1;
          }
          continue;
        }
        i += 1;
      }
      i += 1;
      prevSignificant = '`';
      continue;
    }
    if (c === '/' && /[=(,:[!&|?{};+\-*%\n]/.test(prevSignificant || '\n')) {
      // Regex literal (heuristic on the previous significant character).
      // '>' is deliberately NOT a regex-start context here: in JSX, text like
      // `<span>/seat</span>` would otherwise swallow the closing tag.
      let j = i + 1;
      let closed = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '[') {
          while (j < src.length && src[j] !== ']') j += 1;
        }
        if (src[j] === '/') {
          closed = true;
          break;
        }
        j += 1;
      }
      if (closed) {
        i = j + 1;
        out += 'RE';
        prevSignificant = 'E';
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) prevSignificant = c;
    i += 1;
  }
  return out;
}

const PAIRS = { ')': '(', ']': '[', '}': '{' };

/**
 * JSX tag balance. Runs on the literal-stripped source, so an arrow function
 * inside an attribute (`onChange={(e) => ...}`) sits at brace depth > 0 and its
 * `>` is not mistaken for the end of a tag. A `<` only starts a tag when the very
 * next character is a letter, `/` or `>`, which keeps comparisons like
 * `date < today` out of the way.
 */
function checkJsx(src, file) {
  const stack = [];
  let line = 1;
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === '\n') line += 1;
    if (src[i] !== '<' || !/[A-Za-z/>]/.test(src[i + 1] ?? '')) continue;

    const closing = src[i + 1] === '/';
    let j = i + 1 + (closing ? 1 : 0);
    const name = /^[A-Za-z][\w.]*/.exec(src.slice(j))?.[0] ?? '';
    j += name.length;

    // Walk to the '>' that closes this tag, ignoring anything nested in braces.
    let depth = 0;
    let selfClosing = false;
    while (j < src.length) {
      const c = src[j];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (depth === 0 && c === '>') {
        selfClosing = src[j - 1] === '/';
        break;
      } else if (depth === 0 && c === '<') {
        j = src.length;
        break;
      }
      j += 1;
    }
    if (j >= src.length) continue; // not a tag after all

    if (closing) {
      const open = stack.pop();
      if (!open) report(file, `stray </${name}> at line ${line}`);
      else if (open.name !== name) {
        report(file, `<${open.name}> at line ${open.line} closed by </${name}> at line ${line}`);
      }
    } else if (!selfClosing) {
      stack.push({ name, line });
    }
    i = j;
  }
  for (const open of stack) report(file, `<${open.name}> at line ${open.line} is never closed`);
}

for (const file of files) {
  const src = readFileSync(file, 'utf8');

  if (src.includes('PLACEHOLDER')) report(file, 'leftover PLACEHOLDER marker');

  const stack = [];
  const stripped = stripLiterals(src);
  let line = 1;
  for (const ch of stripped) {
    if (ch === '\n') line += 1;
    if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, line });
    else if (PAIRS[ch]) {
      const open = stack.pop();
      if (!open) report(file, `unmatched '${ch}' at line ${line}`);
      else if (open.ch !== PAIRS[ch]) {
        report(file, `'${open.ch}' at line ${open.line} closed by '${ch}' at line ${line}`);
      }
    }
  }
  for (const open of stack) report(file, `unclosed '${open.ch}' opened at line ${open.line}`);

  if (file.endsWith('.jsx')) checkJsx(stripped, file);

  // ------------------------------------------------------------ import graph
  const importRe = /import\s+([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const [, clause, spec] of src.matchAll(importRe)) {
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) {
      report(file, `import '${spec}' does not exist`);
      continue;
    }
    const targetSrc = readFileSync(target, 'utf8');
    const named = clause.match(/\{([\s\S]*?)\}/)?.[1];
    for (const raw of named ? named.split(',') : []) {
      const name = raw.split(' as ')[0].trim();
      if (!name) continue;
      const exported =
        new RegExp(`export\\s+(async\\s+)?(const|let|var|function|class)\\s+${name}\\b`).test(targetSrc) ||
        new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(targetSrc);
      if (!exported) report(file, `'${name}' is not exported by ${spec}`);
    }
    if (/^\s*(\w+)\s*(,|$)/.test(clause) && !/^\s*[{*]/.test(clause)) {
      if (!/export\s+default/.test(targetSrc)) report(file, `${spec} has no default export`);
    }
  }
}

// ---------------------------------------------------------------- api surface
const apiSrc = readFileSync(resolve(ROOT, 'lib/api.js'), 'utf8');
const apiBody = apiSrc.slice(apiSrc.indexOf('export const api = {'));
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const [, name] of src.matchAll(/\bapi\.(\w+)\s*\(/g)) {
    if (!new RegExp(`\\b${name}\\s*:`).test(apiBody)) report(file, `api.${name} is not defined`);
  }
}

console.log(`checked ${files.length} files`);
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('  ✓ brackets balanced, imports resolve, api calls exist');
