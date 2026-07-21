/**
 * Grand Junction probe — the balance evidence for the first City-scale scenario.
 *
 * Runs the CITY size preset with every era flag on (the worldScaleConfig City
 * stack: crowd + services + real-estate + investors + trade pools) for
 * DAYS × SEEDS, once for the DEFAULT scenario (meadowbrook — the pinned City
 * baseline) and once for `grand_junction`, and reports the same panel for each
 * so the scenario can be read directly against the City norms it must live
 * inside:
 *
 *   - AI firm count at day DAYS (+ insolvent / distressed) — the field must fill
 *     and stay solvent, not collapse;
 *   - the crowd-tier bands as a 45-day trailing mean (worker / comfortable /
 *     affluent share of the cohort crowd) — must sit inside the City band the
 *     tier tests pin (worker .50-.70, comfortable .30-.40);
 *   - cast avg satisfaction (Village runs ~48-58; the crowd city sits near it);
 *   - the landlord / datacenter / holdco fingerprints — when the rentals firm
 *     founds, that the compute provider exists from day 0, whether a holdco
 *     shows up — the "rent, seats, stakes already flow" of the pitch;
 *   - pool per-capita drift (the cohortRent guard's day-40→120 slope);
 *   - conservation to the cent.
 *
 * Read-only beyond running the sim. Robust to the preset catalog (only iterates
 * the products the preset actually seeds), unlike the older city-soak probe.
 *
 * Runnable: `npx tsx docs/design/probes/grand-junction.ts`
 * (DAYS / SEEDS env overrides).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import type { SimulationConfig } from '../../../src/sim/core/SimulationConfig';
import type { CitizenTier } from '../../../src/sim/entities/Citizen';
import { PRODUCT_IDS_BY_PRESET } from '../../../src/sim/data/products';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map((s) => Number(s.trim()));
const TIERS: CitizenTier[] = ['worker', 'comfortable', 'affluent'];
const STAPLES = ['bread', 'tools', 'clothes'];

// Every City channel on — the worldScaleConfig 'city' stack, built here directly
// so the probe stays a pure config (no store).
const CITY_CONFIG: SimulationConfig = {
  ...DEFAULT_CONFIG,
  sizePreset: 'city',
  servicesEnabled: true,
  realEstateEnabled: true,
  investorsEnabled: true,
  tradeDemandPoolsEnabled: true,
};

function aiFirmCount(state: GameState): number {
  return Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
}

function fillRate(state: GameState, pid: string, window = 14): number {
  const hist = state.marketStats[pid]?.history ?? [];
  let sold = 0, unmet = 0;
  for (let i = Math.max(0, hist.length - window); i < hist.length; i++) {
    sold += hist[i]!.unitsSold; unmet += hist[i]!.unmetDemand;
  }
  const d = sold + unmet;
  return d > 0 ? sold / d : 1;
}

function run(label: string, scenarioId: string | undefined, seed: number): void {
  const state = createInitialState(seed, CITY_CONFIG, scenarioId);
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const money0 = totalMoneySupply(state);
  const cityProducts = PRODUCT_IDS_BY_PRESET[state.config.sizePreset];
  let worstConserved = 0;

  const bandWin: Record<CitizenTier, number[]> = { worker: [], comfortable: [], affluent: [] };
  let castSatSum = 0, castSatN = 0, castSatMin = 999, castSatMax = 0;
  const perCapAt: Record<number, number> = {};
  let landlordFoundedDay = -1;
  let holdcoFoundedDay = -1;
  let datacenterAtStart = false;

  // datacenter present at day 0?
  datacenterAtStart = Object.values(state.facilities).some((f) => f.type === 'datacenter');

  for (let day = 1; day <= DAYS; day++) {
    sim.run(tpd);
    worstConserved = Math.max(worstConserved, Math.abs(totalMoneySupply(state) - money0));

    if (landlordFoundedDay < 0 &&
        Object.values(state.firms).some((f) => f.strategy.archetype === 'landlord')) {
      landlordFoundedDay = day;
    }
    if (holdcoFoundedDay < 0 &&
        Object.values(state.firms).some((f) => f.strategy.archetype === 'investor')) {
      holdcoFoundedDay = day;
    }

    if (day % 10 === 0) {
      let pop = 0, pool = 0;
      for (const cid in state.cohorts) { pop += state.cohorts[cid]!.population; pool += state.cohorts[cid]!.cashPool; }
      perCapAt[day] = pop > 0 ? pool / pop : 0;
    }

    if (day > DAYS - 45) {
      const pop: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      for (const cid in state.cohorts) pop[state.cohorts[cid]!.tier] += state.cohorts[cid]!.population;
      const cr = pop.worker + pop.comfortable + pop.affluent;
      for (const t of TIERS) if (cr > 0) bandWin[t].push(pop[t] / cr);
      let sSum = 0, sN = 0;
      for (const id in state.citizens) { sSum += state.citizens[id]!.satisfaction; sN += 1; }
      if (sN > 0) {
        const avg = sSum / sN;
        castSatSum += avg; castSatN += 1;
        castSatMin = Math.min(castSatMin, avg); castSatMax = Math.max(castSatMax, avg);
      }
    }
  }

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const drift40_120 = ((perCapAt[120] ?? 0) - (perCapAt[40] ?? 0)) / 80 / 100;
  let ins = 0, dist = 0;
  for (const fid in state.firms) {
    const f = state.firms[fid]!;
    if (f.ownerType !== 'ai') continue;
    if (f.bankruptcyStatus === 'insolvent') ins++;
    if (f.bankruptcyStatus === 'distressed') dist++;
  }

  console.log(`\n--- ${label}  seed ${seed}  (day ${DAYS}) ---`);
  console.log(`  AI firms   ${aiFirmCount(state)}  (insolvent ${ins} distressed ${dist})`);
  console.log(`  band45     W ${mean(bandWin.worker).toFixed(3)}  C ${mean(bandWin.comfortable).toFixed(3)}  A ${mean(bandWin.affluent).toFixed(3)}   [City test: W .50-.70, C .30-.40]`);
  console.log(`  castSat45  avg ${(castSatN ? castSatSum / castSatN : 0).toFixed(1)}  min ${castSatMin.toFixed(1)}  max ${castSatMax.toFixed(1)}   [Village band ~48-58]`);
  console.log(`  archetypes datacenter@0 ${datacenterAtStart}  landlord@ ${landlordFoundedDay < 0 ? 'never' : 'day ' + landlordFoundedDay}  holdco@ ${holdcoFoundedDay < 0 ? 'never' : 'day ' + holdcoFoundedDay}`);
  console.log(`  drift      40->120 $${drift40_120.toFixed(2)}/cap/day  [cohortRent guard <2.00]  pool/cap d120 $${((perCapAt[120] ?? 0) / 100).toFixed(0)}`);
  console.log(`  fill(14d)  ${STAPLES.filter((p) => cityProducts.includes(p as never)).map((p) => `${p} ${fillRate(state, p).toFixed(2)}`).join('  ')}`);
  console.log(`  cons worst ${worstConserved}c`);
}

for (const seed of SEEDS) {
  run('baseline (meadowbrook+city)', undefined, seed);
  run('grand_junction          ', 'grand_junction', seed);
}
