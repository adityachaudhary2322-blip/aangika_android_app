// Community sign dictionary, end to end in the real app: a developer
// publishes a taught sign with the developer code; another device (a
// separate browser context) receives it, sees it in My signs and the Word
// list, and loses it again when the developer removes it.
import { test, expect } from '@playwright/test';
import { DEV_CODE } from '../playwright.api.config.js';

const EXPECTED = /peerjs|ERR_INTERNET_DISCONNECTED|Lost connection to server|^INFO: |Failed to load resource/i;
const watch = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });
  return errors;
};

// One taught handshape sign, in the app's own export format.
const hand = (d) => Array.from({ length: 63 }, (_, i) => +(0.45 + ((i * 7) % 13) / 100 + d).toFixed(4));
const exportOf = (token, text) => JSON.stringify({
  format: 'aangika-custom-signs/1',
  signs: [{
    token, kind: 'handshape', hands: 'one',
    output: { type: 'name', text_en: text, texts: {} },
    samples: [0, 1, 2].flatMap((c) => [0, 1, 2, 3].map((k) => ({
      capture: c, left: null, right: hand((c * 4 + k) / 400), pose: { 11: [0.4, 0.4], 12: [0.6, 0.4] },
    }))),
    createdAt: 1,
  }],
});
const EXPORT = exportOf('TEAM_HEALX', 'Team HealX');

async function openMySigns(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'My signs' }).first().click();
  await expect(page.getByRole('heading', { name: 'My signs' })).toBeVisible();
}

