// Offline speech-to-text in Hearing mode: download the Hindi model once,
// go OFFLINE, record (the fake microphone plays a Hindi sentence), and the
// words are transcribed on the device.
import { test, expect } from '@playwright/test';

test('offline speech-to-text: Hindi, on the device, with no network', async ({ page, context }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/?view=hearing');
  await page.getByRole('button', { name: /Recognise on this device/ }).click();
  const hindi = page.locator('li', { hasText: 'Hindi' }).filter({ hasText: 'also for Hinglish' });
  await hindi.getByRole('button', { name: /Download/ }).click();
  await expect(hindi.getByText('ready offline')).toBeVisible({ timeout: 120_000 });

  await page.getByLabel(/They speak/).selectOption('hi-IN').catch(async () => {
    await page.locator('select').first().selectOption('hi-IN');
  });

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Start listening' }).click();
  await page.waitForTimeout(4500);                       // the clip is 3.1 s, looped
  await page.getByRole('button', { name: 'Stop and transcribe' }).click();

  await expect(page.getByText(/पानी/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/on-device · Hindi/)).toBeVisible();
  await context.setOffline(false);
  expect(errors).toEqual([]);
});
