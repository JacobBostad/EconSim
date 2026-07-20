/**
 * village-bitidentity-check — Arc B3 verification helper.
 *
 * Dumps a 300-day Village serialized-state hash + rngState for seeds 1/11/777.
 * Run on the Phase 5 branch and on the pre-Phase-5 base; the hashes must match
 * exactly (the orchestrator's bit-identity contract). Reads state only.
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { serialize } from '../../../src/sim/persistence/saveLoad';
import { createHash } from 'crypto';

for (const seed of [1, 11, 777]) {
  const state = createInitialState(seed); // default preset = village
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  sim.run(ticksPerDay(state.config) * 300);
  const raw = JSON.parse(serialize(state)) as Record<string, unknown>;
  raw.perf = { lastTickMs: 0, avgTickMs: 0, ticksSimulated: 0 };
  const h = createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0, 16);
  console.log(`village seed ${seed}: rngState=${state.rngState} hash=${h}`);
}
