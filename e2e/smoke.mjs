import { chromium } from 'playwright-core';

const errors = [];
// Chromium: honor an explicit path, else let playwright-core resolve its
// own managed browser (CI installs it via `npx playwright-core install chromium`).
const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const BASE_URL = process.env.BASE_URL || 'http://localhost:4173';
await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const intro = page.locator('.intro-go');
if (await intro.count()) await intro.first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: 'e2e/.artifacts/shot-main.png' });

await page.getByRole('button', { name: /New/ }).first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'e2e/.artifacts/shot-newgame.png' });
await page.locator('.difficulty-card').nth(2).click();
await page.getByRole('button', { name: 'Start town' }).click();
await page.waitForTimeout(500);

await page.getByRole('button', { name: /Bread chain/ }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: 'e2e/.artifacts/shot-wizard.png' });

for (const tab of ['Company', 'Market', 'Awards']) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `e2e/.artifacts/shot-${tab.toLowerCase()}.png` });
  await page.getByRole('button', { name: /Close/ }).click();
}

await page.getByRole('button', { name: '100×' }).click();
await page.waitForTimeout(6000);
await page.screenshot({ path: 'e2e/.artifacts/shot-running.png' });

console.log(JSON.stringify({ errors, title: await page.title() }, null, 2));
await browser.close();
