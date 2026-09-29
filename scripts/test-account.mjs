/**
 * Accounts: phone normalisation, the discovery privacy rule, the Edge
 * Function staying in sync with it, and the migration's RLS coverage.
 * (No live Supabase project here: the SQL is checked statically.)
 *
 *     node scripts/test-account.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { toE164, normaliseList, matchDiscoverable } from '../src/services/phone.js';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

console.log('='.repeat(74) + '\n  Accounts\n' + '='.repeat(74));

console.log('\n1. Phone numbers -> E.164\n' + '-'.repeat(74));
const CASES = [
  ['98765 43210', '+919876543210'], ['+91 98765-43210', '+919876543210'], ['09876543210', '+919876543210'],
  ['0091 9876543210', '+919876543210'], ['+1 (415) 555-0100', '+14155550100'], ['12345', null], ['abc', null], ['', null],
];
for (const [raw, want] of CASES) check(toE164(raw) === want, `"${raw}" -> ${toE164(raw)}`);
check(normaliseList(['98765 43210', '+919876543210', 'x', '8765432109']).length === 2, 'normaliseList dedupes and drops junk');
check(normaliseList(Array.from({ length: 900 }, (_, i) => `98765${String(i).padStart(5, '0')}`)).length === 500, 'capped at 500 per lookup');

console.log('\n2. Discovery: discoverable numbers match, verified or not (no SMS OTP)\n' + '-'.repeat(74));
const profiles = [
  { id: 'a', handle: 'asha', display_name: 'Asha', phone_e164: '+911111111111', phone_verified: true, discoverable: true },
  { id: 'b', handle: 'bala', display_name: 'Bala', phone_e164: '+912222222222', phone_verified: false, discoverable: true },
  { id: 'c', handle: 'chen', display_name: 'Chen', phone_e164: '+913333333333', phone_verified: true, discoverable: false },
  { id: 'd', handle: 'dev', display_name: 'Dev', phone_e164: null, phone_verified: false, discoverable: true },
];
const m = matchDiscoverable(profiles, ['+911111111111', '+912222222222', '+913333333333', '+914444444444']);
check(m.map((x) => x.handle).join() === 'asha,bala', 'discoverable profiles match whether verified or not', m.map((x) => x.handle).join(','));
check(!m.some((x) => x.handle === 'chen'), 'a profile that turned discovery off never matches');
check(m.find((x) => x.handle === 'bala').verified === false && m.find((x) => x.handle === 'asha').verified === true,
  'each match says whether its number was verified');
check(Object.keys(m[0]).sort().join() === 'display_name,handle,id,verified', 'a match exposes no phone number');

console.log('\n3. The Edge Function applies the same rule\n' + '-'.repeat(74));
const fn = readFileSync('supabase/functions/discover-friends/index.ts', 'utf8');
const body = (src) => src.slice(src.indexOf('function matchDiscoverable'), src.indexOf('}', src.indexOf('.map((p)')) + 1).replace(/\s+/g, ' ');
const js = readFileSync('src/services/phone.js', 'utf8');
const RULE = 'p.discoverable && p.phone_e164 && wanted.has(p.phone_e164)';
check(body(fn).includes(RULE) && body(js).includes(RULE), 'same filter in the app and the Edge Function');
check(/discovery_consent_at/.test(fn) && /MAX_NUMBERS = 500/.test(fn) && /\.eq\('discoverable', true\)/.test(fn),
  'function requires caller consent, caps input, queries discoverable profiles only');
check(!/console\.log/.test(fn), 'function never logs the numbers');

console.log('\n4. Migration: RLS on every table\n' + '-'.repeat(74));
const sql = readdirSync('supabase/migrations').map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');
const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((x) => x[1]);
for (const t of tables) {
  check(new RegExp(`alter table public\\.${t} enable row level security`).test(sql)
    && new RegExp(`create policy \\w+ on public\\.${t}`).test(sql), `${t}: RLS enabled with explicit policies`);
}
check(/protect_phone_verified/.test(sql) && /service_role/.test(sql), 'phone_verified can only be set server-side');
check(/create unique index if not exists profiles_phone_unique\s+on public\.profiles \(phone_e164\)/.test(sql),
  'one account per phone number');
check(/check \(consent\)/.test(sql) && /review_status in \('pending', 'approved', 'rejected'\)/.test(sql), 'contributions need consent and start pending');

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
