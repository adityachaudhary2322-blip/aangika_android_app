// Regression: ISL Studio went blank when this device's stored dictionary copy
// had a sign without a word (or the wrong shape). It must always draw.
import { test, expect } from '@playwright/test';

const EXPECTED = /peerjs|ERR_INTERNET_DISCONNECTED|Lost connection to server|^INFO: |Failed to load resource/i;

const seed = ([shared, drafts]) => new Promise((res, rej) => {
  const r = indexedDB.open('aangika-isl', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onerror = () => rej(r.error);
  r.onsuccess = () => {
    const tx = r.result.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(shared, 'shared');
    tx.objectStore('kv').put(drafts, 'drafts');
    tx.oncomplete = () => { r.result.close(); res(); };
  };
});

// A recorded take as the server returns it: plain arrays, right hand in view.
const take = (k) => Array.from({ length: 10 }, (_, i) => Array.from({ length: 100 }, (_, j) => {
  if (j === 48 || j === 99) return 1;
  if (j === 0) return 0;
  return Math.round(((Math.sin(k * 7 + j * 0.3 + i * 0.2) + 1) / 2) * 1000) / 1000;
}));

const CASES = [
  // What the live site hit: "e.subarray is not a function".
  ['an "either hand" sign', { version: 1, signs: [{ id: 'w', token: 'WELCOME', word: 'WELCOME', type: 'word', category: 'action', hands: 'either', texts: {}, takes: [take(1), take(1.05), take(1.1)] }], rules: [] }, []],
  ['a sign without a word', { version: 1, signs: [{ id: 'a', token: 'X', takes: [] }, { id: 'b', word: 'SEGUE' }], rules: [{ id: 'r' }] }, [{ id: 'd' }]],
  ['signs and rules not arrays', { version: 1, signs: null, rules: null }, null],
  ['a stored copy that is not an object', 'broken', 'broken'],
];

for (const [label, shared, drafts] of CASES) {
  test(`ISL Studio draws with ${label}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });
    await page.goto('/');
    await page.evaluate(seed, [shared, drafts]);
    await page.reload();
    await page.getByRole('button', { name: /ISL Studio/ }).first().click();
    await expect(page.getByRole('heading', { name: 'ISL Studio' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Translate' })).toBeVisible();
    await page.getByRole('tab', { name: 'Dictionary' }).click();
    await page.getByRole('tab', { name: 'Rules' }).click();
    await expect(page.getByText(/hit a problem/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
