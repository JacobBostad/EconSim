/**
 * City-soak probe — the A3 slices 1-2 live baseline.
 *
 * Runs the CITY size preset (crowd cohorts ON) for 300 days × seeds 11/4/7 and
 * measures the live crowd economy that CohortLaborSystem (slice 1) and
 * CohortDemandSystem (slice 2) actually produce — nothing is mutated beyond
 * running the sim; this probe only reads state. It answers the questions the
 * as-built doc needs before slice 3 (satisfaction/tier gates) lands:
 *
 *   (a) does the AI founder system respond to crowd demand — do new sellers
 *       appear and close the staple unmet-demand gap?
 *   (b) do cohort cashPools grow without bound (wage+stipend inflow vs
 *       trip-limited spending) — the slice-3 concern — and at what drift rate?
 *   (c) does the cast starve — cast avg satisfaction vs the Village ~48-58 band?
 *   (d) perf — ms/tick at day 300 vs the 0.6ms A3 budget;
 *   (e) money conserved to the cent on every seed.
 *
 * Timing note: Date/Date.now is banned INSIDE the sim, but this harness runs
 * OUTSIDE it — wall timing uses process.hrtime, which never touches sim state.
 *
 * Runnable: `npx tsx docs/design/probes/city-soak.ts` (DAYS env overrides the
 * 300-day length; SEEDS overrides the seed list, comma-separated).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import { ALL_PRODUCT_IDS, PRODUCTS } from '../../../src/sim/data/products';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map((s) => Number(s.trim()));
const CHECK_EVERY = 10;
// Staples the crowd leans on hardest — the founder system's own gap products
// plus coffee (a comfort good). Reported per name; the rest roll into a total.
const REPORTED = ['bread', 'tools', 'clothes', 'coffee'];
const CENTS = 100;

const D = (cents: number) => (cents / CENTS).toFixed(2);

function crowd(state: GameState): { pop: number; employed: number; pool: number } {
  let pop = 0, employed = 0, pool = 0;
  for (const cid in state.cohorts) {
    const c = state.cohorts[cid]!;
    pop += c.population;
    employed += c.employed;
    pool += c.cashPool;
  }
  return { pop, employed, pool };
}

function castAvgSat(state: GameState): { n: number; sat: number } {
  let n = 0, sat = 0;
  for (const cid in state.citizens) {
    n += 1;
    sat += state.citizens[cid]!.satisfaction;
  }
  return { n, sat: n > 0 ? sat / n : 0 };
}

function firmTally(state: GameState): { total: number; ai: number; distressed: number; insolvent: number } {
  let total = 0, ai = 0, distressed = 0, insolvent = 0;
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    if (f.ownerType !== 'ai' && f.ownerType !== 'player') continue;
    total += 1;
    if (f.ownerType === 'ai') ai += 1;
    if (f.bankruptcyStatus === 'distressed') distressed += 1;
    if (f.bankruptcyStatus === 'insolvent') insolvent += 1;
  }
  return { total, ai, distressed, insolvent };
}

interface Checkpoint {
  day: number;
  crowdPop: number;
  crowdEmployed: number;
  poolTotalCents: number;
  poolPerCapitaCents: number;
  castPop: number;
  castSat: number;
  aiFirms: number;
  totalFirms: number;
  distressed: number;
  insolvent: number;
  // window (last CHECK_EVERY days) per-day averages
  soldPerDay: Record<string, number>;
  unmetPerDay: Record<string, number>;
  msPerTick: number;
  moneySupplyCents: number;
  conservedDeltaCents: number;
}

for (const seed of SEEDS) {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const initialMoney = totalMoneySupply(state);

  const c0 = crowd(state);
  const ft0 = firmTally(state);
  console.log(
    `\n=== seed ${seed} — City preset (crowdStart ${c0.pop}, pool ${D(c0.pool)}, ` +
    `AI firms ${ft0.ai}, cast ${Object.keys(state.citizens).length}, money ${D(initialMoney)}) ===`,
  );

  const checkpoints: Checkpoint[] = [];
  // Per-window per-day accumulators over marketStats daily history snapshots.
  let winSold: Record<string, number> = {};
  let winUnmet: Record<string, number> = {};
  let winNs = 0n; // wall nanoseconds accumulated this window
  let winTicks = 0;
  for (const pid of ALL_PRODUCT_IDS) { winSold[pid] = 0; winUnmet[pid] = 0; }

  let worstConserved = 0;

  for (let day = 1; day <= DAYS; day++) {
    const t0 = process.hrtime.bigint();
    sim.run(tpd);
    const t1 = process.hrtime.bigint();
    winNs += t1 - t0;
    winTicks += tpd;

    // The just-finalized day is the last history snapshot for each product.
    for (const pid of ALL_PRODUCT_IDS) {
      const hist = state.marketStats[pid]!.history;
      const snap = hist.length > 0 ? hist[hist.length - 1]! : null;
      if (snap && snap.day === day - 1) {
        winSold[pid]! += snap.unitsSold;
        winUnmet[pid]! += snap.unmetDemand;
      }
    }

    const money = totalMoneySupply(state);
    const delta = Math.abs(money - initialMoney);
    if (delta > worstConserved) worstConserved = delta;

    if (day % CHECK_EVERY === 0) {
      const cw = crowd(state);
      const cs = castAvgSat(state);
      const ft = firmTally(state);
      const soldPerDay: Record<string, number> = {};
      const unmetPerDay: Record<string, number> = {};
      let otherSold = 0, otherUnmet = 0;
      for (const pid of ALL_PRODUCT_IDS) {
        if (!PRODUCTS[pid]!.needSpec) continue;
        if (REPORTED.includes(pid)) {
          soldPerDay[pid] = winSold[pid]! / CHECK_EVERY;
          unmetPerDay[pid] = winUnmet[pid]! / CHECK_EVERY;
        } else {
          otherSold += winSold[pid]!;
          otherUnmet += winUnmet[pid]!;
        }
      }
      soldPerDay['other'] = otherSold / CHECK_EVERY;
      unmetPerDay['other'] = otherUnmet / CHECK_EVERY;

      const cp: Checkpoint = {
        day,
        crowdPop: cw.pop,
        crowdEmployed: cw.employed,
        poolTotalCents: cw.pool,
        poolPerCapitaCents: cw.pop > 0 ? cw.pool / cw.pop : 0,
        castPop: cs.n,
        castSat: cs.sat,
        aiFirms: ft.ai,
        totalFirms: ft.total,
        distressed: ft.distressed,
        insolvent: ft.insolvent,
        soldPerDay,
        unmetPerDay,
        msPerTick: Number(winNs) / 1e6 / winTicks,
        moneySupplyCents: money,
        conservedDeltaCents: money - initialMoney,
      };
      checkpoints.push(cp);

      const staple = REPORTED.map(
        (p) => `${p} ${(soldPerDay[p] ?? 0).toFixed(0)}s/${(unmetPerDay[p] ?? 0).toFixed(0)}u`,
      ).join('  ');
      console.log(
        `d${String(day).padStart(3)} ` +
        `crowd ${cw.pop}/${cw.employed}emp pool ${D(cw.pool)} (${D(cp.poolPerCapitaCents)}/cap) | ` +
        `cast ${cs.n}@sat ${cs.sat.toFixed(1)} | AI ${ft.ai} tot ${ft.total} dist ${ft.distressed} ins ${ft.insolvent} | ` +
        `${staple} | ${cp.msPerTick.toFixed(3)}ms/t | consΔ ${cp.conservedDeltaCents}c`,
      );

      // reset window
      winSold = {}; winUnmet = {};
      for (const pid of ALL_PRODUCT_IDS) { winSold[pid] = 0; winUnmet[pid] = 0; }
      winNs = 0n; winTicks = 0;
    }
  }

  // ---- per-seed analysis summary ----
  const first = checkpoints[0]!;
  const last = checkpoints[checkpoints.length - 1]!;
  const spanDays = last.day - first.day;
  // Pool drift: cents/day total and per-capita, measured across the run body.
  const poolDriftPerDay = spanDays > 0 ? (last.poolTotalCents - first.poolTotalCents) / spanDays : 0;
  const perCapDriftPerDay = spanDays > 0
    ? (last.poolPerCapitaCents - first.poolPerCapitaCents) / spanDays : 0;

  console.log(JSON.stringify({
    seed,
    founderResponse: {
      aiFirmsStart: ft0.ai,
      aiFirmsEnd: last.aiFirms,
      totalFirmsEnd: last.totalFirms,
      breadUnmetPerDayFirst: first.unmetPerDay['bread'],
      breadUnmetPerDayLast: last.unmetPerDay['bread'],
      breadSoldPerDayLast: last.soldPerDay['bread'],
    },
    poolDrift: {
      startTotal: D(first.poolTotalCents),
      endTotal: D(last.poolTotalCents),
      driftPerDay: D(poolDriftPerDay),
      startPerCapita: D(first.poolPerCapitaCents),
      endPerCapita: D(last.poolPerCapitaCents),
      perCapitaDriftPerDay: D(perCapDriftPerDay),
    },
    castSat: {
      first: first.castSat.toFixed(1),
      last: last.castSat.toFixed(1),
      min: Math.min(...checkpoints.map((c) => c.castSat)).toFixed(1),
      max: Math.max(...checkpoints.map((c) => c.castSat)).toFixed(1),
    },
    perf: {
      msPerTickLast: last.msPerTick.toFixed(3),
      msPerTickMax: Math.max(...checkpoints.map((c) => c.msPerTick)).toFixed(3),
      engineAvgTickMs: state.perf.avgTickMs.toFixed(3),
    },
    conservation: {
      initialCents: initialMoney,
      finalCents: last.moneySupplyCents,
      worstDeltaCents: worstConserved,
      conservedToCent: worstConserved === 0,
    },
    crowdEnd: { pop: last.crowdPop, employed: last.crowdEmployed },
  }, null, 1));
}