test('developer section: whole dictionary, reassign/disable built-ins, publish and delete', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const errors = watch(page);
  await openMySigns(page);
  await page.locator('input[type="file"]').setInputFiles({ name: 'signs.json', mimeType: 'application/json', buffer: Buffer.from(exportOf('DEV_TEST_SIGN', 'Dev test')) });
  await expect(page.getByText(/Imported 1 sign/)).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Open developer section' }).click();
  await expect(page.getByRole('heading', { name: 'Developer section' })).toBeVisible();
  await page.getByLabel('Developer code').fill('111111');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Wrong developer code.')).toBeVisible();
  await page.getByLabel('Developer code').fill(DEV_CODE);
  await page.getByRole('button', { name: 'Unlock' }).click();

  // Built-in: all 20 handshapes, which word each one makes, and what defines it.
  await expect(page.getByRole('tab', { name: 'Built-in (20)' })).toBeVisible();
  await expect(page.getByText('Says: “I need water.”')).toBeVisible();
  const water = page.locator('li', { hasText: 'Says: “I need water.”' });
  await water.getByRole('button', { name: /Reassign/ }).click();
  await water.getByLabel('Meaning (English)').fill('I am thirsty.');
  await water.getByRole('button', { name: 'Save for everyone' }).click();
  await expect(page.getByText(/WATER reassigned for everyone/)).toBeVisible();
  const edited = page.locator('li', { hasText: 'Says: “I am thirsty.”' });
  await expect(edited.getByText('EDITED')).toBeVisible();
  await edited.getByRole('button', { name: /Disable/ }).click();
  await expect(edited.getByText('DISABLED')).toBeVisible();
  await edited.getByRole('button', { name: /Reset/ }).click();
  await expect(page.getByText('Says: “I need water.”')).toBeVisible();

  // Your signs -> publish -> Community -> edit meaning -> delete.
  await page.getByRole('tab', { name: /Your signs/ }).click();
  await expect(page.getByText('not published')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText(/DEV_TEST_SIGN published: every user/)).toBeVisible();
  await page.getByRole('tab', { name: /Community \(1\)/ }).click();
  const row = page.locator('li', { hasText: 'DEV_TEST_SIGN' });
  await row.getByRole('button', { name: /Edit meaning/ }).click();
  await row.getByLabel('Meaning (English)').fill('Dev test updated');
  await row.getByRole('button', { name: 'Save for everyone' }).click();
  await expect(page.getByText('Means: “Dev test updated”')).toBeVisible();
  await row.getByRole('button', { name: /Delete/ }).click();
  await row.getByRole('button', { name: 'Delete for everyone' }).click();
  await expect(page.getByText(/DEV_TEST_SIGN deleted for everyone/)).toBeVisible();
  await expect(page.getByRole('tab', { name: /Community \(0\)/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('developer section: grammar rules can be tried, added for everyone, and deleted', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const errors = watch(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Open developer section' }).click();
  await page.getByLabel('Developer code').fill(DEV_CODE);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: /Grammar/ }).click();

  const tryBox = page.getByLabel('Signs to try');
  await tryBox.fill('ME WATER');
  await expect(page.getByText('I need water.').first()).toBeVisible();
  await expect(page.getByText('मुझे पानी चाहिए।').first()).toBeVisible();

  await page.getByRole('button', { name: /New rule/ }).click();
  await page.getByPlaceholder('@self @side? @body PAIN?').fill('@self @need PLEASE');
  await page.getByPlaceholder('I need {need}.').fill('May I have some {need}, please?');
  await page.getByPlaceholder('Mujhe {need} chahiye.').fill('Thoda {need} milega please?');
  await tryBox.fill('ME WATER PLEASE');
  await expect(page.getByText('May I have some water, please?').first()).toBeVisible();   // preview before saving
  await page.getByRole('button', { name: 'Save for everyone' }).click();
  await expect(page.getByText(/saved for everyone/)).toBeVisible();
  await expect(page.getByText('@self + @need + PLEASE')).toBeVisible();

  await page.getByRole('button', { name: 'Delete rule' }).click();
  await expect(page.getByText('Rule deleted for everyone.')).toBeVisible();
  await expect(page.getByText('@self + @need + PLEASE')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('developer publishes a sign; another device receives it; removal reaches it too', async ({ browser }) => {
  // ── Developer's device ─────────────────────────────────────────────────
  const dev = await (await browser.newContext()).newPage();
  const devErrors = watch(dev);
  await openMySigns(dev);
  await dev.locator('input[type="file"]').setInputFiles({ name: 'signs.json', mimeType: 'application/json', buffer: Buffer.from(EXPORT) });
  await expect(dev.getByText(/Imported 1 sign/)).toBeVisible();

  await dev.getByRole('button', { name: /For developers/ }).click();
  const codeBox = dev.getByLabel('Developer code');
  await codeBox.fill('000000');
  await dev.getByRole('button', { name: 'Unlock' }).click();
  await expect(dev.getByText('Wrong developer code.')).toBeVisible();
  await codeBox.fill(DEV_CODE);
  await dev.getByRole('button', { name: 'Unlock' }).click();
  await expect(dev.getByText('Unlocked for this screen.')).toBeVisible();
  await dev.getByRole('button', { name: /Publish 1 to everyone/ }).click();
  await expect(dev.getByText(/Published: 1 new/)).toBeVisible();
  await expect(dev.getByText(/In the dictionary now \(1\)/)).toBeVisible();
  await expect(dev.getByText('published', { exact: true })).toBeVisible();

  // ── Another user's device: fresh browser, nothing taught ───────────────
  const user = await (await browser.newContext()).newPage();
  const userErrors = watch(user);
  await openMySigns(user);
  await expect(user.getByText(/1 shared sign on this device/)).toBeVisible();
  await expect(user.getByText(/From the community dictionary \(1\)/)).toBeVisible();
  await expect(user.getByText('Team HealX').first()).toBeVisible();
  await expect(user.getByRole('button', { name: /For developers/ })).toBeVisible();   // present, but locked

  await user.getByRole('button', { name: 'Update' }).click();
  await expect(user.getByText('Up to date.')).toBeVisible();

  await user.getByRole('button', { name: 'Back' }).first().click();
  await user.goto('/');
  await user.getByRole('button', { name: 'Word list' }).first().click();
  await expect(user.getByText(/1 shared sign on this device/)).toBeVisible();
  await user.getByPlaceholder('Search a word').fill('team');
  await expect(user.getByText(/team healx/i).first()).toBeVisible();

  // ── Developer removes it; the user's next update drops it ──────────────
  await dev.getByRole('button', { name: /Remove for everyone/ }).click();
  await expect(dev.getByText(/TEAM_HEALX removed for everyone/)).toBeVisible();
  await user.getByRole('button', { name: 'Update' }).click();
  await expect(user.getByText(/0 shared signs on this device/)).toBeVisible();

  expect(devErrors).toEqual([]);
  expect(userErrors).toEqual([]);
});
