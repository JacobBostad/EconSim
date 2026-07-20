/**
 * Founder-scale probe — the A5 diagnostic baseline.
 *
 * The founder caps exist (founderMaxAiFirms 6/18/30) and A4 gave founders a
 * physical district to build in, but nothing had ever verified the Metropolis
 * actually REACHES its 30-firm cap — the founder signals (persistent vacancy;
 * under-supply fill-rate < 0.65 for 15d with a 20d town-wide cooldown, city-only)
 * were tuned for far fewer firms. This probe runs Metropolis and City for 300
 * days × 3 seeds each and, without mutating anything, diagnoses the BINDING
 * constraint on the AI firm count:
 *
 *   (1) firm count over time — does it plateau, and where vs the cap;
 *   (2) abort-reason table — each day the firm count sits below the cap, which
 *       gate is the limiter (pre-earliest / population / world-cash / no-signal /
 *       under-supply cooldown / unaffordable / vacancy-satisfaction). The gates
 *       are RE-EVALUATED read-only in the same order the founder loop uses, so
 *       the tally tells us whether the signal never fires, placement fails, or
 *       the capital gate bites;
 *   (3) solvency at 300 — firms healthy / distressed / insolvent, plus the
 *       day-300 cash distribution (min / median / max);
 *   (4) wholesale spread band — the realized wholesalePriceMult across active
 *       wholesaler facilities (task target band 0.55-0.85);
 *   (5) perf — ms/tick at day 300.
 *
 * Timing note: Date/Date.now is banned INSIDE the sim, but this harness runs
 * OUTSIDE it — wall timing uses process.hrtime, which never touches sim state.
 *
 * Runnable: `npx tsx docs/design/probes/founder-scale.ts` (DAYS overrides the
 * 300-day length; SEEDS overrides the seed list; PRESETS overrides the preset
 * list, comma-separated).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import {
  founderMaxAiFirms,
  founderUndersupplyCooldown,
  founderUndersupplyFillRate,
  founderCash,
  FOUNDER_PRODUCTS,
} from '../../../src/sim/systems/AIFounderSystem';
import { CHAIN_BLUEPRINTS, chainCost } from '../../../src/sim/data/chains';
import {
  IMMIGRATION_MIN_SATISFACTION,
  FOUNDER_EARLIEST_DAY,
  FOUNDER_GAP_DAYS,
  FOUNDER_MIN_POPULATION,
  FOUNDER_UNDERSUPPLY_WINDOW,
  FOUNDER_UNDERSUPPLY_DAYS,
} from '../../../src/sim/data/constants';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map((s) => Number(s.trim()));
const PRESETS = (process.env.PRESETS ?? 'metropolis,city').split(',').map((s) => s.trim());
const CHECK_EVERY = 20;
const CENTS = 100;
const D = (cents: number) => (cents / CENTS).toFixed(2);

// ---- read-only replicas of the founder-loop helpers -----------------------
function townPopAndSat(state: GameState): { pop: number; avgSat: number } {
  let satMass = 0, pop = 0;
  for (const id in state.citizens) { satMass += state.citizens[id]!.satisfaction; pop += 1; }
  for (const cid in state.cohorts) {
    const co = state.cohorts[cid]!;
    satMass += co.avgSatisfaction * co.population;
    pop += co.population;
  }
  return { pop, avgSat: pop > 0 ? satMass / pop : 0 };
}

function smoothedFillRate(state: GameState, pid: string): number {
  const hist = state.marketStats[pid]?.history ?? [];
  let fulfilled = 0, unmet = 0;
  for (let i = Math.max(0, hist.length - FOUNDER_UNDERSUPPLY_WINDOW); i < hist.length; i++) {
    fulfilled += hist[i]!.unitsSold;
    unmet += hist[i]!.unmetDemand;
  }
  const demand = fulfilled + unmet;
  return demand > 0 ? fulfilled / demand : 1;
}

function affordable(state: GameState, pid: string): boolean {
  return !!CHAIN_BLUEPRINTS[pid] && founderCash(state.config) >= Math.round(chainCost(CHAIN_BLUEPRINTS[pid]!) * 1.2);
}

/** Which gate is the limiter TODAY, evaluated in the founder loop's own order.
 * Returns 'cap' when the town is already full (the good terminal state). */
function bindingReason(state: GameState, day: number): string {
  const cap = founderMaxAiFirms(state.config);
  const aiCount = Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
  if (aiCount >= cap) return 'cap-reached';
  if (day < FOUNDER_EARLIEST_DAY) return 'pre-earliest';
  const { pop, avgSat } = townPopAndSat(state);
  if (pop < FOUNDER_MIN_POPULATION) return 'pop-gate';
  // World-cash gate is Village-only (A5); city-scale never enforces it.
  const cityScale = state.config.sizePreset !== 'village';
  if (!cityScale && state.worldCash < founderCash(state.config)) return 'world-cash-gate';

  // Vacancy path: any staple with a persistent total gap, in a happy town.
  let vacancyGap = false;
  for (const pid of FOUNDER_PRODUCTS) {
    if ((state.marketGapDays[pid] ?? 0) >= FOUNDER_GAP_DAYS && CHAIN_BLUEPRINTS[pid]) vacancyGap = true;
  }
  if (vacancyGap && avgSat >= IMMIGRATION_MIN_SATISFACTION) {
    // A qualifying vacancy exists; the daily hash roll only PACES it, so treat
    // this as founder-ready (affordability always holds for these staples).
    return 'vacancy-ready';
  }

  // Under-supply path (city-scale): a chronic paying shortage in an occupied
  // market, rate-limited town-wide.
  let streakProduct = false;
  for (const pid of FOUNDER_PRODUCTS) {
    if ((state.marketUndersupplyDays[pid] ?? 0) >= FOUNDER_UNDERSUPPLY_DAYS && affordable(state, pid)) {
      streakProduct = true;
    }
  }
  const cooldownActive = day - state.lastUndersupplyEntryDay < founderUndersupplyCooldown(state.config);
  if (streakProduct) return cooldownActive ? 'undersupply-cooldown' : 'undersupply-ready';

  if (vacancyGap) return 'vacancy-sat-gate'; // gap exists but town too unhappy
  return 'no-signal'; // markets served well enough — signal never fires
}

