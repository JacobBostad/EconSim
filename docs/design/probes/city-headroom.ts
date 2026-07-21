/**
 * City-headroom probe (A3 crowd-tier headroom pass). Runs the CITY preset for
 * DAYS × SEEDS at a configurable founderUndersupplyFillRate (env FILLRATE) and
 * reports, per seed, everything the two tripped guards care about together:
 *
 *   - AI firm count at day DAYS (goal: 11-14 at the raised trigger);
 *   - the tier bands as a 45-day trailing mean (worker 50-70 / comfortable
 *     25-40 acceptance);
 *   - the worker cast-vs-cohort satisfaction gap by BOTH metrics — the
 *     tier-joint 45-day mean-of-means AND the tierAcceptance daily-|diff|
 *     15-day mean (the churn-oscillation metric, ≤ 8 acceptance);
 *   - pool per-capita drift the cohortRent guard pins: the days-40→120 slope
 *     (< $2.00/cap/day) and the day-120 level (< $500/cap), plus the full-run
 *     day-40→DAYS slope for context;
 *   - conservation.
 *
 * Read-only beyond running the sim, EXCEPT it overwrites SIZE_PRESETS.city
 * .founderUndersupplyFillRate from env so a single probe sweeps the trigger
 * without touching source. That mutation is local to the probe process.
 *
 * Runnable: `FILLRATE=0.70 npx tsx docs/design/probes/city-headroom.ts`
 * (DAYS/SEEDS/FILLRATE env overrides).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG, SIZE_PRESETS } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import type { CitizenTier } from '../../../src/sim/entities/Citizen';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map((s) => Number(s.trim()));
const TIERS: CitizenTier[] = ['worker', 'comfortable', 'affluent'];

if (process.env.FILLRATE) {
  // Local, in-process override of the pinned City trigger — the whole point of
  // the probe. Cast off the `as const` readonly.
  (SIZE_PRESETS.city as { founderUndersupplyFillRate: number }).founderUndersupplyFillRate =
    Number(process.env.FILLRATE);
}
if (process.env.COOLDOWN) {
  (SIZE_PRESETS.city as { founderUndersupplyCooldown: number }).founderUndersupplyCooldown =
    Number(process.env.COOLDOWN);
}

function aiFirmCount(state: GameState): number {
  return Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
}

const FILLPRODS = ['bread', 'tools', 'clothes', 'coffee', 'pastries'];
function fillRate(state: GameState, pid: string, window = 14): string {
  const hist = state.marketStats[pid]?.history ?? [];
  let sold = 0, unmet = 0;
  for (let i = Math.max(0, hist.length - window); i < hist.length; i++) {
    sold += hist[i]!.unitsSold; unmet += hist[i]!.unmetDemand;
  }
  const d = sold + unmet;
  return d > 0 ? (sold / d).toFixed(2) : '1.00';
}

for (const seed of SEEDS) {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const money0 = totalMoneySupply(state);
  let worstConserved = 0;

  const coSatWin: Record<CitizenTier, number[]> = { worker: [], comfortable: [], affluent: [] };
  const caSatWin: Record<CitizenTier, number[]> = { worker: [], comfortable: [], affluent: [] };
  const bandWin: Record<CitizenTier, number[]> = { worker: [], comfortable: [], affluent: [] };
  const dailyDiffWin: number[] = []; // last-15-day daily-|diff| worker gap (tierAcceptance metric)
  const w15: number[] = []; const c15: number[] = []; // last-15-day worker/comfortable share (test metric)
  const perCapAt: Record<number, number> = {};

  for (let day = 1; day <= DAYS; day++) {
    sim.run(tpd);
    worstConserved = Math.max(worstConserved, Math.abs(totalMoneySupply(state) - money0));

    // pool per-capita snapshots for the drift guard
    if (day % 10 === 0) {
      let pop = 0, pool = 0;
      for (const cid in state.cohorts) { pop += state.cohorts[cid]!.population; pool += state.cohorts[cid]!.cashPool; }
      perCapAt[day] = pop > 0 ? pool / pop : 0;
    }

    // 45-day band / mean-of-means window
    if (day > DAYS - 45) {
      const pop: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      const satMass: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      for (const cid in state.cohorts) {
        const c = state.cohorts[cid]!;
        pop[c.tier] += c.population;
        satMass[c.tier] += c.avgSatisfaction * c.population;
      }
      const caPop: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      const caMass: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      for (const id in state.citizens) {
        const c = state.citizens[id]!;
        caPop[c.tier] += 1;
        caMass[c.tier] += c.satisfaction;
      }
      const cr = pop.worker + pop.comfortable + pop.affluent;
      for (const t of TIERS) {
        if (pop[t] > 0) coSatWin[t].push(satMass[t] / pop[t]);
        if (caPop[t] > 0) caSatWin[t].push(caMass[t] / caPop[t]);
        if (cr > 0) bandWin[t].push(100 * pop[t] / cr);
      }
    }

    // last-15-day daily-|diff| worker gap — the tierAcceptance metric
    if (day > DAYS - 15) {
      let coMass = 0, coPop = 0, caMass = 0, caN = 0;
      for (const cid in state.cohorts) {
        const c = state.cohorts[cid]!;
        if (c.tier !== 'worker') continue;
        coMass += c.avgSatisfaction * c.population; coPop += c.population;
      }
      for (const id in state.citizens) {
        const c = state.citizens[id]!;
        if (c.tier !== 'worker') continue;
        caMass += c.satisfaction; caN += 1;
      }
      if (coPop > 0 && caN > 0) dailyDiffWin.push(Math.abs(coMass / coPop - caMass / caN));
      const pop2: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      for (const cid in state.cohorts) pop2[state.cohorts[cid]!.tier] += state.cohorts[cid]!.population;
      const cr2 = pop2.worker + pop2.comfortable + pop2.affluent;
      if (cr2 > 0) { w15.push(pop2.worker / cr2); c15.push(pop2.comfortable / cr2); }
    }
  }

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const gapMoM = (t: CitizenTier) => Math.abs(mean(coSatWin[t]) - mean(caSatWin[t]));
  const drift40_120 = ((perCapAt[120] ?? 0) - (perCapAt[40] ?? 0)) / 80 / 100;
  const driftFull = ((perCapAt[DAYS - (DAYS % 10)] ?? perCapAt[300] ?? 0) - (perCapAt[40] ?? 0)) / (( (DAYS - (DAYS%10)) - 40) || 1) / 100;

  console.log(`\n=== seed ${seed}  fill=${SIZE_PRESETS.city.founderUndersupplyFillRate}  (day ${DAYS}) ===`);
  let ins = 0, dist = 0;
  for (const fid in state.firms) { const f = state.firms[fid]!; if (f.ownerType !== 'ai') continue; if (f.bankruptcyStatus === 'insolvent') ins++; if (f.bankruptcyStatus === 'distressed') dist++; }
  console.log(`  AI firms   ${aiFirmCount(state)}  (insolvent ${ins} distressed ${dist})`);
  console.log(`  band45     W ${mean(bandWin.worker).toFixed(1)}  C ${mean(bandWin.comfortable).toFixed(1)}  A ${mean(bandWin.affluent).toFixed(1)}`);
  console.log(`  coSat45    W ${mean(coSatWin.worker).toFixed(1)}  C ${mean(coSatWin.comfortable).toFixed(1)}    caSat45 W ${mean(caSatWin.worker).toFixed(1)}  C ${mean(caSatWin.comfortable).toFixed(1)}`);
  console.log(`  band15     W ${mean(w15).toFixed(3)}  C ${mean(c15).toFixed(3)}   [test: W .50-.70, C .30-.40]`);
  console.log(`  gap(MoM45) W ${gapMoM('worker').toFixed(1)}   gap(daily15) W ${mean(dailyDiffWin).toFixed(2)}   [test: <=8]`);
  const plateau = (perCapAt[120] ?? 0) - (perCapAt[80] ?? 0); const plateauBar = (perCapAt[80] ?? 0) * 0.1;
  console.log(`  pool/cap   d80 $${((perCapAt[80]??0)/100).toFixed(0)} d120 $${((perCapAt[120] ?? 0) / 100).toFixed(0)} d200 $${((perCapAt[200]??0)/100).toFixed(0)} d290 $${((perCapAt[290]??0)/100).toFixed(0)}`);
  console.log(`  drift      40->120 $${drift40_120.toFixed(2)}/cd [test<2.00]  40->end $${driftFull.toFixed(2)}/cd  d120<$500 ${((perCapAt[120]??0)<50000)}  plateau ${(plateau).toFixed(0)}<${plateauBar.toFixed(0)} ${plateau<plateauBar}`);
  const caPopF: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
  for (const id in state.citizens) caPopF[state.citizens[id]!.tier] += 1;
  const coPopF: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
  let coEmpW = 0, coPopW = 0;
  for (const cid in state.cohorts) { const c = state.cohorts[cid]!; coPopF[c.tier] += c.population; if (c.tier === 'worker') { coEmpW += c.employed; coPopW += c.population; } }
  console.log(`  castTiers  W ${caPopF.worker} C ${caPopF.comfortable} A ${caPopF.affluent}   cohortTiers W ${coPopF.worker} C ${coPopF.comfortable} A ${coPopF.affluent}  coWorkerEmp ${(coPopW>0?coEmpW/coPopW:0).toFixed(2)}`);
  console.log(`  fill(14d)  ${FILLPRODS.map((p) => `${p} ${fillRate(state, p)}`).join('  ')}`);
  console.log(`  cons worst ${worstConserved}c`);
}
