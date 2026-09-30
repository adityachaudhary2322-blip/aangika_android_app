// One-to-one calls, two real browsers on this machine, through the public
// PeerJS broker (so this needs internet; it is not run in CI). The fake
// camera shows no hands and the fake microphone no speech, so what is checked
// is the call itself: the "sign or speak?" question, each side running its own
// system, two people only, and no ghost person after a rejoin.
import { test, expect } from '@playwright/test';

const tiles = (page) => page.getByTestId('call-tile');

async function openMeet(page, url = '/?view=meet') {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Meet' })).toBeVisible();
}

test('two-person call: roles asked first, third person refused, rejoin leaves no ghost', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = () => browser.newContext({ permissions: ['camera', 'microphone'] });
  const [a, b, c] = await Promise.all([ctx(), ctx(), ctx()]);
  const host = await a.newPage();
  const guest = await b.newPage();
  const third = await c.newPage();

  // Host: start a call; the role question comes first.
  await openMeet(host);
  await host.getByRole('button', { name: /New room code/ }).click();
  await expect(host.getByRole('dialog', { name: 'Do you sign or speak?' })).toBeVisible();
  await host.getByRole('dialog').getByRole('button', { name: /^Sign/ }).click();
  await expect(host.getByText('You sign · ISL Studio')).toBeVisible({ timeout: 60_000 });
  await expect(host.getByText(/Waiting for the other person/)).toBeVisible();
  const code = (await host.locator('span.font-mono').first().innerText()).replace('-', '').toLowerCase();

  // Guest: the invite link fills the code; they speak.
  await openMeet(guest, `/?room=${code}`);
  await guest.getByRole('button', { name: /^Join$/ }).click();
  await guest.getByRole('dialog').getByRole('button', { name: /^Speak/ }).click();
  await expect(guest.getByText(/You speak/)).toBeVisible({ timeout: 60_000 });

  // Both see exactly two people: the other on the stage, themselves small.
  await expect(tiles(host)).toHaveCount(2, { timeout: 60_000 });
  await expect(tiles(guest)).toHaveCount(2, { timeout: 60_000 });
  await expect(host.getByText(/Waiting for the other person/)).toHaveCount(0);
  await expect(host.getByText('connecting')).toHaveCount(0, { timeout: 60_000 });

  // A third person is refused: calls are one to one.
  await openMeet(third, `/?room=${code}`);
  await third.getByRole('button', { name: /^Join$/ }).click();
  await third.getByRole('dialog').getByRole('button', { name: /^Sign/ }).click();
  await expect(third.getByText(/already has two people/)).toBeVisible({ timeout: 60_000 });

  // The guest leaves and joins again: still exactly two people, no ghost.
  await guest.getByRole('button', { name: 'Leave call' }).click();
  await expect(tiles(host)).toHaveCount(1, { timeout: 30_000 });
  await openMeet(guest, `/?room=${code}`);
  await guest.getByRole('button', { name: /^Join$/ }).click();
  await guest.getByRole('dialog').getByRole('button', { name: /^Speak/ }).click();
  await expect(tiles(host)).toHaveCount(2, { timeout: 60_000 });
  await expect(host.getByText('connecting')).toHaveCount(0, { timeout: 60_000 });
  await host.waitForTimeout(3000);
  await expect(tiles(host)).toHaveCount(2);

  await host.getByRole('button', { name: 'End call' }).click();
  await Promise.all([a.close(), b.close(), c.close()]);
});
