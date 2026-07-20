/**
 * Joint tier-gate calibration probe (docs/design/cohorts-and-districts.md,
 * "Combined re-measure — the two fixes interact"). Runs the CITY preset for
 * DAYS × SEEDS with BOTH shipped mechanisms live — RetailDemandSystem's worker
 * catch-up and CohortSocialSystem's float-savings tier gates — and reports, per
 * seed: the tier bands (day-DAYS snapshot AND a 45-day trailing mean, since the
 * curator↔demotion gates oscillate ~±6 points day to day), per-capita pools and
 * employment share per tier, the cast-vs-cohort satisfaction gap per tier
 * (worker gap is the ≤ 8 acceptance), cast population, and conservation.
 * Read-only — nothing is mutated beyond running the sim.
 *
 * Runnable: `npx tsx docs/design/probes/tier-joint.ts` (DAYS/SEEDS env override).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import type { CitizenTier } from '../../../src/sim/entities/Citizen';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map((s) => Number(s.trim()));
const TIERS: CitizenTier[] = ['worker', 'comfortable', 'affluent'];

function cohortByTier(state: GameState) {
  const pop: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
  const pool: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
  const satMass: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
  const emp: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
  for (const cid in state.cohorts) {
    const c = state.cohorts[cid]!;
    pop[c.tier] += c.population;
    pool[c.tier] += c.cashPool;
    satMass[c.tier] += c.avgSatisfaction * c.population;
    emp[c.tier] += c.employed;
  }
  return { pop, pool, satMass, emp };
}

function castByTier(state: GameState) {
  const pop: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
  const satMass: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
  for (const id in state.citizens) {
    const c = state.citizens[id]!;
    pop[c.tier] += 1;
    satMass[c.tier] += c.satisfaction;
  }
  return { pop, satMass };
}

for (const seed of SEEDS) {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const money0 = totalMoneySupply(state);
  let worstConserved = 0;

  // 45-day trailing means: accumulate cohort and cast mean sat per tier, then
  // gap = |mean(cohortSat) - mean(castSat)| over the window (less noisy than
  // mean(|daily diff|); 45 days averages over the gates' oscillation).
  const coSatWin: Record<CitizenTier, number[]> = { worker: [], comfortable: [], affluent: [] };
  const caSatWin: Record<CitizenTier, number[]> = { worker: [], comfortable: [], affluent: [] };
  const bandWin: Record<CitizenTier, number[]> = { worker: [], comfortable: [], affluent: [] };

  for (let day = 1; day <= DAYS; day++) {
    sim.run(tpd);
    worstConserved = Math.max(worstConserved, Math.abs(totalMoneySupply(state) - money0));
    if (day > DAYS - 45) {
      const co = cohortByTier(state);
      const ca = castByTier(state);
      const cr = co.pop.worker + co.pop.comfortable + co.pop.affluent;
      for (const t of TIERS) {
        if (co.pop[t] > 0) coSatWin[t].push(co.satMass[t] / co.pop[t]);
        if (ca.pop[t] > 0) caSatWin[t].push(ca.satMass[t] / ca.pop[t]);
        if (cr > 0) bandWin[t].push(100 * co.pop[t] / cr);
      }
    }
  }

  const co = cohortByTier(state);
  const ca = castByTier(state);
  const crowd = co.pop.worker + co.pop.comfortable + co.pop.affluent;
  const pct = (t: CitizenTier) => crowd > 0 ? (100 * co.pop[t] / crowd) : 0;
  const perCap = (t: CitizenTier) => co.pop[t] > 0 ? co.pool[t] / co.pop[t] / 100 : 0;
  const empShare = (t: CitizenTier) => co.pop[t] > 0 ? co.emp[t] / co.pop[t] : 0;
  const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const gap = (t: CitizenTier) => Math.abs(mean(coSatWin[t]) - mean(caSatWin[t]));
  const castTotal = ca.pop.worker + ca.pop.comfortable + ca.pop.affluent;

  console.log(`\n=== seed ${seed} (day ${DAYS}) ===`);
  console.log(
    `  bands    W ${pct('worker').toFixed(0)}%  C ${pct('comfortable').toFixed(0)}%  A ${pct('affluent').toFixed(0)}%  (crowd ${crowd})`,
  );
  console.log(
    `  band45   W ${mean(bandWin.worker).toFixed(1)}  C ${mean(bandWin.comfortable).toFixed(1)}  A ${mean(bandWin.affluent).toFixed(1)}`,
  );
  console.log(
    `  pool/cap  W $${perCap('worker').toFixed(0)}  C $${perCap('comfortable').toFixed(0)}  A $${perCap('affluent').toFixed(0)}`,
  );
  console.log(
    `  empShare  W ${empShare('worker').toFixed(2)}  C ${empShare('comfortable').toFixed(2)}  A ${empShare('affluent').toFixed(2)}`,
  );
  console.log(
    `  coSat45 W ${mean(coSatWin.worker).toFixed(1)}  C ${mean(coSatWin.comfortable).toFixed(1)}  A ${mean(coSatWin.affluent).toFixed(1)}`,
  );
  console.log(
    `  caSat45 W ${mean(caSatWin.worker).toFixed(1)}  C ${mean(caSatWin.comfortable).toFixed(1)}  A ${mean(caSatWin.affluent).toFixed(1)}`,
  );
  console.log(
    `  gap45    W ${gap('worker').toFixed(1)}  C ${gap('comfortable').toFixed(1)}  A ${gap('affluent').toFixed(1)}`,
  );
  console.log(
    `  cast pop ${castTotal} (W ${ca.pop.worker} C ${ca.pop.comfortable} A ${ca.pop.affluent})  cons worst ${worstConserved}c`,
  );
}
