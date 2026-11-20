import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The assistant is read-only. A hold takes seats for 10 minutes, so it needs a
 * human click in the browser (POST /bookings/checkout), never a model tool call.
 *
 * This is a static guard: it fails if anything under src/assistant ever mentions
 * a function that writes bookings, holds, payments or coupons. If you genuinely
 * need such a tool one day, change this test in the same PR so the decision is
 * made on purpose and reviewed, not slipped in.
 */

const ROOT = fileURLToPath(new URL('../src/assistant', import.meta.url));
const FORBIDDEN = [
  'startCheckout',
  'confirmBooking',
  'acquireHold',
  'releaseHold',
  'extendHold',
  'createOrder',
  'verifyPayment',
  'abandonBooking',
  'cancelBooking',
  'payments.service',
  'seatLock.service',
  'razorpay',
  'INSERT INTO bookings',
  'UPDATE bookings',
  'DELETE FROM bookings',
  'redis',
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (full.endsWith('.js')) yield full;
  }
}

test('nothing under src/assistant can write bookings, holds, payments or touch Redis', () => {
  const files = [...walk(ROOT)];
  assert.ok(files.length >= 10, 'guard must actually be scanning the assistant files');

  const hits = [];
  for (const file of files) {
    // Comments may explain the rule by naming these; only code counts.
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const word of FORBIDDEN) {
      if (code.toLowerCase().includes(word.toLowerCase())) hits.push(`${relative(ROOT, file)} -> ${word}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('the only booking functions the assistant is wired to are the three read-only ones', async () => {
  const src = readFileSync(join(ROOT, 'tools/deps.js'), 'utf8');
  // Only the object handed to the tools: `booking: { getCalendar: booking.getCalendar, ... }`.
  const block = src.match(/\n\s{4}booking:\s*\{([^}]*)\}/)?.[1];
  assert.ok(block, 'could not find the booking dependency block in deps.js');
  const wired = [...block.matchAll(/booking\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(wired, ['getCalendar', 'getCheckoutState', 'quote']);
});
