// My dictionary and accounts in the real app, against the local API
// (scripts/dev-api.mjs). Team signs are published through the API; a user
// changes one for themselves, undoes it, and (signed in) finds their
// dictionary on a second, fresh browser.
import { test, expect } from '@playwright/test';
import { DEV_CODE } from '../playwright.api.config.js';

const API = 'http://localhost:8787';
const HEAD = { Origin: 'http://localhost:4175', 'Content-Type': 'application/json' };
const take = (k) => Array.from({ length: 10 }, (_, i) => Array.from({ length: 100 }, (_, j) => {
  if (j === 48 || j === 99) return 1;
  if (j === 0) return 0;
  return Math.round(((Math.sin(k * 7 + j * 0.3 + i * 0.2) + 1) / 2) * 1000) / 1000;
}));
const sign = (k, word) => ({
  id: `pe-${k}`, token: word.toUpperCase(), word, category: 'other', type: 'word', texts: {}, hands: 'one',
  takes: [take(k), take(k + 0.05), take(k + 0.1)],
});

async function openDictionary(page) {
  await page.getByRole('button', { name: /Sign to speech/ }).first().click();
  await page.getByRole('tab', { name: 'Dictionary' }).click();
}

test('my dictionary: change a team sign for me, undo, and sync it through an account', async ({ page, browser, request }) => {
  const pub = await request.post(`${API}/isl/publish`, { headers: HEAD, data: { code: DEV_CODE, signs: [sign(21, 'hello'), sign(22, 'go')] } });
  expect(pub.ok()).toBeTruthy();

  await page.goto('/');
  await openDictionary(page);

  // Change "hello" for me: Learn (and the translator) now use my word.
  await page.locator('li', { hasText: 'HELLO · word' }).getByRole('button', { name: 'Change for me' }).click();
  await page.getByLabel('Word for me').fill('Namaste');
  await page.getByRole('button', { name: 'Save for me' }).click();
  await expect(page.getByText('For me it says “Namaste”')).toBeVisible();
  await page.getByRole('tab', { name: 'Learn' }).click();
  await expect(page.getByRole('button', { name: /^Namaste/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^hello/ })).toHaveCount(0);

  // My dictionary lists it; Undo brings the team's word back.
  await page.getByRole('tab', { name: 'Dictionary' }).click();
  await page.getByRole('tab', { name: 'My dictionary' }).click();
  await expect(page.getByText('My changes to team signs (1)')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('My changes to team signs (0)')).toBeVisible();
  await page.getByRole('tab', { name: 'Learn' }).click();
  await expect(page.getByRole('button', { name: /^hello/ })).toBeVisible();

  // Create an account, hide "go" for me; it reaches the account.
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: /Create an account/ }).click();
  const username = `e2e_${Date.now().toString(36)}`;
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Your name').fill('Test User');
  await page.getByLabel('PIN').fill('581937');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/Signed in as/)).toBeVisible();
  await openDictionary(page);
  await page.locator('li', { hasText: 'GO · word' }).getByRole('button', { name: 'Hide for me' }).click();
  await expect(page.locator('li', { hasText: 'GO · word' }).getByText('Hidden for me')).toBeVisible();
  await page.waitForTimeout(7000);                     // uploaded 5 s after the last change

  // A second, fresh browser: sign in, and "go" is hidden there too.
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto('/');
  await page2.getByRole('button', { name: 'Settings' }).first().click();
  await page2.getByLabel('Username').fill(username);
  await page2.getByLabel('PIN').fill('581937');
  await page2.locator('form').getByRole('button', { name: 'Sign in' }).click();
  await expect(page2.getByText(/Signed in as Test User/)).toBeVisible();
  await openDictionary(page2);
  await expect(page2.locator('li', { hasText: 'GO · word' }).getByText('Hidden for me')).toBeVisible();

  // Sign out: this device keeps its copy; the account keeps its own.
  await page2.getByRole('button', { name: 'Settings' }).first().click();
  await page2.getByRole('button', { name: 'Sign out' }).click();
  await expect(page2.locator('form').getByRole('button', { name: 'Sign in' })).toBeVisible();
  await ctx2.close();

  await request.post(`${API}/isl/remove`, { headers: HEAD, data: { code: DEV_CODE, ids: ['pe-21', 'pe-22'] } });
});
