// "Do you sign?" question and the Live / Record translator modes (fake camera).
import { test, expect } from '@playwright/test';

const EXPECTED = /peerjs|ERR_INTERNET_DISCONNECTED|Lost connection to server|^INFO: /i;
function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });
  return errors;
}

test('Home asks once whether the user signs, and words the main actions for the answer', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await expect(page.getByText('Do you use sign language yourself?')).toBeVisible();
  await page.getByRole('button', { name: /No, I talk with someone who signs/ }).click();
  await expect(page.getByText('Do you use sign language yourself?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Understand their signs/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reply by speaking/ })).toBeVisible();

  // Remembered across reloads; changeable from the pill.
  await page.reload();
  await expect(page.getByText('Do you use sign language yourself?')).toHaveCount(0);
  await page.getByRole('button', { name: /For someone who signs/ }).click();
  await page.getByRole('button', { name: /Yes, I sign/ }).click();
  await expect(page.getByRole('button', { name: /Sign to speech/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Record mode: record, stop, then read and play the translation', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Yes, I sign/ }).click();
  await page.getByRole('button', { name: /Built-in signs/ }).first().click();

  await page.getByRole('button', { name: /Record sign, stop, then play/ }).click();
  await page.getByRole('button', { name: 'Start translating' }).click();
  await expect(page.getByRole('tab', { name: 'Record' })).toHaveAttribute('aria-selected', 'true');

  // The fake camera shows no real signs: stopping must say so, not invent a sentence.
  await page.getByRole('button', { name: 'Record signs' }).click();
  await expect(page.getByText(/Recording 0:0\d/)).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop and translate' }).click();
  await expect(
    page.getByText(/No signs were recognised/).or(page.getByRole('button', { name: 'Play translation aloud' })),
  ).toBeVisible({ timeout: 20_000 });

  // Typed signs go through the same result card.
  await page.getByRole('button', { name: 'NAMASTE', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play translation aloud' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Record again' })).toBeVisible();

  // Back to live mode: the sentence controls return.
  await page.getByRole('tab', { name: 'Live' }).click();
  await expect(page.getByRole('button', { name: /Auto sentence/ })).toBeVisible();
  expect(errors).toEqual([]);
});
