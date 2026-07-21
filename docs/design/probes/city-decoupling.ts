/**
 * City-decoupling probe (the City cast-parity mechanism pass). Extends the
 * city-headroom probe with the full sweep axes of the forward-path mechanism, so
 * one probe process measures any grid cell against ALL the committed guards
 * together, per seed:
 *
 *   - AI firm count + insolvency (the headroom target: 11-14 firms);
 *   - the tier bands as a 15-day mean (tierAcceptance: worker .50-.70,
 *     comfortable .30-.40) AND a 45-day mean (context);
 *   - the worker cast-vs-cohort satisfaction gap by BOTH metrics (tier-joint
 *     45-day mean-of-means AND tierAcceptance daily-|diff| 15-day, ≤ 8);
 *   - crowd worker employment share (the wage leg carries comfortable only at
 *     empShare ≥ ~0.5);
 *   - pool per-capita drift the cohortRent guard pins (days-40→120 slope <
 *     $2.00/cap/day, day-120 level < $500/cap, plateau d80→d120 < 10%);
 *   - staple fill-rates + conservation.
 *
 * Read-only beyond running the sim, EXCEPT it overwrites SIZE_PRESETS.city fields
 * from env (local to the probe process) so a single probe sweeps a grid cell
 * without touching source:
 *
 *   FILLRATE   founderUndersupplyFillRate (trigger)          default 0.65
 *   WAGE       founderCrowdWage in DOLLARS                    default 16
 *   WCB        catchupBaskets                                 default 2
 *   SYNTH      catchupSyntheticSignal (1/0)                   default 0
 *   SINKFLOOR  prosperityDrainFloor in DOLLARS/capita         default 0
 *   SINKRATE   prosperityDrainRate                            default 0
 *   FCASH      founderCash in DOLLARS                         default 22000
 *   COOLDOWN   founderUndersupplyCooldown                     default 20
 *   DAYS/SEEDS as usual                                       default 300 / 11,4,7
 *
 * Runnable: `WAGE=18 FILLRATE=0.68 SYNTH=1 WCB=4 SINKFLOOR=450 SINKRATE=0.08 \
 *   npx tsx docs/design/probes/city-decoupling.ts`
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

// In-process overrides of the pinned City knobs — the whole point of the probe.
const city = SIZE_PRESETS.city as Record<string, number | boolean>;
if (process.env.FILLRATE) city.founderUndersupplyFillRate = Number(process.env.FILLRATE);
if (process.env.COOLDOWN) city.founderUndersupplyCooldown = Number(process.env.COOLDOWN);
if (process.env.WAGE) city.founderCrowdWage = Math.round(Number(process.env.WAGE) * 100);
if (process.env.WCB) city.catchupBaskets = Number(process.env.WCB);
if (process.env.SYNTH) city.catchupSyntheticSignal = process.env.SYNTH === '1';
if (process.env.SINKFLOOR) city.prosperityDrainFloor = Math.round(Number(process.env.SINKFLOOR) * 100);
if (process.env.SINKRATE) city.prosperityDrainRate = Number(process.env.SINKRATE);
if (process.env.FCASH) city.founderCash = Math.round(Number(process.env.FCASH) * 100);
if (process.env.IMMIGFLOOR) city.immigrationEmpFloor = Number(process.env.IMMIGFLOOR);

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

console.log(
  `CONFIG fill=${city.founderUndersupplyFillRate} wage=$${(Number(city.founderCrowdWage) / 100).toFixed(0)} ` +
  `wcb=${city.catchupBaskets} synth=${city.catchupSyntheticSignal ? 1 : 0} ` +
  `sinkFloor=$${(Number(city.prosperityDrainFloor) / 100).toFixed(0)} sinkRate=${city.prosperityDrainRate} ` +
  `fcash=$${(Number(city.founderCash) / 100).toFixed(0)} cooldown=${city.founderUndersupplyCooldown} ` +
  `immigFloor=${city.immigrationEmpFloor}`,
);

// A single per-seed PASS/FAIL against the committed guards, printed as one line.
const results: { seed: number; firms: number; w: number; c: number; gapD: number; drift: number; pass: boolean; reason: string }[] = [];

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
  const dailyDiffWin: number[] = [];
  const w15: number[] = []; const c15: number[] = [];
  const empW15: number[] = [];
  const perCapAt: Record<number, number> = {};

  for (let day = 1; day <= DAYS; day++) {
    sim.run(tpd);
    worstConserved = Math.max(worstConserved, Math.abs(totalMoneySupply(state) - money0));

    if (day % 10 === 0) {
      let pop = 0, pool = 0;
      for (const cid in state.cohorts) { pop += state.cohorts[cid]!.population; pool += state.cohorts[cid]!.cashPool; }
      perCapAt[day] = pop > 0 ? pool / pop : 0;
    }

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

    if (day > DAYS - 15) {
      let coMass = 0, coPop = 0, caMass = 0, caN = 0, empMass = 0, empPop = 0;
      for (const cid in state.cohorts) {
        const c = state.cohorts[cid]!;
        if (c.tier !== 'worker') continue;
        coMass += c.avgSatisfaction * c.population; coPop += c.population;
        empMass += c.employed; empPop += c.population;
      }
      for (const id in state.citizens) {
        const c = state.citizens[id]!;
        if (c.tier !== 'worker') continue;
        caMass += c.satisfaction; caN += 1;
      }
      if (coPop > 0 && caN > 0) dailyDiffWin.push(Math.abs(coMass / coPop - caMass / caN));
      if (empPop > 0) empW15.push(empMass / empPop);
      const pop2: Record<CitizenTier, number> = { worker: 0, comfortable: 0, affluent: 0 };
      for (const cid in state.cohorts) pop2[state.cohorts[cid]!.tier] += state.cohorts[cid]!.population;
      const cr2 = pop2.worker + pop2.comfortable + pop2.affluent;
      if (cr2 > 0) { w15.push(pop2.worker / cr2); c15.push(pop2.comfortable / cr2); }
    }
  }

  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const gapMoM = (t: CitizenTier) => Math.abs(mean(coSatWin[t]) - mean(caSatWin[t]));
  const drift40_120 = ((perCapAt[120] ?? 0) - (perCapAt[40] ?? 0)) / 80 / 100;
  const wMean = mean(w15), cMean = mean(c15), gapDaily = mean(dailyDiffWin);
  const plateau = (perCapAt[120] ?? 0) - (perCapAt[80] ?? 0);
  const plateauBar = (perCapAt[80] ?? 0) * 0.1;
  const lvl120 = (perCapAt[120] ?? 0) < 50000;

  // The committed-guard checks (tierAcceptance 300-day seed-11 metric applied to
  // every seed, plus the city-headroom pool guards). Seed 11 is the pinned test.
  const reasons: string[] = [];
  if (!(wMean >= 0.50 && wMean <= 0.70)) reasons.push(`W${wMean.toFixed(2)}`);
  if (!(cMean >= 0.30 && cMean <= 0.40)) reasons.push(`C${cMean.toFixed(2)}`);
  if (!(gapDaily <= 8)) reasons.push(`gap${gapDaily.toFixed(1)}`);
  // Committed pool guard (city-headroom): the days-40→120 slope < $2.00/cap/day
  // AND the day-120 level < $500/cap. The plateau(d80→d120) is CONTEXT only —
  // the shipped-baseline pool is bounded-but-oscillating and "fails" a flat-
  // plateau test while passing the slope guard, so it is printed, not pinned.
  if (!(drift40_120 < 2.0)) reasons.push(`drift${drift40_120.toFixed(2)}`);
  if (!lvl120) reasons.push(`lvl${((perCapAt[120] ?? 0) / 100).toFixed(0)}`);
  const pass = reasons.length === 0;

  let ins = 0, dist = 0;
  for (const fid in state.firms) { const f = state.firms[fid]!; if (f.ownerType !== 'ai') continue; if (f.bankruptcyStatus === 'insolvent') ins++; if (f.bankruptcyStatus === 'distressed') dist++; }

  console.log(`\n=== seed ${seed} (day ${DAYS}) ===`);
  console.log(`  AI firms   ${aiFirmCount(state)}  (insolvent ${ins} distressed ${dist})`);
  console.log(`  band15     W ${wMean.toFixed(3)}  C ${cMean.toFixed(3)}   [test W .50-.70 C .30-.40]`);
  console.log(`  band45     W ${mean(bandWin.worker).toFixed(1)}  C ${mean(bandWin.comfortable).toFixed(1)}  A ${mean(bandWin.affluent).toFixed(1)}`);
  let crowdPop = 0, coWpop = 0;
  for (const cid in state.cohorts) { crowdPop += state.cohorts[cid]!.population; if (state.cohorts[cid]!.tier === 'worker') coWpop += state.cohorts[cid]!.population; }
  console.log(`  coSat45    W ${mean(coSatWin.worker).toFixed(1)}  caSat45 W ${mean(caSatWin.worker).toFixed(1)}   empW15 ${mean(empW15).toFixed(2)}  crowd ${crowdPop} (W ${coWpop})`);
  console.log(`  gap        MoM45 ${gapMoM('worker').toFixed(1)}   daily15 ${gapDaily.toFixed(2)}   [test <=8]`);
  console.log(`  pool/cap   d80 $${((perCapAt[80]??0)/100).toFixed(0)} d120 $${((perCapAt[120]??0)/100).toFixed(0)} d200 $${((perCapAt[200]??0)/100).toFixed(0)} d290 $${((perCapAt[290]??0)/100).toFixed(0)}`);
  console.log(`  drift      40->120 $${drift40_120.toFixed(2)}/cd [test<2.00]  d120<$500 ${lvl120}  plateau ${plateau.toFixed(0)}<${plateauBar.toFixed(0)} ${plateau < plateauBar}`);
  console.log(`  fill(14d)  ${FILLPRODS.map((p) => `${p} ${fillRate(state, p)}`).join('  ')}`);
  console.log(`  cons worst ${worstConserved}c`);
  console.log(`  VERDICT    ${pass ? 'PASS' : 'FAIL ' + reasons.join(',')}`);

  results.push({ seed, firms: aiFirmCount(state), w: wMean, c: cMean, gapD: gapDaily, drift: drift40_120, pass, reason: reasons.join(',') });
}

console.log(`\n=== SUMMARY ===`);
for (const r of results) {
  console.log(`  seed ${r.seed}: ${r.firms}f  W${r.w.toFixed(2)} C${r.c.toFixed(2)} gap${r.gapD.toFixed(1)} drift$${r.drift.toFixed(2)}  ${r.pass ? 'PASS' : 'FAIL ' + r.reason}`);
}
console.log(`  ALL SEEDS PASS: ${results.every((r) => r.pass)}`);
