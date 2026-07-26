/**
 * region-metro-verify — correctness gate for enabling regionEnabled at
 * Metropolis. Asserts, for City and Metropolis region-ON at seeds 11/4:
 *   (1) the sim runs to day 300 without throwing (the pre-fix MarketStats
 *       host-preset crash is gone);
 *   (2) money is conserved to the cent region-wide;
 *   (3) determinism: two independent runs produce byte-identical serialized
 *       state (the empty-partner-index change draws no rng and is unread).
 * Runnable: `npx tsx docs/design/probes/region-metro-verify.ts`  (DAYS default 300)
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG, type SimulationConfig } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import { serialize } from '../../../src/sim/persistence/saveLoad';

const DAYS = Number(process.env.DAYS ?? 300);
const cityFlags: Partial<SimulationConfig> = {
  sizePreset: 'city', servicesEnabled: true, realEstateEnabled: true,
  investorsEnabled: true, tradeDemandPoolsEnabled: true, regionEnabled: true,
};
const metroFlags: Partial<SimulationConfig> = {
  sizePreset: 'metropolis', servicesEnabled: true, realEstateEnabled: true,
  tradeDemandPoolsEnabled: true, regionEnabled: true,
};

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

function run(flags: Partial<SimulationConfig>, seed: number): { money0: number; money1: number; bytes: string } {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, ...flags });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const money0 = totalMoneySupply(state);
  sim.run(ticksPerDay(state.config) * DAYS);
  // Normalize the wall-clock perf metrics (avgTickMs/lastTickMs are timing, not
  // sim state) so the byte comparison reflects only deterministic domain state.
  state.perf.lastTickMs = 0;
  state.perf.avgTickMs = 0;
  return { money0, money1: totalMoneySupply(state), bytes: serialize(state) };
}

for (const [label, flags] of [['City', cityFlags], ['Metropolis', metroFlags]] as const) {
  for (const seed of [11, 4]) {
    console.log(`\n=== ${label} region-ON  seed ${seed}  (${DAYS}d) ===`);
    let a: ReturnType<typeof run> | null = null;
    try { a = run(flags, seed); } catch (e) { check('runs to day 300 without throwing', false, (e as Error).message); continue; }
    check('runs to day 300 without throwing', true);
    check('money conserved to the cent', a.money0 === a.money1, `Δ=${a.money1 - a.money0}`);
    const b = run(flags, seed);
    check('deterministic (two runs byte-identical)', a.bytes === b.bytes, a.bytes === b.bytes ? `${a.bytes.length} bytes` : 'DIVERGED');
  }
}

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
