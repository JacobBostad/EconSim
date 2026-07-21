/**
 * FPS guard: drive a CITY-preset town (a crowd of hundreds — the heavy render
 * case) to a late-game state, then sample the renderer's frame period via the
 * page's own requestAnimationFrame and assert the MEAN stays under a generous
 * headless-safe bound. This exists to catch a ~10x render regression (a culling
 * or LOD path that starts drawing the whole map at full detail every frame), not
 * a 20% wobble — headless CI timing is noisy, so the bound carries ~3x headroom
 * and asserts on the MEAN (the stable statistic; p95/max swing run-to-run).
 *
 * Pinning measurement (this box, headless_shell, 100x running, 150-day City):
 * mean frame period ~22-24 ms across 5 runs (p50 16.7 ms = vsync-capped 60 fps;
 * the mean is lifted by the occasional heavy frame). Bound pinned at 80 ms ~=
 * 3.3x the worst observed mean — a 10x regression lands the mean near ~230 ms
 * and trips this by a wide margin, while a healthy renderer (even on a 2-3x
 * slower CI box) never approaches it.
 */
import { chromium } from 'playwright-core';

// Assert on the MEAN frame period. Measured ~22-24 ms; pinned at ~3.3x headroom.
const MEAN_FRAME_MS_MAX = 80;

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

// Single-exit like deepsmoke.mjs: failures accumulate here and decide the exit
// code at the end — fail() must never let execution fall through to the ok:true
// success line, or a regression exits 0.
const failures = [];
function fail(msg) {
  failures.push(msg);
}

await clearOverlays();
await page.getByRole('button', { name: /New/ }).first().click();
await page.waitForTimeout(300);
// CITY world scale — a crowd of hundreds on the 260x184 map, the heavy render case.
await page.getByRole('button', { name: /crowd of hundreds/ }).click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: 'Start town' }).click();
await page.waitForTimeout(400);
await clearOverlays();

// Build player chains so the late-game state is rich (more to draw each frame).
await page.getByRole('button', { name: /Bread chain/ }).click();
await page.getByRole('button', { name: /Coffee chain/ }).click();
await page.getByRole('button', { name: /Apartment/ }).click();
for (const [x, y] of [[700, 620], [745, 600], [660, 645], [780, 630], [630, 600]]) {
  await page.mouse.click(x, y);
  await page.waitForTimeout(250);
  if (!(await page.getByText(/^Placing /).count())) break;
}

// ~150 in-game days at 100x — grows the AI chains and crowd into a dense town.
await page.getByRole('button', { name: '100×' }).click();
await page.waitForTimeout(26000);
await clearOverlays();

// Sample the renderer's frame period over ~180 frames while it runs at 100x (sim
// + render both hot). The renderer owns the rAF loop; we piggyback a second rAF
// and read the interval between successive animation frames — the real budget.
const stats = await page.evaluate(async () => {
  const deltas = [];
  await new Promise((resolve) => {
    let last = performance.now();
    let n = 0;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (++n >= 180) return resolve();
      requestAnimationFrame(tick);
    };
    // Prime `last` on the first frame so the initial delta isn't measured from
    // page-load time.
    requestAnimationFrame((now) => { last = now; requestAnimationFrame(tick); });
  });
  deltas.sort((a, b) => a - b);
  const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const q = (p) => deltas[Math.min(deltas.length - 1, Math.floor(p * deltas.length))];
  return { n: deltas.length, mean, p50: q(0.5), p95: q(0.95), max: deltas[deltas.length - 1] };
});

if (errors.length > 0) fail(`page errors during fps run: ${errors.join(' | ')}`);
if (!stats || !Number.isFinite(stats.mean) || stats.n < 60) {
  // No stable measurement — report it rather than assert a flaky guard.
  fail(`no stable frame-time sample (${JSON.stringify(stats)})`);
} else if (stats.mean > MEAN_FRAME_MS_MAX) {
  fail(`mean frame ${stats.mean.toFixed(1)}ms exceeds ${MEAN_FRAME_MS_MAX}ms bound (${JSON.stringify(stats)})`);
}

console.log(JSON.stringify({ ok: failures.length === 0, failures, boundMs: MEAN_FRAME_MS_MAX, stats, errors }));
await browser.close();
process.exit(failures.length === 0 ? 0 : 1);
