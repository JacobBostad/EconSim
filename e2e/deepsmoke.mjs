/**
 * Deep UI smoke: drive the game to a rich late-game state (~150 days with
 * player chains), then open every dashboard and inspector view, asserting
 * zero page errors throughout. Catches rendering crashes that only occur
 * with doubled AI chains, roasteries, apartments, closed facilities, etc.
 */
import { chromium } from 'playwright-core';

// Chromium: honor an explicit path, else let playwright-core resolve its
// own managed browser (CI installs it via `npx playwright-core install chromium`).
const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const BASE_URL = process.env.BASE_URL || 'http://localhost:4173';
await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

async function clearOverlays() {
  for (let i = 0; i < 6; i++) {
    const bd = page.locator('.intro-backdrop');
    if (!(await bd.count())) return;
    await bd.locator('button').last().click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

await clearOverlays();
await page.getByRole('button', { name: /New/ }).first().click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Start town' }).click();
await page.waitForTimeout(400);
await clearOverlays();

// Build player chains so the late-game state is rich.
await page.getByRole('button', { name: /Bread chain/ }).click();
await page.getByRole('button', { name: /Coffee chain/ }).click();
await page.getByRole('button', { name: /Apartment/ }).click();
await page.mouse.click(700, 620); // place apartment on the map
await page.waitForTimeout(300);

// ~150 in-game days at 100x.
await page.getByRole('button', { name: '100×' }).click();
await page.waitForTimeout(26000);
await clearOverlays();
await page.getByRole('button', { name: '1×' }).click();
await clearOverlays();

// Every dashboard.
for (const tab of ['Company', 'Market', 'Supply Chain', 'Population', 'Awards', 'Gazette', 'Debug']) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: /Close/ }).click().catch(() => {});
  await page.waitForTimeout(150);
}

// Flow overlay on/off.
await page.keyboard.press('f');
await page.waitForTimeout(400);
await page.keyboard.press('f');

// Inspect one of each facility type by clicking canvas positions is flaky;
// instead click through the Population citizens table (citizen inspector)
// and the Company standings (firm inspector via map click fallback).
await page.getByRole('button', { name: 'Population', exact: true }).click();
await page.waitForTimeout(300);
const row = page.locator('table tbody tr').last();
if (await row.count()) await row.click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: /Close/ }).click().catch(() => {});

// New Game modal open + cancel.
await page.getByRole('button', { name: /New/ }).first().click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: 'Cancel' }).click();

// Save + load round trip.
await page.getByRole('button', { name: /Save/ }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: /Load/ }).click();
await page.waitForTimeout(400);

// Named save slots: save-as, reopen, load, delete.
await page.getByRole('button', { name: /Slots/ }).click();
await page.waitForTimeout(250);
await page.getByPlaceholder('slot name…').fill('smoke-test');
await page.getByRole('button', { name: 'Save as' }).click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: 'Load', exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Slots/ }).click();
await page.waitForTimeout(250);
await page.getByRole('button', { name: '×', exact: true }).first().click();
await page.waitForTimeout(150);
await page.getByRole('button', { name: 'Close' }).click();

console.log(JSON.stringify({ errors, ok: errors.length === 0 }));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
