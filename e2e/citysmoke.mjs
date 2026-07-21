/**
 * City UI smoke: start a world-scale City game (the crowd + archetype era) and
 * drive it past the landlord-founding threshold (~day 60), then open every
 * panel that carries the new era —
 * the Population dashboard's Districts + crowd cohort trends, the Company
 * dashboard's Standings & Stock Market (trade a rival, expand the ladder), a
 * facility inspector via a map sweep (a datacenter/office if the sweep lands on
 * one), and the Build panel's lease-from-landlord finance option — asserting
 * zero page errors throughout. smoke/deepsmoke play a Village; this is the only
 * e2e that exercises the City render paths (cohorts, districts, holdco standings,
 * service firms). Timing-robust in the deepsmoke idiom: it polls the day counter
 * rather than trusting a fixed wall-clock wait.
 */
import { chromium } from 'playwright-core';

// Chromium: honor an explicit path, else let playwright-core resolve its own
// managed browser (CI installs it via `npx playwright-core install chromium`).
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

// Current in-game day, read from the TopBar "Time" stat ("Day N (…) HH:00").
async function currentDay() {
  const txt = await page.locator('.topbar .value.mono').first().textContent().catch(() => null);
  const m = txt && txt.match(/Day\s+(\d+)/);
  return m ? Number(m[1]) : 0;
}

await clearOverlays();

// New game → pick the City world scale (the beta crowd economy) → pin a seed so
// the run is deterministic (landlord firms found by ~day 56 on this seed, so a
// ~day-60 run guarantees the lease affordance) → start.
await page.getByRole('button', { name: /New/ }).first().click();
await page.waitForTimeout(300);
// The world-scale card's accessible name carries its unique blurb.
await page.getByRole('button', { name: /crowd of hundreds/ }).click();
await page.waitForTimeout(200);
await page.locator('#seed-input').fill('11');
await page.getByRole('button', { name: 'Start town' }).click();
await page.waitForTimeout(400);
await clearOverlays();

// Run past the landlord threshold at 100×, polling the day counter (robust to
// machine speed rather than a fixed wall-clock wait).
const TARGET_DAY = 62;
await page.getByRole('button', { name: '100×' }).click();
const deadline = Date.now() + 60000;
while ((await currentDay()) < TARGET_DAY && Date.now() < deadline) {
  await page.waitForTimeout(500);
  await clearOverlays();
}
await page.getByRole('button', { name: '1×' }).click();
await clearOverlays();
const reachedDay = await currentDay();
if (reachedDay < 58) throw new Error(`city sim only reached day ${reachedDay} — too slow to exercise the landlord/lease era`);

// Population dashboard: districts + crowd cohort trends must render.
await page.getByRole('button', { name: 'Population', exact: true }).click();
await page.waitForTimeout(400);
if (!(await page.getByRole('heading', { name: 'Districts' }).count())) {
  throw new Error('Population dashboard has no Districts section in a City game');
}
await page.getByRole('button', { name: /Close/ }).click().catch(() => {});
await page.waitForTimeout(150);

// Company dashboard: Standings & Stock Market — trade a rival and expand the
// full ladder (holdco/service/landlord rows all render).
await page.getByRole('button', { name: 'Company', exact: true }).click();
await page.waitForTimeout(400);
if (!(await page.getByRole('heading', { name: /Standings & Stock Market/ }).count())) {
  throw new Error('Company dashboard missing the Standings & Stock Market section');
}
await page.getByRole('button', { name: /Show all/ }).first().click().catch(() => {});
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Buy 5%' }).first().click().catch(() => {});
await page.waitForTimeout(200);
await page.getByRole('button', { name: /Close/ }).click().catch(() => {});
await page.waitForTimeout(150);

// Other era-adjacent dashboards render clean too.
for (const tab of ['Market', 'Supply Chain', 'Gazette']) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Close/ }).click().catch(() => {});
  await page.waitForTimeout(120);
}

// Facility inspector via a canvas sweep: zoom out so more of the city is in
// frame, then click a grid of points to land on a building. A pick swaps the
// right-panel inspector from its default (the player firm) to the clicked
// entity, exercising the City facility-inspector render path — and a datacenter/
// office if the sweep lands on one (the seeded Cirrus provider runs from day 1).
// Best-effort: the value is exercising the render, not which building we hit.
for (let i = 0; i < 4; i++) { await page.keyboard.press('-'); await page.waitForTimeout(80); }
let inspectedFacility = false;
let inspectedDatacenter = false;
for (let gx = 620; gx <= 1040 && !inspectedDatacenter; gx += 60) {
  for (let gy = 380; gy <= 720; gy += 60) {
    await page.mouse.click(gx, gy);
    await page.waitForTimeout(120);
    const insp = await page.locator('.right.panel').textContent().catch(() => '');
    if (insp && /Datacenter|Consulting|compute|seats/i.test(insp)) { inspectedDatacenter = true; inspectedFacility = true; break; }
    if (insp && /Staff|Employees|Recipe|Sells|Residents|Land value/i.test(insp)) inspectedFacility = true;
  }
}

// Build panel lease option: select a buildable, then the "Lease from <landlord>"
// finance buttons appear once landlord firms have founded (they have by ~day 40
// in a City game). Assert the lease affordance is live, then cancel out.
await page.getByRole('button', { name: /^Farm —/ }).click();
await page.waitForTimeout(250);
const leaseVisible = await page.getByRole('button', { name: /Lease from/ }).count();
if (!leaseVisible) throw new Error('Build panel shows no Lease-from-landlord option in a City game at day ~40');
await page.getByRole('button', { name: /Lease from/ }).first().click();
await page.waitForTimeout(150);
await page.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
await page.keyboard.press('Escape');

console.log(JSON.stringify({ reachedDay, inspectedFacility, inspectedDatacenter, errors, ok: errors.length === 0 }));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
