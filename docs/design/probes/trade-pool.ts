/**
 * trade-pool — Arc E slice verification (docs/design/region.md).
 *
 * Measures the trade-city demand pool's two headline behaviours against the
 * pre-Arc-E baseline (the pure random walk + one-tick price impact):
 *
 *   1. OVERHANG DECAY — dump 500 bread on Port Rosa and watch the quote. Before:
 *      one impact tick that the walk's center-pull heals within a day or two.
 *      After: the shipment piles into the city's larder, cover jumps, and the
 *      discount persists for days as consumption works the stock back off.
 *
 *   2. STARVATION PREMIUM — drain the pool (a shortage) and watch the quote pay
 *      up until its stock refills.
 *
 * Also asserts money conservation across a dump (the pool holds no money) and
 * determinism (two flag-on runs agree). Read-only beyond the sims it builds.
 *
 * Run: npx tsx docs/design/probes/trade-pool.ts
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import { cityPrice, performExport } from '../../../src/sim/core/Trade';
import { addStock } from '../../../src/sim/entities/Inventory';
import { getProduct } from '../../../src/sim/data/products';
import { poolCoverDays, poolTargetInventory } from '../../../src/sim/data/tradePool';

const CITY = 'port_rosa';
const PID = 'bread';
const base = getProduct(PID).basePrice;

function warmed(seed: number, pools: boolean): Simulation {
  const state = createInitialState(seed, {
    ...DEFAULT_CONFIG,
    sizePreset: 'city',
    tradeDemandPoolsEnabled: pools,
  });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  sim.run(ticksPerDay(state.config) * 40); // let the town and walk settle
  return sim;
}

/** Build a player warehouse loaded with `units` of bread and return it. */
function loadWarehouse(sim: Simulation, units: number) {
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  player.cash = 500000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
  const wh = state.facilities[player.facilities[player.facilities.length - 1]!]!;
  addStock(wh.inputInventory, PID, units, 60);
  return wh;
}

function mult(sim: Simulation): number {
  return cityPrice(sim.getState(), CITY, PID) / base;
}

/** Reset Port Rosa's bread walk to the neutral center so a dump is measured
 * from 1.00×, not wherever the day-40 walk happened to leave it (bread trades
 * low at some seeds and the 0.6× band floor would mask the pool otherwise). */
function neutralize(sim: Simulation): void {
  sim.getState().tradeCities[CITY]!.pricesByProduct[PID] = base;
}

console.log('=== Arc E trade-pool probe (City preset) ===\n');

// --- 1. Overhang decay: before (walk only) vs after (pool) ------------------
for (const pools of [false, true]) {
  const sim = warmed(11, pools);
  const tpd = ticksPerDay(sim.getState().config);
  const wh = loadWarehouse(sim, 600);
  neutralize(sim);
  const before = mult(sim);
  const supply0 = totalMoneySupply(sim.getState());
  performExport(sim.getState(), sim.getState().playerFirmId, wh.id, PID, 500, 'probe dump', CITY);
  const curve: string[] = [`d0=${mult(sim).toFixed(3)}×`];
  for (let d = 1; d <= 10; d++) {
    sim.run(tpd);
    // Re-neutralize the underlying walk each day so the curve shows the POOL's
    // decay, not the walk wandering (the pool layers on top of the live walk in
    // real play; here we hold the walk fixed to isolate the overhang).
    if (pools) sim.getState().tradeCities[CITY]!.pricesByProduct[PID] = base;
    curve.push(`d${d}=${mult(sim).toFixed(3)}×`);
  }
  const supply1 = totalMoneySupply(sim.getState());
  console.log(`${pools ? 'AFTER  (pool on) ' : 'BEFORE (walk only)'}  from ${before.toFixed(3)}× center, dump 500 bread:`);
  console.log('   ' + curve.join('  '));
  console.log(`   money conserved across dump+10d: ${supply0 === supply1} (Δ=${supply1 - supply0})`);
  console.log('');
}

// --- 1b. Overhang DURATION scales with dump size (the inventory property the
// one-tick impact can't reproduce — it clamps to the floor regardless). ------
{
  console.log('OVERHANG scales with dump size (pool on; d0 discount + days until within 5% of center):');
  for (const units of [200, 500, 1000, 1500]) {
    const sim = warmed(11, true);
    const tpd = ticksPerDay(sim.getState().config);
    const wh = loadWarehouse(sim, units + 50);
    neutralize(sim);
    performExport(sim.getState(), sim.getState().playerFirmId, wh.id, PID, units, 'sized dump', CITY);
    const peakStock = sim.getState().tradeCities[CITY]!.pool!.inventory[PID]!;
    const d0 = mult(sim);
    let days = 25;
    for (let d = 0; d <= 25; d++) {
      sim.getState().tradeCities[CITY]!.pricesByProduct[PID] = base;
      if (mult(sim) >= 0.95) { days = d; break; }
      sim.run(tpd);
    }
    console.log(`   ${String(units).padStart(4)} units → d0 ${d0.toFixed(3)}× (peak cover ${poolCoverDays(CITY, PID, peakStock).toFixed(1)}d), depressed ~${days}d`);
  }
  console.log('');
}

// --- 2. Starvation premium (pool on) ---------------------------------------
{
  const sim = warmed(11, true);
  const tpd = ticksPerDay(sim.getState().config);
  const target = poolTargetInventory(CITY, PID);
  // Drain the larder to ~1 day of cover (target is 6): a genuine shortage.
  sim.getState().tradeCities[CITY]!.pool!.inventory[PID] = target / 6;
  const curve: string[] = [`d0=${mult(sim).toFixed(3)}×`];
  for (let d = 1; d <= 10; d++) {
    sim.run(tpd);
    curve.push(`d${d}=${mult(sim).toFixed(3)}×`);
  }
  console.log('STARVATION (pool on)  larder drained to ~1 day of cover:');
  console.log('   ' + curve.join('  '));
  console.log('');
}

// --- 3. Determinism: two flag-on runs agree bit-for-bit ---------------------
{
  const a = warmed(7, true);
  const b = warmed(7, true);
  const tpd = ticksPerDay(a.getState().config);
  for (const s of [a, b]) {
    const wh = loadWarehouse(s, 400);
    performExport(s.getState(), s.getState().playerFirmId, wh.id, PID, 300, 'det', CITY);
    s.run(tpd * 5);
  }
  const pa = a.getState().tradeCities[CITY]!.pool!.inventory[PID]!;
  const pb = b.getState().tradeCities[CITY]!.pool!.inventory[PID]!;
  console.log(`DETERMINISM: two seed-7 pool runs agree — inventory ${pa === pb} (${pa} vs ${pb}), rngState ${a.getState().rngState === b.getState().rngState}`);
}
