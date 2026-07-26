/**
 * mint-golden-v9 — reproduce the towns-era golden save fixture.
 *
 * Golden save v9 is the FIRST fixture stored in the SAVE_VERSION 3 shape (the
 * region step-3 endgame: the six town-scoped record families live under
 * `state.towns.home`, and the flat `state.firms`/`state.districts`/... paths
 * survive as non-enumerable accessor aliases, so `JSON.stringify` serializes
 * ONLY the `towns` key — see src/sim/core/Town.ts). v1-v8 predate that move and
 * stay in the old flat format; every future migration must prove it can still
 * load them AND v9.
 *
 * RECIPE (mirrors how v8 was minted — City preset, seed 11, day 120, the full
 * archetype economy left to grow itself with no player intervention):
 *
 *   config   = worldScaleConfig('standard', false, 'cozy', 'city')
 *              → sizePreset 'city', servicesEnabled + realEstateEnabled +
 *                investorsEnabled all ON, challengeMode off; createInitialState
 *                then lifts the caps to the City castTarget (maxCitizens 150,
 *                maxHomes 79) and the authored City map.
 *   state    = createInitialState(11, config, 'meadowbrook')
 *   run      = 120 in-game days (ticksPerDay × 120 = 5760 ticks) with NO player
 *              build/dispatch actions — the AI founder systems grow the operator/
 *              landlord/investor/service archetypes off the live crowd on their
 *              own, exactly as the v8 run did.
 *   serialize(state) → SAVE_VERSION 3 JSON (towns.home shape, no flat keys).
 *
 * Determinism: single seed, no wall-clock reads inside the sim, fixed system
 * order — the economic state (money, rngState, every entity) is byte-identical
 * on every run. The ONE non-deterministic field is `state.perf` (avgTickMs /
 * lastTickMs), which is real wall-clock telemetry measured OUTSIDE the sim; it
 * is normalized to zero before serializing so re-running this script overwrites
 * the fixture byte-for-byte (v7/v8 froze live perf noise instead — v9 does not).
 *
 * Runnable: `npx tsx docs/design/probes/mint-golden-v9.ts`
 *   (prints a structural summary; pass WRITE=1 to (over)write the fixture).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { worldScaleConfig } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { serialize, deserialize } from '../../../src/sim/persistence/saveLoad';
import { totalMoneySupply } from '../../../src/sim/core/GameState';

const SEED = 11;
const DAYS = 120;
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'src',
  'sim',
  'tests',
  'fixtures',
  'golden-save-v9.json',
);

const config = worldScaleConfig('standard', false, 'cozy', 'city');
const sim = new Simulation(createInitialState(SEED, config, 'meadowbrook'));
const state = sim.getState();
const supply0 = totalMoneySupply(state);
sim.run(ticksPerDay(state.config) * DAYS);

const end = sim.getState();
// `perf` is wall-clock telemetry (ms measured outside the sim), the only field
// that varies run to run. Zero it so the fixture is byte-reproducible; it is
// cosmetic and no golden test asserts on it.
end.perf = { lastTickMs: 0, avgTickMs: 0, ticksSimulated: end.perf.ticksSimulated };
const json = serialize(end);

// Structural summary — proves the towns-era shape and the live archetype crowd.
const raw = JSON.parse(json) as Record<string, unknown>;
const businesses = Object.values(end.firms).filter(
  (f) => f.ownerType === 'ai' || f.ownerType === 'player',
);
const archetypes: Record<string, number> = {};
for (const f of businesses) {
  archetypes[f.strategy.archetype] = (archetypes[f.strategy.archetype] ?? 0) + 1;
}
console.log('golden save v9 — City seed 11, day', DAYS);
console.log('  saveVersion         ', raw.saveVersion);
console.log('  has towns key        ', 'towns' in raw);
console.log('  has flat firms key   ', 'firms' in raw, '(must be false — alias is non-enumerable)');
console.log('  towns.home families  ', Object.keys((raw.towns as Record<string, Record<string, unknown>>).home).join(', '));
console.log('  tick                 ', end.tick);
console.log('  archetypes           ', JSON.stringify(archetypes));
console.log('  firms                ', Object.keys(end.firms).length);
console.log('  serviceContracts     ', Object.keys(end.serviceContracts).length);
console.log('  districts / cohorts  ', Object.keys(end.districts).length, '/', Object.keys(end.cohorts).length);
console.log('  citizens             ', Object.keys(end.citizens).length);
console.log(
  '  crowd pop            ',
  Object.values(end.cohorts).reduce((n, c) => n + c.population, 0),
);
console.log('  money conserved      ', totalMoneySupply(end) === supply0);

// Round-trip stability: deserialize(serialize) is a fixed point.
const again = serialize(deserialize(json));
console.log('  round-trips stable   ', again === json);
console.log('  fixture bytes        ', Buffer.byteLength(json));

if (process.env.WRITE === '1') {
  writeFileSync(FIXTURE, json);
  console.log('  WROTE                ', FIXTURE);
} else {
  console.log('  (dry run — set WRITE=1 to write the fixture)');
}
