/**
 * Region UI smoke: start a City game — which now opts into the REGION by default
 * (regionEnabled, alongside the risk-tiered interest every new game gets) — and
 * exercise the era's one genuinely new play: the FREIGHT EDGE to the live
 * partner town, Port Rosa. citysmoke covers the crowd/archetype render paths;
 * this is the only e2e that drives a second live economy.
 *
 * The run: start City seed 11 (a live partner materializes at `port_rosa`), run
 * ~25 days so the partner's book has real sales history (its cohorts have been
 * shopping), confirm the Gazette's Trade Desk renders the live-partner cover, then
 * build a player warehouse, buy a staple into it from a port, and FREIGHT it to
 * Port Rosa. A freight dispatch is a dated inter-town shipment (goods leave now,
 * pay on arrival FREIGHT_LEAD_DAYS later), so we assert its dispatch event, then
 * run past the lead time and assert the DELIVERY event — the shipment round-trips.
 * Zero page errors throughout. Polls the day counter / event log, so it is robust
 * to machine speed.
 *
 * It also doubles as the region MEDIA-CAPTURE pass (same page.screenshot →
 * e2e/.artifacts idiom smoke.mjs uses): it snaps the warmed region view (town
 * switcher chrome), the Gazette Trade Desk (Port Rosa's live-partner book), and
 * the in-flight freight (the warehouse freight action + dispatch chip) into
 * e2e/.artifacts/shot-region-*.png. Captures are non-fatal (.catch), so they
 * never fail the smoke; the docs/media refresh curates from these artifacts.
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
async function eventLogText() {
  return (await page.locator('.eventlog').textContent().catch(() => '')) || '';
}

await clearOverlays();

// New game → City (the crowd economy, now region-enabled) → pin seed 11 → start.
await page.getByRole('button', { name: /New/ }).first().click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /crowd of hundreds/ }).click();
await page.waitForTimeout(200);
await page.locator('#seed-input').fill('11');
await page.getByRole('button', { name: 'Start town' }).click();
await page.waitForTimeout(400);
await clearOverlays();

// Run ~25 days at 100× so the partner economy demonstrably moves (its cohorts
// shop, its market book fills with sales history). Poll the day counter.
const TARGET_DAY = 25;
await page.getByRole('button', { name: '100×' }).click();
let deadline = Date.now() + 60000;
while ((await currentDay()) < TARGET_DAY && Date.now() < deadline) {
  await page.waitForTimeout(500);
  await clearOverlays();
}
await page.getByRole('button', { name: '1×' }).click();
await clearOverlays();
const reachedDay = await currentDay();
if (reachedDay < 20) throw new Error(`region sim only reached day ${reachedDay} — too slow to warm the partner economy`);

// Media capture (the README-refresh mechanism — same page.screenshot →
// e2e/.artifacts idiom smoke.mjs/switchersmoke.mjs use). Non-fatal (.catch): a
// capture failure must never fail the smoke. The warmed region view carries the
// town switcher chrome (a City game now opts into the region), the shot the docs
// media refresh recaptures for the switcher.
await page.screenshot({ path: 'e2e/.artifacts/shot-region-main.png' }).catch(() => {});

// Gazette Trade Desk: the live-partner era surfaces cover at the ports — assert
// the desk renders (it reads the partner's real book), then close.
await page.getByRole('button', { name: 'Gazette', exact: true }).click();
await page.waitForTimeout(400);
if (!(await page.getByRole('heading', { name: /Trade Desk/ }).count())
    && !(await page.getByText(/Trade Desk/).count())) {
  throw new Error('Gazette shows no Trade Desk in a region-enabled City game');
}
// Capture the Trade Desk showing Port Rosa's live-partner book — the docs media
// refresh for the Port Rosa "book" shot.
await page.screenshot({ path: 'e2e/.artifacts/shot-region-tradedesk.png' }).catch(() => {});
await page.getByRole('button', { name: /Close/ }).click().catch(() => {});
await page.waitForTimeout(150);

// Build a player warehouse: pick it in the Build panel, then sweep the map for a
// spot that accepts placement (the "Placing …" card disappears on success).
await page.getByRole('button', { name: /^Warehouse —/ }).click();
await page.waitForTimeout(200);
// Zoom out a little so more buildable ground is in frame for the sweep.
for (let i = 0; i < 2; i++) { await page.keyboard.press('-'); await page.waitForTimeout(80); }
let placedAt = null;
for (let gx = 620; gx <= 1040 && !placedAt; gx += 60) {
  for (let gy = 380; gy <= 720; gy += 60) {
    await page.mouse.click(gx, gy);
    await page.waitForTimeout(120);
    if (!(await page.getByText(/^Placing /).count())) { placedAt = [gx, gy]; break; }
  }
}
if (!placedAt) throw new Error('warehouse placement never accepted across the map sweep');

// Select the just-built warehouse (click its tile) → its actions open in the
// right panel. Retry a few nearby points until the export card appears.
let exportCardOpen = false;
for (const [dx, dy] of [[0, 0], [8, 0], [0, 8], [-8, 0], [0, -8]]) {
  await page.mouse.click(placedAt[0] + dx, placedAt[1] + dy);
  await page.waitForTimeout(250);
  if (await page.getByText(/Export — Port Rosa/).count()) { exportCardOpen = true; break; }
}
if (!exportCardOpen) throw new Error('warehouse inspector / export card never opened after placement');

// Commodity desk: buy a staple (bread) into the warehouse from Ironvale (its food
// discount makes it the cheap fill), so there is stock to freight.
await page.locator('select:has(option[value="bread"])').first().selectOption('bread');
await page.waitForTimeout(150);
await page.getByRole('button', { name: /Buy @/ }).nth(1).click(); // Ironvale (🚂), the 2nd port
await page.waitForTimeout(250);

// Freight the bread to Port Rosa — the live partner freight edge.
await page.getByRole('button', { name: /Freight to Port Rosa/ }).first().click();
await page.waitForTimeout(300);

// The dispatch event must appear in the log ("… dispatched to Port Rosa …").
let dispatched = false;
deadline = Date.now() + 8000;
while (Date.now() < deadline) {
  if (/dispatched to Port Rosa/.test(await eventLogText())) { dispatched = true; break; }
  await page.waitForTimeout(300);
}
if (!dispatched) throw new Error('no freight-dispatch event appeared after shipping to Port Rosa');

// Capture the in-flight state — the warehouse export card's freight action + the
// dispatch event chip in the log — the docs media refresh for the freight chip.
await page.screenshot({ path: 'e2e/.artifacts/shot-region-freight.png' }).catch(() => {});

// Run past the lead time; the shipment must ROUND-TRIP — land and pay, logging a
// delivery event ("Freight delivered to Port Rosa").
await page.getByRole('button', { name: '100×' }).click();
let delivered = false;
deadline = Date.now() + 30000;
while (Date.now() < deadline) {
  if (/Freight delivered to Port Rosa/.test(await eventLogText())) { delivered = true; break; }
  await page.waitForTimeout(400);
  await clearOverlays();
}
await page.getByRole('button', { name: '1×' }).click().catch(() => {});
if (!delivered) throw new Error('the freight shipment never delivered (no round-trip) within the lead window');

console.log(JSON.stringify({ reachedDay, placedAt, dispatched, delivered, errors, ok: errors.length === 0 }));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
