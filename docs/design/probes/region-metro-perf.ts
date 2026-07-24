/**
 * region-metro-perf — the probe-before-ship for enabling `regionEnabled` on a
 * Metropolis new game (region.md step 4 deferral).
 *
 * MEASURES the house statistic — MEDIAN ms/tick, warmed then timed per-tick —
 * for the two-town (region-on) vs single-town (region-off) path at both City
 * and Metropolis, seeds 11/4, plus a per-system profile of what the partner's
 * makeContext + light schedule cost. The question the deferral note raised:
 * PORT_ROSA_SPEC is FIXED (city-sized, crowd 300, 6 firms) regardless of host,
 * so the partner's own tick cost is host-independent — the two-town delta should
 * match City's measured +~0.05ms at Metropolis too. It does NOT, and this probe
 * localizes why.
 *
 * Timing: process.hrtime.bigint runs OUTSIDE the sim (Date/Date.now banned
 * inside); warm to day WARM, then time TIMED individual ticks, median reported.
 *
 * Runnable: `npx tsx docs/design/probes/region-metro-perf.ts`
 *   WARM (default 300)  — warm-up day before timing begins
 *   TIMED (default 960) — timed ticks (individually clocked) for the median
 *   SEEDS (default 11,4)
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG, type SimulationConfig } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { buildContractIndex } from '../../../src/sim/core/ContractIndex';
import { PARTNER_TOWN_ID } from '../../../src/sim/data/seedTown';

const WARM = Number(process.env.WARM ?? 300);
const TIMED = Number(process.env.TIMED ?? 960);
const SEEDS = (process.env.SEEDS ?? '11,4').split(',').map((s) => Number(s.trim()));

// City turns the whole stack on (mirrors worldScaleConfig('city')).
const cityFlags = (regionOn: boolean): Partial<SimulationConfig> => ({
  sizePreset: 'city',
  servicesEnabled: true,
  realEstateEnabled: true,
  investorsEnabled: true,
  tradeDemandPoolsEnabled: true,
  regionEnabled: regionOn,
});
// Metropolis mirrors worldScaleConfig('metropolis') (investors omitted — that
// founder row is city-gated), region flag swept.
const metroFlags = (regionOn: boolean): Partial<SimulationConfig> => ({
  sizePreset: 'metropolis',
  servicesEnabled: true,
  realEstateEnabled: true,
  tradeDemandPoolsEnabled: true,
  regionEnabled: regionOn,
});

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]!;
};
const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

interface Row {
  label: string;
  seed: number;
  medianMs: number;
  p90Ms: number;
  meanMs: number;
  contracts: number;
  townCount: number;
}

function measure(label: string, seed: number, flags: Partial<SimulationConfig>): Row {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, ...flags });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  // Warm.
  sim.run(tpd * WARM);
  // Timed — clock each tick individually.
  const samples: number[] = [];
  for (let i = 0; i < TIMED; i++) {
    const t0 = process.hrtime.bigint();
    sim.tick();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const contracts = Object.keys(state.contracts).length;
  const townCount = Object.keys(state.towns).length;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  return {
    label, seed,
    medianMs: median(samples), p90Ms: pct(samples, 90), meanMs: mean,
    contracts, townCount,
  };
}

// --- micro-benchmark: cost of ONE buildContractIndex on a warmed host --------
// This is the per-tick cost the partner's makeContext pays REDUNDANTLY (the
// partner runs no system that reads contractIndex — LogisticsSystem and the AI
// operator/finance systems, its only consumers, are all home-only).
function contractIndexCost(seed: number, flags: Partial<SimulationConfig>): { contracts: number; medianUs: number } {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, ...flags });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  sim.run(ticksPerDay(state.config) * WARM);
  const N = 2000;
  const us: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    buildContractIndex(state);
    us.push(Number(process.hrtime.bigint() - t0) / 1e3);
  }
  return { contracts: Object.keys(state.contracts).length, medianUs: median(us) };
}

const f4 = (n: number) => n.toFixed(4);

console.log(`=== region-metro-perf  (WARM=${WARM}d, TIMED=${TIMED} ticks, median ms/tick) ===\n`);
const rows: Row[] = [];
for (const seed of SEEDS) {
  rows.push(measure('City   region-OFF (1 town)', seed, cityFlags(false)));
  rows.push(measure('City   region-ON  (2 town)', seed, cityFlags(true)));
  rows.push(measure('Metro  region-OFF (1 town)', seed, metroFlags(false)));
  rows.push(measure('Metro  region-ON  (2 town)', seed, metroFlags(true)));
}

console.log('label'.padEnd(28), 'seed', 'towns', 'contracts', 'median_ms', 'p90_ms', 'mean_ms');
for (const r of rows) {
  console.log(
    r.label.padEnd(28), String(r.seed).padStart(4), String(r.townCount).padStart(5),
    String(r.contracts).padStart(9), f4(r.medianMs).padStart(9), f4(r.p90Ms).padStart(6), f4(r.meanMs).padStart(7),
  );
}

console.log('\n=== two-town DELTA (region-on median − region-off median) ===');
for (const seed of SEEDS) {
  const cityOff = rows.find((r) => r.seed === seed && r.label.startsWith('City   region-OFF'))!;
  const cityOn = rows.find((r) => r.seed === seed && r.label.startsWith('City   region-ON'))!;
  const metroOff = rows.find((r) => r.seed === seed && r.label.startsWith('Metro  region-OFF'))!;
  const metroOn = rows.find((r) => r.seed === seed && r.label.startsWith('Metro  region-ON'))!;
  console.log(`  seed ${seed}:  City +${f4(cityOn.medianMs - cityOff.medianMs)}ms   Metro +${f4(metroOn.medianMs - metroOff.medianMs)}ms`);
}

console.log('\n=== redundant buildContractIndex cost the partner makeContext pays each tick ===');
for (const seed of SEEDS) {
  const c = contractIndexCost(seed, cityFlags(true));
  const m = contractIndexCost(seed, metroFlags(true));
  console.log(`  seed ${seed}:  City ${c.contracts} contracts -> ${f4(c.medianUs)}us   Metro ${m.contracts} contracts -> ${f4(m.medianUs)}us`);
}

// Sanity: the partner has no contracts of its own (contracts are world-scoped).
const probe = createInitialState(11, { ...DEFAULT_CONFIG, ...metroFlags(true) });
console.log(`\n(partner town present: ${probe.towns[PARTNER_TOWN_ID] !== undefined}; world contracts belong to home: partner runs no contractIndex consumer)`);
