// ASL Translator (for international users), the model picker, and the brand
// assets (fake camera: checks wiring and grammar, not recognition accuracy).
import { test, expect } from '@playwright/test';

const EXPECTED = /peerjs|ERR_INTERNET_DISCONNECTED|Lost connection to server|^INFO: /i;
function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });
  return errors;
}

test('ASL Translator has its own international entry, runs ASL, and leaves ISL as it was', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /For international users/ })).toBeVisible();
  await page.getByRole('button', { name: /ASL Translator/ }).first().click();

  await expect(page.getByRole('heading', { name: 'ASL Translator' })).toBeVisible();
  await page.getByRole('button', { name: 'Start translating' }).click();
  await expect(page.getByText(/ASL · American Sign Language · for international users/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Recognition model: ASL isolated signs \(250\)/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Spell (on|off)/ })).toHaveCount(0);

  // Typed ASL signs through the ASL grammar (not recognition).
  await page.getByRole('button', { name: 'MOM WHERE', exact: true }).click();
  await expect(page.getByText('Where is mom?').first()).toBeVisible({ timeout: 20_000 });

  // Leaving restores the Indian translator's model.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /Built-in signs/ }).first().click();
  await expect(page.getByRole('button', { name: /Recognition model: Aangika ISL tagger v2/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Model picker lists ISL and ASL models and switches between them', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Built-in signs/ }).first().click();

  await page.getByRole('button', { name: /Recognition model:/ }).click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(3);
  await expect(page.getByRole('option', { name: /ASL isolated signs \(250\)/ })).toBeVisible();
  await page.getByRole('option', { name: /ASL isolated signs \(250\)/ }).click();
  await expect(page.getByRole('button', { name: /Recognition model: ASL isolated signs/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'HELLO', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Recognition model:/ }).click();
  await page.getByRole('option', { name: /Aangika ISL tagger v2/ }).click();
  await expect(page.getByRole('button', { name: /Recognition model: Aangika ISL tagger v2/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'NAMASTE', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Brand: the new logo files are served and used', async ({ page, request }) => {
  for (const path of ['/favicon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png',
    '/apple-touch-icon.png', '/brand/mark-256.png', '/brand/logo-720.jpg']) {
    const res = await request.get(path);
    expect(res.ok(), path).toBeTruthy();
  }
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.png');
  await expect(page.getByRole('img', { name: 'Aangika' }).first()).toBeVisible();
});
