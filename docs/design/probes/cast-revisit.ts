/**
 * Cast restocked-shelf revisit probe (cast-parity attempt #3). Runs the City
 * preset 300 days × seeds 11/4/7 TWICE per seed — flag OFF (shipped baseline)
 * then flag ON (SIZE_PRESETS.city.restockRevisit = true) — and prints the two
 * side by side so the effect of the revisit is a measured delta against the
 * exact same trajectory up to the first divergence.
 *
 * Per side it reports the committed City guards + the cast-parity metrics:
 *   - AI firm count / insolvency;
 *   - tier band (15-day mean: worker .50-.70, comfortable .30-.40) + 45-day;
 *   - worker cast-vs-cohort gap by BOTH metrics (MoM-45 and daily-|diff|-15, ≤8);
 *   - cast vs cohort WORKER satisfaction (the gap's two sides — the cohort-side
 *     regression watchdog: ON must not drop cohort worker sat > 2 vs OFF);
 *   - cast mean bread urgency (unmet proxy — high urgency = starved shelves);
 *   - staple fill-rate + bread unmet/day (the supply cap);
 *   - money conservation (must stay 0c).
 *
 * Read-only beyond running the sim. `npx tsx docs/design/probes/cast-revisit.ts`
 * (DAYS/SEEDS env overrides as usual).
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

function aiFirmCount(state: GameState): number {
  return Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
}

const FILLPRODS = ['bread', 'tools', 'clothes', 'coffee'];
function fillRate(state: GameState, pid: string, window = 14): string {
  const hist = state.marketStats[pid]?.history ?? [];
  let sold = 0, unmet = 0;
  for (let i = Math.max(0, hist.length - window); i < hist.length; i++) {
    sold += hist[i]!.unitsSold; unmet += hist[i]!.unmetDemand;
  }
  const d = sold + unmet;
  return d > 0 ? (sold / d).toFixed(2) : '1.00';
}
function unmetPerDay(state: GameState, pid: string, window = 14): number {
  const hist = state.marketStats[pid]?.history ?? [];
  let unmet = 0, n = 0;
  for (let i = Math.max(0, hist.length - window); i < hist.length; i++) { unmet += hist[i]!.unmetDemand; n++; }
  return n > 0 ? unmet / n : 0;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

interface Side {
  firms: number; ins: number;
  w15: number; c15: number;
  band45: Record<CitizenTier, number>;
  caSat: Record<CitizenTier, number>;
  coSat: Record<CitizenTier, number>;
  gapMoM: number; gapDaily: number;
  castBreadUrg: number; castUnmetPerCap: number;
  breadUnmet: number; breadFill: string;
  crowd: number; castPop: number; empW: number;
  worstConserved: number;
}

function runSide(seed: number, revisit: boolean): Side {
  (SIZE_PRESETS.city as Record<string, boolean>).restockRevisit = revisit;
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const money0 = totalMoneySupply(state);
  let worstConserved = 0;

  const coSatWin: Record<CitizenTier, number[]> = { worker: [], comfortable: [], affluent: [] };
  const caSatWin: Record<CitizenTier, number[]> = { worker: [], comfortable: [], affluent: [] };
  const bandWin: Record<CitizenTier, number[]> = { worker: [], comfortable: [], affluent: [] };
  const dailyDiffWin: number[] = [];
  const w15: number[] = []; const c15: number[] = []; const empW15: number[] = [];
  const castBreadUrgWin: number[] = []; const castUnmetWin: number[] = [];

  for (let day = 1; day <= DAYS; day++) {
    sim.run(tpd);
    worstConserved = Math.max(worstConserved, Math.abs(totalMoneySupply(state) - money0));

    if (day > DAYS - 45) {
      const pop: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      const satMass: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      for (const cid in state.cohorts) {
        const c = state.cohorts[cid]!;
        pop[c.tier] += c.population; satMass[c.tier] += c.avgSatisfaction * c.population;
      }
      const caPop: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      const caMass: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      for (const id in state.citizens) {
        const c = state.citizens[id]!; caPop[c.tier] += 1; caMass[c.tier] += c.satisfaction;
      }
      const cr = pop.worker + pop.comfortable + pop.affluent;
      for (const t of TIERS) {
        if (pop[t] > 0) coSatWin[t].push(satMass[t] / pop[t]);
        if (caPop[t] > 0) caSatWin[t].push(caMass[t] / caPop[t]);
        if (cr > 0) bandWin[t].push(100 * pop[t] / cr);
      }
    }

    if (day > DAYS - 15) {
      let coMass = 0, coPop = 0, caMass = 0, caN = 0, empMass = 0, empPop = 0;
      for (const cid in state.cohorts) {
        const c = state.cohorts[cid]!;
        if (c.tier !== 'worker') continue;
        coMass += c.avgSatisfaction * c.population; coPop += c.population;
        empMass += c.employed; empPop += c.population;
      }
      let breadUrgMass = 0, breadUrgN = 0, castUnmet = 0, castN = 0;
      for (const id in state.citizens) {
        const c = state.citizens[id]!;
        castUnmet += c.dailyStats.unmetNeeds; castN += 1;
        if (c.tier !== 'worker') continue;
        caMass += c.satisfaction; caN += 1;
        const bread = c.needs.find((n) => n.productId === 'bread');
        if (bread) { breadUrgMass += bread.urgency; breadUrgN += 1; }
      }
      if (coPop > 0 && caN > 0) dailyDiffWin.push(Math.abs(coMass / coPop - caMass / caN));
      if (empPop > 0) empW15.push(empMass / empPop);
      if (breadUrgN > 0) castBreadUrgWin.push(breadUrgMass / breadUrgN);
      if (castN > 0) castUnmetWin.push(castUnmet / castN);
      const pop2: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      for (const cid in state.cohorts) pop2[state.cohorts[cid]!.tier] += state.cohorts[cid]!.population;
      const cr2 = pop2.worker + pop2.comfortable + pop2.affluent;
      if (cr2 > 0) { w15.push(pop2.worker / cr2); c15.push(pop2.comfortable / cr2); }
    }
  }

  let ins = 0, crowd = 0;
  for (const fid in state.firms) { const f = state.firms[fid]!; if (f.ownerType === 'ai' && f.bankruptcyStatus === 'insolvent') ins++; }
  for (const cid in state.cohorts) crowd += state.cohorts[cid]!.population;

  return {
    firms: aiFirmCount(state), ins,
    w15: mean(w15), c15: mean(c15),
    band45: { worker: mean(bandWin.worker), comfortable: mean(bandWin.comfortable), affluent: mean(bandWin.affluent) },
    caSat: { worker: mean(caSatWin.worker), comfortable: mean(caSatWin.comfortable), affluent: mean(caSatWin.affluent) },
    coSat: { worker: mean(coSatWin.worker), comfortable: mean(coSatWin.comfortable), affluent: mean(coSatWin.affluent) },
    gapMoM: Math.abs(mean(coSatWin.worker) - mean(caSatWin.worker)),
    gapDaily: mean(dailyDiffWin),
    castBreadUrg: mean(castBreadUrgWin), castUnmetPerCap: mean(castUnmetWin),
    breadUnmet: unmetPerDay(state, 'bread'), breadFill: fillRate(state, 'bread'),
    crowd, castPop: Object.keys(state.citizens).length, empW: mean(empW15),
    worstConserved,
  };
}

function printSide(label: string, s: Side): void {
  console.log(`  [${label}] firms ${s.firms} (ins ${s.ins})  crowd ${s.crowd} cast ${s.castPop} empW ${s.empW.toFixed(2)}`);
  console.log(`        band15 W ${s.w15.toFixed(3)} C ${s.c15.toFixed(3)}   band45 W ${s.band45.worker.toFixed(1)} C ${s.band45.comfortable.toFixed(1)} A ${s.band45.affluent.toFixed(1)}`);
  console.log(`        worker sat: cast ${s.caSat.worker.toFixed(1)}  cohort ${s.coSat.worker.toFixed(1)}   gap MoM45 ${s.gapMoM.toFixed(1)} daily15 ${s.gapDaily.toFixed(2)} [<=8]`);
  console.log(`        comf sat:   cast ${s.caSat.comfortable.toFixed(1)}  cohort ${s.coSat.comfortable.toFixed(1)}   cast bread urg ${s.castBreadUrg.toFixed(2)}  cast unmet/cap ${s.castUnmetPerCap.toFixed(2)}`);
  console.log(`        bread: unmet/day ${s.breadUnmet.toFixed(0)} fill ${s.breadFill}   cons ${s.worstConserved}c`);
}

for (const seed of SEEDS) {
  console.log(`\n=== seed ${seed} (day ${DAYS}) ===`);
  const off = runSide(seed, false);
  const on = runSide(seed, true);
  printSide('OFF', off);
  printSide('ON ', on);
  const gapNarrow = off.gapMoM - on.gapMoM;
  const cohortReg = off.coSat.worker - on.coSat.worker; // >0 = ON regressed cohort
  const bandOk = on.w15 >= 0.50 && on.w15 <= 0.70 && on.c15 >= 0.30 && on.c15 <= 0.40 && on.gapDaily <= 8;
  console.log(`  DELTA  worker-gap(MoM) ${off.gapMoM.toFixed(1)} -> ${on.gapMoM.toFixed(1)} (narrow ${gapNarrow.toFixed(1)})  ` +
    `cast worker sat ${off.caSat.worker.toFixed(1)} -> ${on.caSat.worker.toFixed(1)}  ` +
    `cohort worker sat ${off.coSat.worker.toFixed(1)} -> ${on.coSat.worker.toFixed(1)} (reg ${cohortReg.toFixed(1)})`);
  console.log(`  SHIPBAR band-ok ${bandOk}  cohort-reg<=2 ${cohortReg <= 2}  gap-single-digit ${on.gapMoM < 10}`);
}
// restore
(SIZE_PRESETS.city as Record<string, boolean>).restockRevisit = false;
