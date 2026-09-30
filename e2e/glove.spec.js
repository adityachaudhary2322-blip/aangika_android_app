// Phase 5 end-to-end: a simulated glove (replaying recorded frames) drives a
// whole sentence through the real app: glove recognition -> token stream ->
// automatic sentence boundary -> grammar -> spoken sentence text.
import { test, expect } from '@playwright/test';
import { hold, transition, resetSeed } from '../scripts/fixtures/gloveFixtures.mjs';
import { featureOf } from '../src/services/glove/recognizer.js';

const EXPECTED = /peerjs|ERR_INTERNET_DISCONNECTED|Lost connection to server|^INFO: /i;

function signExport() {
  resetSeed(21);
  const sign = (token, shape) => ({
    token, kind: 'glove', output: { type: 'gloss', text_en: token.toLowerCase() }, createdAt: 1,
    samples: [0, 1, 2].flatMap((capture) => hold(shape, 20, { tilt: (capture - 1) * 6 })
      .map((f) => ({ capture, f: Array.from(featureOf(f)) }))),
  });
  return {
    format: 'aangika-custom-signs/1',
    signs: [sign('DOCTOR', 'DOCTOR'), sign('HELP', 'HELP'), sign('NEED', 'NEED')],
  };
}

test('simulated glove: DOCTOR HELP NEED -> "I need a doctor\'s help."', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !EXPECTED.test(m.text())) errors.push(m.text()); });

  await page.goto('/?glove=sim');
  await page.waitForFunction(() => Boolean(window.__aangikaGloveSim));
  const report = await page.evaluate((json) => window.__aangikaGloveSim.importSigns(json), signExport());
  expect(report.added).toBe(3);

  // Offline grammar, so the result does not depend on any API key.
  await page.evaluate(() => localStorage.setItem('isl.pipelineMode', 'offline'));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__aangikaGloveSim));

  await page.getByRole('button', { name: /Built-in signs/ }).first().click();
  await page.getByRole('button', { name: 'Start translating' }).click();
  await expect(page.getByRole('button', { name: /Auto sentence on/ })).toBeVisible();

  resetSeed(33);
  const frames = [
    ...hold('REST', 20),
    ...hold('DOCTOR', 30), ...transition('DOCTOR', 'HELP', 5),
    ...hold('HELP', 30), ...transition('HELP', 'NEED', 5),
    ...hold('NEED', 30),
    ...hold('REST', 120),                 // hand relaxed: the sentence ends
  ];
  await page.evaluate((f) => window.__aangikaGloveSim.connect(f, { hz: 50 }), frames);

  await expect(page.getByText("I need a doctor's help.").first()).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});
