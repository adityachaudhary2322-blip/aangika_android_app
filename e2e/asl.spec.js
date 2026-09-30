// Phase 2 browser check: the ASL model loads in the real browser runtime
// (onnxruntime-web + MediaPipe face landmarker), runs in the camera loop, and
// the cost of the face landmarker is measured (fake camera: no real hands).
import { test, expect } from '@playwright/test';

const EXPECTED = /peerjs|ERR_INTERNET_DISCONNECTED|Lost connection to server|^INFO: /i;

async function useModel(page, languageButton, cardName) {
  await page.getByRole('button', { name: 'Settings' }).first().click();
  await page.getByRole('button', { name: languageButton }).click();
  const card = page.locator('div.rounded-xl', { hasText: cardName }).first();
  await card.getByRole('button').click();
  await expect(page.getByText(`${cardName} is ready.`)).toBeVisible({ timeout: 90_000 });
}

/** Average of the pill's "landmarks N ms" over a few seconds of frames. */
async function landmarkMs(page) {
  await page.getByRole('button', { name: /Built-in signs/ }).first().click();
  const start = page.getByRole('button', { name: 'Start translating' });
  if (await start.isVisible().catch(() => false)) await start.click();
  const pill = page.getByText(/\d+ FPS/).first();
  await expect(page.getByText(/landmarks \d+ ms/).first()).toBeVisible({ timeout: 90_000 });
  const samples = [];
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1100);
    const text = await pill.textContent();
    const m = text.match(/(\d+) FPS.*landmarks (\d+) ms/);
    if (m) samples.push({ fps: +m[1], ms: +m[2] });
  }
  const mean = (k) => Math.round(samples.reduce((s, x) => s + x[k], 0) / Math.max(samples.length, 1));
  return { fps: mean('fps'), ms: mean('ms'), n: samples.length };
}

test('ASL model loads, runs in the camera loop, and the face-landmarker cost is measured', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });
  await page.goto('/');

  await useModel(page, 'Indian (ISL)', 'Aangika ISL tagger v2');
  const isl = await landmarkMs(page);

  await useModel(page, 'American (ASL)', 'ASL isolated signs (250)');
  const asl = await landmarkMs(page);
  await expect(page.getByText(/could not load/i)).toHaveCount(0);

  const report = `ISL (hands + pose): ${isl.ms} ms/frame, ${isl.fps} FPS | ` +
    `ASL (hands + pose + face): ${asl.ms} ms/frame, ${asl.fps} FPS`;
  console.log(`[cost] ${report}`);
  test.info().annotations.push({ type: 'face-landmarker cost', description: report });
  expect(asl.n).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
