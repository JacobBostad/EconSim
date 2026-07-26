/**
 * mint-golden-v10 — reproduce the region+interest-era golden save fixture.
 *
 * Golden save v10 is the FIRST fixture minted from a CURRENT City new game — the
 * region.md step-4 endgame plus the risk-tiered interest that shipped alongside
 * it. Both are now `worldScaleConfig` City new-game defaults:
 *
 *   - `regionEnabled` — a live PARTNER TOWN materializes at `state.towns.port_rosa`
 *     (a second economy: its own cohorts, firms, facilities, marketStats), home
 *     trades with it across a lead-timed FREIGHT edge, and the region-wide money
 *     primitive conserves across both towns to the cent.
 *   - `riskTieredInterestEnabled` — leverage-priced loans (proven zero-AI-impact
 *     on the pinned paths, so it perturbs no baseline).
 *
 * So v10 is the SECOND fixture in the SAVE_VERSION 3 towns shape (after v9) and the
 * FIRST with a second town under `towns` — v9 is a one-town (`home`) region minted
 * before either flag existed, and stays exactly as it is. v1-v8 predate the towns
 * move and stay flat. The corpus-split guard in goldenSave.test.ts pins all three
 * eras; every future migration must load the flat corpus, the one-town v9, AND the
 * two-town v10.
 *
 * RECIPE (mirrors mint-golden-v9 — City preset, seed 11, day 120, the archetype
 * economy grown unattended — with ONE added, fully deterministic player action so
 * the fixture carries a live freight shipment IN FLIGHT at the cut):
 *
 *   config   = worldScaleConfig('standard', false, 'cozy', 'city')
 *              → sizePreset 'city', services + realEstate + investors + trade
 *                pools + REGION + risk-tiered interest all ON (the City new-game
 *                stack); createInitialState then lifts the caps to the City
 *                castTarget and seeds the live `port_rosa` partner town.
 *   state    = createInitialState(11, config, 'meadowbrook')
 *   run      = 118 in-game days unattended (the AI grows the operator/landlord/
 *              investor/service archetypes off the live crowd, exactly as v9).
 *   dispatch = on day 118 the player builds a warehouse, buys 300 bread into it
 *              from Ironvale, and FREIGHTS it to the live partner Port Rosa — a
 *              dated shipment (arrivalDay = 118 + FREIGHT_LEAD_DAYS = 121).
 *   run      = 2 more days → day 120. The shipment is still IN FLIGHT (arrival
 *              121 > 120): `state.freight` carries it, and it round-trips through
 *              the save (lands + pays on day 121 after a load — pinned in the test).
 *   serialize(state) → SAVE_VERSION 3 JSON (towns.home + towns.port_rosa, freight).
 *
 * Determinism: single seed, no wall-clock reads inside the sim, fixed system and
 * town order, and the day-118 dispatch is three deterministic commands — the
 * economic state (money, rngState, every entity, the in-flight shipment) is
 * byte-identical on every run. The ONE non-deterministic field is `state.perf`
 * (avgTickMs / lastTickMs), wall-clock telemetry measured OUTSIDE the sim; it is
 * normalized to zero before serializing so re-running overwrites the fixture
 * byte-for-byte (the v9 improvement, carried forward).
 *
 * Runnable: `npx tsx docs/design/probes/mint-golden-v10.ts`
 *   (prints a structural summary; pass WRITE=1 to (over)write the fixture).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { worldScaleConfig } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay, computeTime } from '../../../src/sim/core/Tick';
import { serialize, deserialize } from '../../../src/sim/persistence/saveLoad';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import { getQuantity } from '../../../src/sim/entities/Inventory';
import { PARTNER_TOWN_ID } from '../../../src/sim/data/seedTown';
import { FREIGHT_LEAD_DAYS } from '../../../src/sim/data/constants';

const SEED = 11;
const RUN_TO_DAY = 118; // dispatch the freight here…
const DAYS = 120; // …and cut two days later, with the shipment still in flight.
const EXPORT_QTY = 300;
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'src',
  'sim',
  'tests',
  'fixtures',
  'golden-save-v10.json',
);

const config = worldScaleConfig('standard', false, 'cozy', 'city');
const sim = new Simulation(createInitialState(SEED, config, 'meadowbrook'));
const state = sim.getState();
const supply0 = totalMoneySupply(state);
const tpd = ticksPerDay(state.config);

// Grow the world unattended to day 118 (the v9 recipe).
sim.run(tpd * RUN_TO_DAY);

// Day-118 player action — the one deterministic intervention: freight a staple to
// the live partner so the fixture freezes a shipment IN FLIGHT at the cut.
const playerId = state.playerFirmId;
sim.dispatch({ type: 'BUILD_FACILITY', firmId: playerId, defId: 'warehouse', location: { x: 100, y: 20 } });
const player = state.firms[playerId];
const wh = state.facilities[player.facilities[player.facilities.length - 1]!]!;
if (wh.type !== 'warehouse') throw new Error(`expected a warehouse, built a ${wh.type} — pick another location`);
sim.dispatch({ type: 'BUY_FROM_CITY', firmId: playerId, facilityId: wh.id, productId: 'bread', quantity: EXPORT_QTY, cityId: 'ironvale' });
const staged = getQuantity(wh.inputInventory, 'bread') + getQuantity(wh.outputInventory, 'bread');
if (staged < EXPORT_QTY) throw new Error(`only staged ${staged}/${EXPORT_QTY} bread — the buy did not fill the warehouse`);
sim.dispatch({ type: 'EXPORT_GOODS', firmId: playerId, facilityId: wh.id, productId: 'bread', quantity: EXPORT_QTY, cityId: PARTNER_TOWN_ID });
if (state.freight.length !== 1) throw new Error(`expected 1 in-flight shipment, have ${state.freight.length}`);

// Two more days → day 120, shipment still in flight (arrival 121).
sim.run(tpd * (DAYS - RUN_TO_DAY));

const end = sim.getState();
if (computeTime(end.tick, end.config).day !== DAYS) throw new Error(`cut on day ${computeTime(end.tick, end.config).day}, expected ${DAYS}`);
if (end.freight.length !== 1) throw new Error(`expected the shipment still in flight at the cut, have ${end.freight.length}`);
// `perf` is wall-clock telemetry (ms measured outside the sim), the only field
// that varies run to run. Zero it so the fixture is byte-reproducible; it is
// cosmetic and no golden test asserts on it.
end.perf = { lastTickMs: 0, avgTickMs: 0, ticksSimulated: end.perf.ticksSimulated };
const json = serialize(end);

// Structural summary — proves the region shape (two towns), the live partner book,
// the in-flight freight, and the archetype crowd.
const raw = JSON.parse(json) as Record<string, unknown>;
const towns = raw.towns as Record<string, Record<string, unknown>>;
const partner = end.towns[PARTNER_TOWN_ID]!;
const partnerHistory = Object.values(partner.marketStats).reduce((n, m) => n + (m.history?.length ?? 0), 0);
const businesses = Object.values(end.firms).filter((f) => f.ownerType === 'ai' || f.ownerType === 'player');
const archetypes: Record<string, number> = {};
for (const f of businesses) archetypes[f.strategy.archetype] = (archetypes[f.strategy.archetype] ?? 0) + 1;
const ship = end.freight[0]!;
console.log('golden save v10 — City seed 11, region + interest, day', DAYS);
console.log('  saveVersion         ', raw.saveVersion);
console.log('  config.regionEnabled', end.config.regionEnabled);
console.log('  config.riskTiered   ', end.config.riskTieredInterestEnabled);
console.log('  towns               ', Object.keys(towns).join(', '), '(v10 is the first with a second town)');
console.log('  has flat firms key   ', 'firms' in raw, '(must be false — alias is non-enumerable)');
console.log('  partner marketStats  ', Object.keys(partner.marketStats).length, 'products,', partnerHistory, 'history entries');
console.log('  partner firms/cohorts', Object.keys(partner.firms).length, '/', Object.keys(partner.cohorts).length);
console.log('  freight in flight    ', end.freight.length, `— ${ship.qty} ${ship.productId} home→${ship.destTownId}, arrive day ${ship.arrivalDay} (FREIGHT_LEAD_DAYS=${FREIGHT_LEAD_DAYS})`);
console.log('  archetypes           ', JSON.stringify(archetypes));
console.log('  firms                ', Object.keys(end.firms).length);
console.log('  serviceContracts     ', Object.keys(end.serviceContracts).length);
console.log('  crowd pop            ', Object.values(end.cohorts).reduce((n, c) => n + c.population, 0));
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
