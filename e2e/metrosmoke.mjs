/**
 * Metropolis UI smoke: start a world-scale Metropolis game (the biggest map, the
 * full 18-product catalog, the 30-firm founder field) and drive it a few days
 * panel-open, asserting zero page errors throughout. Deliberately short-horizon
 * (the citysmoke idiom, ~day 10 not ~day 60): the goal is to prove the New-Game
 * Metropolis option boots, the crowd/district render paths run on the 390×276
 * map, and the wider catalog surfaces — not to reach a founder milestone
 * (metropolis founder pacing is covered by the probes/soaks). Timing-robust: it
 * polls the day counter rather than trusting a wall-clock wait.
 */
import { chromium } from 'playwright-core';

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

async function currentDay() {
  const txt = await page.locator('.topbar .value.mono').first().textContent().catch(() => null);
  const m = txt && txt.match(/Day\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

await clearOverlays();

// New game → pick the Metropolis world scale (its card's accessible name carries
// the unique "biggest map" blurb) → pin a seed so the run is deterministic → start.
await page.getByRole('button', { name: /New/ }).first().click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /biggest map/ }).click();
await page.waitForTimeout(200);
await page.locator('#seed-input').fill('11');
await page.getByRole('button', { name: 'Start town' }).click();
await page.waitForTimeout(400);
await clearOverlays();

// Open the Build panel so its metropolis render path is exercised (chain
// affordability itself is pinned by the playability probe + unit tests, not
// asserted here — this smoke only guards against page errors).
await page.getByRole('button', { name: /Build/ }).first().click().catch(() => {});
await page.waitForTimeout(200);

// Run a few days at 100× (fast), polling the day counter.
const TARGET_DAY = 10;
await page.getByRole('button', { name: '100×' }).click();
const deadline = Date.now() + 30000;
while ((await currentDay()) < TARGET_DAY && Date.now() < deadline) {
  await page.waitForTimeout(400);
  await clearOverlays();
}
await page.getByRole('button', { name: '1×' }).click();
await clearOverlays();
const reachedDay = await currentDay();
if (reachedDay < 5) throw new Error(`metropolis sim only reached day ${reachedDay} — too slow to boot the crowd render paths`);

// Population dashboard: districts render on the big map (crowd economy is on).
await page.getByRole('button', { name: 'Population', exact: true }).click();
await page.waitForTimeout(400);
if (!(await page.getByRole('heading', { name: 'Districts' }).count())) {
  throw new Error('Population dashboard has no Districts section in a Metropolis game');
}
await page.getByRole('button', { name: /Close/ }).click().catch(() => {});
await page.waitForTimeout(150);

// The wider catalog + era-adjacent dashboards render clean.
for (const tab of ['Market', 'Supply Chain', 'Company', 'Gazette']) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Close/ }).click().catch(() => {});
  await page.waitForTimeout(120);
}

console.log(JSON.stringify({ reachedDay, errors, ok: errors.length === 0 }));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
