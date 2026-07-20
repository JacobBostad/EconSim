/**
 * C1 product-breadth probe — the Arc C1 diagnostic baseline.
 *
 * Arc C1 grows the consumer catalog from the shipped 8 products toward a broader
 * set, gated METROPOLIS-only (see src/sim/data/products.ts, availableIn). This
 * probe, without mutating anything, reports the numbers behind the slice:
 *
 *   (1) catalog size per preset — how many products (and consumer products) each
 *       preset actually sees, proving the gate (Village == City == base catalog,
 *       Metropolis carries the breadth);
 *   (2) budget bound — the per-tier daily consumption basket priced at the spec
 *       reference (base) price and consumed at the spec-midpoint growth rate,
 *       against the town's median income. The C1 acceptance is the worker
 *       (median-tier) basket <= 85% of median income;
 *   (3) tier bands — metropolis worker/comfortable/affluent cohort shares over
 *       the soak (the A4 recalibration target is worker 50-70 / comfortable
 *       25-40, though metropolis carries no PINNED tier-band test — it is the
 *       robust founder-count/solvency guards that pin it);
 *   (4) introduction dip — town satisfaction trajectory across the run, and the
 *       renormalization ceiling: each tier's C1-inclusive basket weight, its
 *       basketNormalization factor, and the resulting effective weight (which
 *       never exceeds BASKET_WEIGHT_BASELINE — the bound on any single product's
 *       arrival dip, A1's redistribution promise);
 *   (5) per-consumer-product service at day 300 — seller present, 14-day fill
 *       rate, units sold — so the "no chronic all-product shortage" and "the
 *       cast's C1 demand is real and served" claims are visible;
 *   (6) perf — ms/tick at day 300, and money conserved to the cent.
 *
 * Timing note: Date/Date.now is banned INSIDE the sim, but this harness runs
 * OUTSIDE it — wall timing uses process.hrtime, which never touches sim state.
 *
 * Runnable: `npx tsx docs/design/probes/c1-breadth.ts` (DAYS overrides the
 * 300-day length; SEEDS overrides the seed list, comma-separated).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG, type SizePreset } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import {
  PRODUCTS,
  PRODUCT_IDS_BY_PRESET,
  CONSUMER_PRODUCT_IDS_BY_PRESET,
  getProduct,
} from '../../../src/sim/data/products';
import { tierNeedGrowthMult } from '../../../src/sim/systems/TierSystem';
import { needWeight, soldSomewhere, BASKET_WEIGHT_BASELINE } from '../../../src/sim/systems/SatisfactionSystem';
import type { CitizenTier } from '../../../src/sim/entities/Citizen';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '7,11,4').split(',').map((s) => Number(s.trim()));
const TIERS: CitizenTier[] = ['worker', 'comfortable', 'affluent'];

function catalogSizes(): void {
  console.log('\n=== (1) catalog size per preset ===');
  for (const preset of ['village', 'city', 'metropolis'] as SizePreset[]) {
    const all = PRODUCT_IDS_BY_PRESET[preset];
    const consumer = CONSUMER_PRODUCT_IDS_BY_PRESET[preset];
    console.log(`  ${preset.padEnd(11)} products=${all.length}  consumer=${consumer.length}`);
  }
}

function dailyBasket(tier: CitizenTier): number {
  let sum = 0;
  for (const pid of CONSUMER_PRODUCT_IDS_BY_PRESET.metropolis) {
    const spec = PRODUCTS[pid]!.needSpec!;
    const midGrowth = (spec.growthPerDay[0] + spec.growthPerDay[1]) / 2;
    sum += spec.preferredQuantity * getProduct(pid).basePrice * midGrowth * tierNeedGrowthMult(tier, pid);
  }
  return sum;
}

function renormReport(): void {
  console.log('\n=== (4b) renormalization ceiling (introduction-dip bound) ===');
  for (const tier of TIERS) {
    let basketW = 0;
    for (const pid of CONSUMER_PRODUCT_IDS_BY_PRESET.metropolis) {
      if (tierNeedGrowthMult(tier, pid) > 0) basketW += needWeight(pid);
    }
    const norm = basketW > BASKET_WEIGHT_BASELINE ? BASKET_WEIGHT_BASELINE / basketW : 1;
    console.log(
      `  ${tier.padEnd(11)} basketW=${basketW.toFixed(2)} norm=${norm.toFixed(3)} effective=${(basketW * norm).toFixed(2)} (baseline ${BASKET_WEIGHT_BASELINE})`,
    );
  }
}

function runSeed(seed: number): void {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'metropolis' });
  const supply0 = totalMoneySupply(state);
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);

  const satAt: Record<number, number> = {};
  const marks = [30, 90, 150, DAYS];
  const t0 = process.hrtime.bigint();
  for (let day = 1; day <= DAYS; day++) {
    sim.run(tpd);
    if (marks.includes(day)) {
      // whole-town (cast + crowd) mass-weighted satisfaction
      let mass = 0;
      let pop = 0;
      for (const c of Object.values(state.citizens)) { mass += c.satisfaction; pop += 1; }
      for (const co of Object.values(state.cohorts)) { mass += co.avgSatisfaction * co.population; pop += co.population; }
      satAt[day] = pop > 0 ? mass / pop : 0;
    }
  }
  const ns = Number(process.hrtime.bigint() - t0);
  const msPerTick = ns / 1e6 / (tpd * DAYS);
  const st = sim.getState();

  const tally: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
  for (const co of Object.values(st.cohorts)) tally[co.tier] += co.population;
  const crowd = tally.worker + tally.comfortable + tally.affluent;

  const incomes = Object.values(st.citizens)
    .map((c) => (c.employmentStatus === 'employed' ? c.wage : st.config.subsistenceIncomePerDay))
    .sort((a, b) => a - b);
  const median = incomes[Math.floor(incomes.length / 2)] ?? 0;

  console.log(`\n===== seed ${seed} (metropolis, ${DAYS}d) =====`);
  console.log(`  conserved=${totalMoneySupply(st) === supply0}  ms/tick=${msPerTick.toFixed(3)}`);
  console.log(`  (3) tier bands (cohort): worker=${(tally.worker / crowd).toFixed(3)} comfortable=${(tally.comfortable / crowd).toFixed(3)} affluent=${(tally.affluent / crowd).toFixed(3)} crowd=${crowd}`);
  console.log(`  (2) median income=$${(median / 100).toFixed(2)}/day  basket shares:`);
  for (const tier of TIERS) {
    const b = dailyBasket(tier);
    console.log(`        ${tier.padEnd(11)} $${(b / 100).toFixed(2)}/day  share=${median > 0 ? (b / median).toFixed(2) : 'n/a'}${tier === 'worker' ? '  <-- C1 acceptance (<=0.85)' : ''}`);
  }
  console.log(`  (4a) town satisfaction: ${marks.map((d) => `d${d}=${(satAt[d] ?? 0).toFixed(1)}`).join(' ')}`);
  const ai = Object.values(st.firms).filter((f) => f.ownerType === 'ai');
  console.log(`  (6) AI firms=${ai.length} unhealthy=${ai.filter((f) => f.bankruptcyStatus !== 'healthy').length}`);
  console.log(`  (5) per-consumer-product service (last 14d):`);
  for (const pid of CONSUMER_PRODUCT_IDS_BY_PRESET.metropolis) {
    const h = st.marketStats[pid]?.history ?? [];
    let sold = 0;
    let unmet = 0;
    for (let i = Math.max(0, h.length - 14); i < h.length; i++) { sold += h[i]!.unitsSold; unmet += h[i]!.unmetDemand; }
    const fill = sold + unmet > 0 ? sold / (sold + unmet) : 1;
    const c1 = PRODUCTS[pid]!.availableIn === 'metropolis' ? ' [C1]' : '';
    console.log(`        ${pid.padEnd(11)} seller=${soldSomewhere(st, pid) ? 'Y' : 'n'} fill=${fill.toFixed(2)} sold=${sold}${c1}`);
  }
}

catalogSizes();
renormReport();
for (const seed of SEEDS) runSeed(seed);
