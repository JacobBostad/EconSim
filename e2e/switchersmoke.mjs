/**
 * switchersmoke.mjs — the town switcher, first slice (region.md step 5: the
 * player can LOOK at Port Rosa).
 *
 * Written first against a HEAD where no preset enabled the region; the
 * consolidation slice then flipped `regionEnabled` ON for City new games, so
 * this smoke now covers BOTH sides of the contract in one run:
 *
 *  (1) FLAG-OFF (Village new game — the region flag is double-gated off there):
 *      the switcher renders ZERO chrome — no `.town-switcher` element anywhere.
 *      The DOM proof of the "flag-off UI is byte-identical" contract.
 *  (2) FLAG-ON (City new game — region on by default since the consolidation):
 *      the switcher renders, clicking Port Rosa shows the partner's read-only
 *      book with the "You don't operate here — yet." affordance and the
 *      partner-view map hint, and switching back restores the home view.
 *
 * The operate-guard's dispatch-level enforcement (`isHomeView` gating build +
 * entity-select in the store callbacks) is click-verified at the store layer in
 * src/sim/tests/townSwitcher.test.ts; here we verify the visible affordances.
 *
 * Run: npm run build && npx vite preview --port 4173 & then
 *      node e2e/switchersmoke.mjs   (CHROMIUM_PATH / BASE_URL as the others).
 */
import { chromium } from 'playwright-core';

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

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

async function newGame(worldRe) {
  await page.getByRole('button', { name: /New/ }).first().click();
  await page.waitForTimeout(300);
  const card = page.locator('.difficulty-card', { hasText: worldRe });
  if (await card.count()) await card.first().click();
  const seed = page.locator('input[type="number"], input[name="seed"]').first();
  if (await seed.count()) await seed.fill('11').catch(() => {});
  await page.getByRole('button', { name: /Start/ }).first().click();
  await page.waitForTimeout(800);
}

const failures = [];
function check(name, cond) {
  if (!cond) failures.push(name);
}

await clearOverlays();

// ---- (1) FLAG-OFF: a Village game renders no switcher chrome, ever. ----
await newGame(/Village/);
check('flag-off (Village): no .town-switcher chrome renders',
  (await page.locator('.town-switcher').count()) === 0);
await page.getByRole('button', { name: '100×' }).click().catch(() => {});
await page.waitForTimeout(2500);
check('flag-off (Village): still no .town-switcher after running',
  (await page.locator('.town-switcher').count()) === 0);

// ---- (2) FLAG-ON: a City game (region on by default) has the switcher. ----
await clearOverlays();
await newGame(/City/);
const switcherCount = await page.locator('.town-switcher').count();
check('flag-on (City): the .town-switcher renders', switcherCount === 1);

// Switch to Port Rosa: the read-only book + the operate affordance appear.
await page.locator('.town-switcher-tabs button', { hasText: /Port Rosa/ }).first()
  .click({ timeout: 4000 }).catch(() => {});
await page.waitForTimeout(600);
check('partner view: the town book renders', (await page.locator('.town-book').count()) === 1);
const note = await page.locator('.town-book-note').first().textContent().catch(() => '');
check('partner view: the operate affordance shows', /don’t operate here/.test(note ?? ''));
const hint = await page.locator('.map-hint').first().textContent().catch(() => '');
check('partner view: the map hint says viewing a partner city', /partner city/.test(hint ?? ''));

// Switch back home: the book goes away, the classic hint returns.
await page.locator('.town-switcher-tabs button').first().click({ timeout: 4000 }).catch(() => {});
await page.waitForTimeout(600);
check('back home: the town book is gone', (await page.locator('.town-book').count()) === 0);
const hint2 = await page.locator('.map-hint').first().textContent().catch(() => '');
check('back home: classic map hint restored', !!hint2 && !/partner city/.test(hint2));

check('zero page errors', errors.length === 0);

await page.screenshot({ path: 'e2e/.artifacts/shot-switcher.png' }).catch(() => {});

const result = { failures, errors, switcherCount, title: await page.title() };
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (failures.length || errors.length) process.exit(1);