interface FirmBooks { alive: number; distressed: number; insolvent: number; cashes: number[]; }
function firmBooks(state: GameState): FirmBooks {
  const cashes: number[] = [];
  let alive = 0, distressed = 0, insolvent = 0;
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    if (f.ownerType !== 'ai') continue;
    alive += 1;
    cashes.push(f.cash);
    if (f.bankruptcyStatus === 'distressed') distressed += 1;
    if (f.bankruptcyStatus === 'insolvent') insolvent += 1;
  }
  cashes.sort((a, b) => a - b);
  return { alive, distressed, insolvent, cashes };
}
const median = (xs: number[]) => (xs.length === 0 ? 0 : xs[Math.floor(xs.length / 2)]!);

/** Active wholesaler facilities' realized price multiplier (fraction of market
 * average retail the seller charges). The tuned WHOLESALE_DISCOUNT default is
 * 0.70; the AI milk it up/down between 0.5 and 1.0. */
function wholesaleSpread(state: GameState): { n: number; min: number; avg: number; max: number } {
  const mults: number[] = [];
  for (const fid in state.facilities) {
    const fac = state.facilities[fid]!;
    if (fac.wholesalePriceMult === undefined) continue;
    const firm = state.firms[fac.ownerFirmId];
    if (!firm || firm.ownerType !== 'ai') continue;
    mults.push(fac.wholesalePriceMult);
  }
  if (mults.length === 0) return { n: 0, min: 0, avg: 0, max: 0 };
  const sum = mults.reduce((a, b) => a + b, 0);
  return { n: mults.length, min: Math.min(...mults), avg: sum / mults.length, max: Math.max(...mults) };
}

for (const preset of PRESETS) {
  for (const seed of SEEDS) {
    const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: preset as GameState['config']['sizePreset'] });
    const sim = new Simulation(state);
    sim.dispatch({ type: 'RESUME' });
    const tpd = ticksPerDay(state.config);
    const cap = founderMaxAiFirms(state.config);
    const initialMoney = totalMoneySupply(state);
    const startAi = Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;

    console.log(
      `\n=== ${preset} seed ${seed} — cap ${cap}, start AI ${startAi}, ` +
      `cast ${Object.keys(state.citizens).length}, money ${D(initialMoney)} ===`,
    );

    const reasonTally: Record<string, number> = {};
    let winNs = 0n, winTicks = 0;
    let worstConserved = 0;
    const curve: { day: number; ai: number }[] = [];

    for (let day = 1; day <= DAYS; day++) {
      const t0 = process.hrtime.bigint();
      sim.run(tpd);
      const t1 = process.hrtime.bigint();
      winNs += t1 - t0; winTicks += tpd;

      const reason = bindingReason(state, day);
      reasonTally[reason] = (reasonTally[reason] ?? 0) + 1;

      const money = totalMoneySupply(state);
      const delta = Math.abs(money - initialMoney);
      if (delta > worstConserved) worstConserved = delta;

      if (day % CHECK_EVERY === 0) {
        const ai = Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
        curve.push({ day, ai });
        const bk = firmBooks(state);
        const fills = FOUNDER_PRODUCTS.map((p) => `${p} ${smoothedFillRate(state, p).toFixed(2)}`).join(' ');
        const streaks = FOUNDER_PRODUCTS.map((p) => state.marketUndersupplyDays[p] ?? 0).join('/');
        console.log(
          `d${String(day).padStart(3)} AI ${ai}/${cap} dist ${bk.distressed} ins ${bk.insolvent} | ` +
          `fill ${fills} | streak ${streaks} | wc ${D(state.worldCash)} | ` +
          `${(Number(winNs) / 1e6 / winTicks).toFixed(3)}ms/t`,
        );
        winNs = 0n; winTicks = 0;
      }
    }

    const bk = firmBooks(state);
    const sp = wholesaleSpread(state);
    console.log(JSON.stringify({
      preset, seed, cap,
      firmCount: { start: startAi, end: bk.alive, curve: curve.map((c) => c.ai) },
      capReached: bk.alive >= cap,
      abortReasons: reasonTally,
      solvency: {
        alive: bk.alive, distressed: bk.distressed, insolvent: bk.insolvent,
        cashMin: D(bk.cashes[0] ?? 0), cashMedian: D(median(bk.cashes)),
        cashMax: D(bk.cashes[bk.cashes.length - 1] ?? 0),
        negativeCash: bk.cashes.filter((c) => c < 0).length,
      },
      wholesaleSpread: { n: sp.n, min: sp.min.toFixed(2), avg: sp.avg.toFixed(2), max: sp.max.toFixed(2) },
      perf: { engineAvgTickMs: state.perf.avgTickMs.toFixed(3) },
      conservedToCent: worstConserved === 0,
    }, null, 1));
  }
}
