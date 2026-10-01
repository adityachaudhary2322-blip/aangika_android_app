// ISL Studio in the real app, against the local API (scripts/dev-api.mjs).
// The fake camera shows no hands, so RECORDING a sign cannot be tested here;
// signs are published through the API (as a developer's device would), then
// the app must list them, apply this dictionary's rules, and start the camera.
import { test, expect } from '@playwright/test';
import { DEV_CODE } from '../playwright.api.config.js';

const EXPECTED = /peerjs|ERR_INTERNET_DISCONNECTED|Lost connection to server|^INFO: |Failed to load resource/i;
const API = 'http://localhost:8787';
const HEAD = { Origin: 'http://localhost:4175', 'Content-Type': 'application/json' };

const take = (k) => Array.from({ length: 10 }, (_, i) => Array.from({ length: 100 }, (_, j) => {
  if (j === 48 || j === 99) return 1;          // right hand present, body visible
  if (j === 0) return 0;
  return Math.round(((Math.sin(k * 7 + j * 0.3 + i * 0.2) + 1) / 2) * 1000) / 1000;
}));
const sign = (k, word, category, type = 'word', texts = {}) => ({
  id: `e2e-${k}`, token: word.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), word, category, type, texts, hands: 'one',
  takes: [take(k), take(k + 0.05), take(k + 0.1)],
});

