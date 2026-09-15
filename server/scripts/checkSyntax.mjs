#!/usr/bin/env node
/**
 * Parse every server .js file without executing it.
 *
 * This replaces a `find ... -exec node --check` one-liner, which only works on a
 * Unix shell — the project has to be runnable from PowerShell too.
 *
 *   node scripts/checkSyntax.mjs [dir ...]     # defaults to src scripts
 */
import { readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['src', 'scripts'];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.m?js$/.test(entry.name)) yield full;
  }
}

const check = (file) =>
  new Promise((resolve) => {
    // --check parses and reports syntax errors without running module code, so a
    // missing dependency or an unreachable database can't make this fail.
    execFile(process.execPath, ['--check', file], (err, _out, stderr) =>
      resolve(err ? { file, error: stderr.trim() } : null)
    );
  });

const files = [];
for (const target of targets) {
  for await (const file of walk(path.resolve(ROOT, target))) files.push(file);
}

const failures = (await Promise.all(files.map(check))).filter(Boolean);

for (const { file, error } of failures) {
  console.error(`✗ ${path.relative(ROOT, file)}\n${error}\n`);
}

if (failures.length) {
  console.error(`${failures.length} of ${files.length} files failed to parse`);
  process.exit(1);
}

console.log(`checked ${files.length} files — all parse cleanly`);
