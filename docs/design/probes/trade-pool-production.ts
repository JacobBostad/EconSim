/**
 * trade-pool-production — Arc E STEP 2 verification (docs/design/region.md,
 * "producing trade cities"). The companion to trade-pool.ts (step 1): where that
 * probe measures the import-only pool, this one measures the SUPPLY side each
 * city gains in step 2 — it produces a fraction of what it consumes, so exports
 * fill only the GAP its production leaves.
 *
 * Three arms:
 *   1. PRODUCTION — per-port local output (units/day) vs consumption, showing the
 *      food/industry mirror (Port Rosa grows its food, Ironvale its industry).
 *   2. SPECIALIZATION — dump the same fraction of target on each port and time
 *      how long the overhang lingers: the good a port SELF-SUPPLIES lingers, the
 *      good it IMPORTS clears fast. This is the whole point of the step.
 *   3. TENDER (gap-only) — one tender throttles imports; production shields the
 *      self-supplied good while the imported one starves to the premium clamp.
 *
 * Read-only beyond the sims it builds. Run: npx tsx docs/design/probes/trade-pool-production.ts
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay, computeTime } from '../../../src/sim/core/Tick';
import { performExport } from '../../../src/sim/core/Trade';
import { addStock } from '../../../src/sim/entities/Inventory';
import {
  poolTargetInventory,
  poolConsumptionPerDay,
  poolLocalProductionPerDay,
  localProductionFraction,
  poolCoverMult,
} from '../../../src/sim/data/tradePool';

const SEED = 11;
const CITIES = ['port_rosa', 'ironvale'] as const;

/** A warmed City sim with the pools on, walk let settle for 40 days. */
function warmed(): Simulation {
  const state = createInitialState(SEED, { ...DEFAULT_CONFIG, sizePreset: 'city', tradeDemandPoolsEnabled: true });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  sim.run(ticksPerDay(state.config) * 40);
  return sim;
}

/** Load a player warehouse with `units` of `pid` and return it. */
function loadWarehouse(sim: Simulation, pid: string, units: number) {
  const state = sim.getState();
  const player = state.firms[state.playerFirmId]!;
  player.cash = 500000_00;
  sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
  const wh = state.facilities[player.facilities[player.facilities.length - 1]!]!;
  addStock(wh.inputInventory, pid, units, 60);
  return wh;
}

console.log('=== Arc E step 2 — producing trade cities (City preset, seed 11) ===\n');

// --- 1. PRODUCTION: local output vs consumption, the food/industry mirror ----
console.log('PRODUCTION — local output refills the larder each day (units/day at equilibrium):');
for (const cid of CITIES) {
  for (const pid of ['bread', 'coffee', 'tools', 'jewelry'] as const) {
    const prod = poolLocalProductionPerDay(cid, pid);
    const cons = poolConsumptionPerDay(cid, pid);
    console.log(
      `   ${cid.padEnd(10)} ${pid.padEnd(7)} ${prod.toFixed(1).padStart(6)}/day of ${cons.toFixed(1).padStart(6)} consumed` +
      ` (${(localProductionFraction(cid, pid) * 100).toFixed(0).padStart(2)}% self-supplied)`,
    );
  }
}
console.log('');

// --- 2. SPECIALIZATION: a self-supplied good's overhang lingers --------------
console.log('SPECIALIZATION — dump 50% of target on each port; cover-mult d0 + days until cover');
console.log('works back within 5% of target (walk held at center to isolate the pool):');
for (const pid of ['bread', 'tools'] as const) {
  const line: string[] = [];
  for (const cid of CITIES) {
    const sim = warmed();
    const state = sim.getState();
    const tpd = ticksPerDay(state.config);
    const target = poolTargetInventory(cid, pid);
    const dump = Math.round(target * 0.5);
    const wh = loadWarehouse(sim, pid, dump + 50);
    performExport(state, state.playerFirmId, wh.id, pid, dump, 'spec', cid);
    const coverMult = () => target / Math.max(state.tradeCities[cid]!.pool!.inventory[pid]!, 1);
    const d0 = coverMult();
    let days = 30;
    for (let d = 0; d <= 30; d++) {
      if (coverMult() >= 0.95) { days = d; break; }
      sim.run(tpd);
    }
    line.push(`${cid.padEnd(9)} (${(localProductionFraction(cid, pid) * 100).toFixed(0)}% made) d0 ${d0.toFixed(3)}× → cleared ~${days}d`);
  }
  console.log(`   ${pid.padEnd(6)}: ${line.join('   |   ')}`);
}
console.log('   (the good a port MAKES lingers; the good it IMPORTS clears — the mirror)\n');

// --- 3. TENDER (gap-only): production shields the self-supplied good ----------
console.log('TENDER — one 1.5× / 6-day tender on Port Rosa; gap-only imports let production');
console.log('shield the self-supplied good while the imported one starves to the clamp:');
for (const pid of ['bread', 'tools'] as const) {
  const sim = warmed();
  const state = sim.getState();
  const tpd = ticksPerDay(state.config);
  const day = computeTime(state.tick, state.config).day;
  state.tradeAnnouncement = {
    cityId: 'port_rosa', productId: pid, mult: 1.5,
    announcedDay: day, effectDay: day + 1, durationDays: 6,
  };
  for (let d = 0; d < 6; d++) sim.run(tpd);
  const inv = state.tradeCities['port_rosa']!.pool!.inventory[pid]!;
  const tgt = poolTargetInventory('port_rosa', pid);
  console.log(
    `   port_rosa ${pid.padEnd(6)} (${(localProductionFraction('port_rosa', pid) * 100).toFixed(0)}% made):` +
    ` inv ${(inv / tgt).toFixed(3)}× target → cover-mult ${poolCoverMult('port_rosa', pid, inv).toFixed(3)}`,
  );
}
