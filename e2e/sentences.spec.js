// Phase 3 browser checks: sentence-mode controls and Demo mode (fake camera).
import { test, expect } from '@playwright/test';

const EXPECTED = /peerjs|ERR_INTERNET_DISCONNECTED|Lost connection to server|^INFO: /i;
function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });
  return errors;
}

test('Translator shows Auto sentence and Spell controls; Spell warns when no letters are taught', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Sign to speech' }).first().click();
  await page.getByRole('button', { name: 'Start translating' }).click();
  const auto = page.getByRole('button', { name: /Auto sentence/ });
  await expect(auto).toHaveAttribute('aria-pressed', 'true');
  await auto.click();
  await expect(auto).toHaveAttribute('aria-pressed', 'false');
  await auto.click();
  const spell = page.getByRole('button', { name: /Spell (on|off)/ });
  await spell.click();
  await expect(spell).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/No letters taught yet/)).toBeVisible();
  await spell.click();
  await expect(spell).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('Demo mode runs live recognition and only allows practising real signs', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: 'Open demo mode' }).click();
  await expect(page.getByRole('heading', { name: 'Demo mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Start demo camera' }).click();
  await expect(page.getByText(/[1-9]\d* FPS/)).toBeVisible({ timeout: 90_000 });
  const input = page.getByLabel('Sign to practise');
  const record = page.getByRole('button', { name: 'Record 3 s' });
  await input.fill('NOTASIGN');
  await expect(record).toBeDisabled();
  await input.fill('WATER');                       // a real ISL tagger word
  await expect(record).toBeEnabled();
  await record.click();
  // Fake camera has no hands, so the honest outcome is "not recognised".
  await expect(page.getByText(/Not recognised|Recognised/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('0/1')).toBeVisible();
  await expect(page.getByText(/Built only from signs marked reliable/)).toBeVisible();
  expect(errors).toEqual([]);
});
