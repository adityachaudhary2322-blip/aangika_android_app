// Phase 1 browser checks: model registry UI, download + offline, camera loop.
import { test, expect } from '@playwright/test';

/**
 * Collect page errors; each test asserts there were none. The one expected
 * exception: while the test deliberately cuts the network, Messages' PeerJS
 * connection to its signalling server fails. That is the network being off,
 * not a recognition fault. MediaPipe's wasm also prints 'INFO:' lines on the error console.
 */
const EXPECTED_OFFLINE = /peerjs|ERR_INTERNET_DISCONNECTED|Lost connection to server|^INFO: /i;
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !EXPECTED_OFFLINE.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await expect(page.getByText('Recognition', { exact: true })).toBeVisible();
}

const card = (page, name) => page.locator('div.rounded-xl', { hasText: name }).first();

test('Settings > Recognition lists the registry with size, offline, accuracy, licence', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await openSettings(page);

  const aangika = card(page, 'Aangika ISL tagger v2');
  await expect(aangika).toContainText('MB');
  await expect(aangika).toContainText('precision 0.44');
  await expect(aangika).toContainText('not for commercial use');
  const sb = card(page, 'SignBridge + My signs');
  await expect(sb).toContainText('always available');
  await expect(sb).toContainText('Not measured on real hands');

  await page.getByRole('button', { name: 'American (ASL)' }).click();
  const asl = card(page, 'ASL isolated signs (250)');
  await expect(asl).toContainText('MIT');
  await expect(asl).toContainText('Not measured in this app');
  await page.getByRole('button', { name: 'Indian (ISL)' }).click();
  await expect(card(page, 'Aangika ISL tagger v2')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Using a model downloads it with progress, and it then loads offline', async ({ page, context }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  // Let the service worker take control so model fetches go through it.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await openSettings(page);

  // Switch away and back so the tagger is fetched through the service worker.
  await card(page, 'SignBridge + My signs').getByRole('button').click();
  await expect(page.getByText('SignBridge + My signs is ready.')).toBeVisible();
  await card(page, 'Aangika ISL tagger v2').getByRole('button').click();
  await expect(page.getByText('Aangika ISL tagger v2 is ready.')).toBeVisible();
  await expect(card(page, 'Aangika ISL tagger v2')).toContainText('ready on this device');

  // Now cut the network and prove it loads from the device.
  await context.setOffline(true);
  await page.reload();
  await openSettings(page);
  await expect(card(page, 'Aangika ISL tagger v2')).toContainText('ready on this device');
  await card(page, 'SignBridge + My signs').getByRole('button').click();
  await expect(page.getByText('SignBridge + My signs is ready.')).toBeVisible();
  await card(page, 'Aangika ISL tagger v2').getByRole('button').click();
  await expect(page.getByText('Aangika ISL tagger v2 is ready.')).toBeVisible();
  await context.setOffline(false);
  expect(errors).toEqual([]);
});

test('Sign to speech runs the camera loop with the registry engine', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Built-in signs/ }).first().click();
  await page.getByRole('button', { name: 'Start translating' }).click();
  // Frames flowing = the FPS pill counts up (fake camera, no real hands).
  await expect(page.getByText(/[1-9]\d* FPS/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/could not load/i)).toHaveCount(0);
  expect(errors).toEqual([]);
});