test('ISL Studio: team dictionary, rules for everyone, continuous translate screen', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });

  const pub = await request.post(`${API}/isl/publish`, {
    headers: HEAD,
    data: {
      code: DEV_CODE,
      signs: [
        sign(1, 'I', 'pronoun'), sign(2, 'hospital', 'place', 'word', { 'hi-IN': 'अस्पताल', hinglish: 'hospital' }),
        sign(3, 'go', 'action'), sign(4, 'full stop', 'other', 'full-stop'),
      ],
    },
  });
  expect(pub.ok()).toBeTruthy();

  await page.goto('/');
  await page.getByRole('button', { name: /ISL Studio/ }).first().click();
  await expect(page.getByRole('heading', { name: 'ISL Studio' })).toBeVisible();
  await expect(page.getByText(/4 signs/)).toBeVisible();

  // Dictionary: everyone sees the team's signs; editing needs the code.
  await page.getByRole('tab', { name: 'Dictionary' }).click();
  await expect(page.locator('li', { hasText: 'hospital' }).getByText('published')).toBeVisible();
  await expect(page.locator('li', { hasText: 'hospital' }).getByText(/अस्पताल/)).toBeVisible();
  await expect(page.getByText('FULL STOP', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Record a new sign/ })).toHaveCount(0);
  await page.getByLabel('Developer code').fill(DEV_CODE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByRole('button', { name: /Record a new sign/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Edit \/ reassign/ }).first()).toBeVisible();
  // Health check and the delete safety net.
  await page.getByRole('button', { name: /Check dictionary/ }).click();
  await expect(page.getByText(/to re-record|All signs look distinct/)).toBeVisible();
  await page.getByRole('button', { name: /Recently deleted/ }).click();
  await expect(page.getByText('Nothing deleted.')).toBeVisible();
  const goCard = page.locator('li', { hasText: 'GO · word' });
  await goCard.getByRole('button', { name: 'Delete for everyone' }).click();
  await goCard.getByRole('button', { name: /Tap again to delete/ }).click();
  await expect(page.getByText(/deleted for everyone\. Undo it/)).toBeVisible();
  await page.getByRole('button', { name: /Recently deleted/ }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText(/“go” restored for everyone/)).toBeVisible();
  await expect(page.locator('li', { hasText: 'GO · word' })).toBeVisible();

  // Rules: this dictionary's own grammar, tried live, saved for everyone.
  await page.getByRole('tab', { name: 'Rules' }).click();
  await page.getByLabel('Signs to try').fill('I hospital go');
  await expect(page.getByText(/No rule of this dictionary matches/)).toBeVisible();
  // The simple way: tap the signs in order, type the sentence.
  await page.getByRole('button', { name: '+ I', exact: true }).click();
  await page.getByRole('button', { name: '+ hospital', exact: true }).click();
  await page.getByLabel('Sentence to say').fill('Take me to the hospital');
  await page.getByRole('button', { name: /Save: I \+ hospital/ }).click();
  // A draft: it already works on this device; nobody else has it yet.
  await expect(page.getByText(/Draft saved on this device/)).toBeVisible();
  await expect(page.getByText('draft · only you')).toBeVisible();
  await page.getByLabel('Signs to try').fill('I hospital');
  await expect(page.getByText('Take me to the hospital.').first()).toBeVisible();

  await page.getByLabel('Signs to try').fill('I hospital go');
  await page.getByRole('button', { name: /New advanced rule/ }).click();
  await page.getByLabel('Rule pattern').fill('@pronoun @place GO');
  await page.getByLabel('Rule English').fill('I am going to the {place}.');
  await page.getByLabel('Rule Hindi').fill('मैं {place} जा रहा हूँ।');
  await expect(page.getByText('I am going to the hospital.')).toBeVisible();          // preview before saving
  await page.getByRole('button', { name: 'Save as draft' }).click();
  await expect(page.getByText('2 draft rules (only on this device)')).toBeVisible();
  await expect(page.getByText('मैं अस्पताल जा रहा हूँ।')).toBeVisible();
  // Publish: both go to everyone.
  await page.getByRole('button', { name: /Publish all for everyone/ }).click();
  await expect(page.getByText('2 rules published for everyone.')).toBeVisible();
  await expect(page.getByText('draft · only you')).toHaveCount(0);
  // The same signs as a published rule: a clash, never published silently.
  await page.getByRole('button', { name: '+ I', exact: true }).click();
  await page.getByRole('button', { name: '+ hospital', exact: true }).click();
  await page.getByLabel('Sentence to say').fill('Hospital please');
  await page.getByRole('button', { name: /Save: I \+ hospital/ }).click();
  await expect(page.getByText(/uses the same signs; publishing will ask which to keep/)).toBeVisible();
  await page.getByRole('button', { name: /Publish for everyone/ }).click();
  await expect(page.getByRole('region', { name: 'Rule clash' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep theirs (discard mine)' }).click();
  await expect(page.getByText(/Kept the published rule/)).toBeVisible();
  await expect(page.getByText('Take me to the hospital.').first()).toBeVisible();

  // Learn: pick a sign, read how it is made, sign it and get a result. The
  // fake camera shows no hands, so the result must say so (no made-up score).
  await page.getByRole('tab', { name: 'Learn' }).click();
  await expect(page.getByText("Learn the team's signs")).toBeVisible();
  await page.getByRole('button', { name: /^hospital/ }).click();
  await expect(page.getByText('How to sign it')).toBeVisible();
  await page.getByRole('button', { name: 'Sign it' }).click({ timeout: 90_000 });
  await expect(page.getByRole('region', { name: 'Your result' }).getByText(/No hands were seen/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/best 0%/)).toBeVisible();
  await page.getByRole('button', { name: 'Back to signs' }).click();
  await expect(page.getByText('Best 0%')).toBeVisible();

  // Translate: the continuous translator starts on the camera.
  await page.getByRole('tab', { name: 'Translate' }).click();
  await page.getByRole('button', { name: 'Start ISL Studio' }).click();
  await expect(page.getByText(/No hands in view|hand:/).first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: /Say it now/ })).toBeDisabled();
  // Live demos: pause reading signs (button or Space) while talking.
  await page.getByRole('button', { name: /Pause signing/ }).click();
  await expect(page.getByText(/Paused: signs are not being read/)).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /Pause signing/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo last sign' })).toBeDisabled();

  await request.post(`${API}/isl/rules`, { headers: HEAD, data: { code: DEV_CODE, rules: [] } });
  await request.post(`${API}/isl/remove`, { headers: HEAD, data: { code: DEV_CODE, ids: ['e2e-1', 'e2e-2', 'e2e-3', 'e2e-4'] } });
  expect(errors).toEqual([]);
});
