/**
 * Real-estate probe — the Arc D2 (HD4) landlord archetype baseline.
 *
 * Runs the CITY and METROPOLIS presets with the real-estate channel ON for
 * 300 days × seeds 11/4/7 and measures what the landlord archetype produces:
 *
 *   (a) landlord firms — how many found, and are they solvent at day 300?
 *   (b) rent yield — annualized rent income over each landlord's apartment book
 *       value (target band 12-18%);
 *   (c) housing occupancy — does the town run tight, and does the landlord's new
 *       stock respond to it?
 *   (d) metropolis FOUNDER PINS with the flag ON — do the pinned 24-30 firms /
 *       0-insolvent still hold once landlords enter, or do they shift? (The
 *       pinned SUITE baseline runs flag-OFF and is bit-identical — verified
 *       separately; this measures the flag-ON world honestly.)
 *   (e) money conserved to the cent on every seed.
 *
 * Wall timing is process.hrtime (outside the sim). Runnable:
 *   `npx tsx docs/design/probes/real-estate.ts`  (DAYS / SEEDS env overrides).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import type { SizePreset } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import type { GameState } from '../../../src/sim/core/GameState';
import { facilityBookValue } from '../../../src/sim/core/Demolition';
import { townHousingOccupancy } from '../../../src/sim/systems/ai/LandlordBehavior';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map(Number);
const START_MONEY = 0; // set per-run

function landlordBookValue(state: GameState, firmId: string): number {
  let bv = 0;
  for (const fid in state.facilities) {
    const f = state.facilities[fid]!;
    if (f.defId === 'apartment' && f.ownerFirmId === firmId) bv += facilityBookValue(f);
    if (f.landlordFirmId === firmId) bv += facilityBookValue(f);
  }
  return bv;
}

function landlordRevenue(state: GameState, firmId: string): number {
  return state.firms[firmId]?.accounting.lifetime.revenue ?? 0;
}

function run(preset: SizePreset, seed: number): void {
  const state = createInitialState(seed, {
    ...DEFAULT_CONFIG,
    sizePreset: preset,
    realEstateEnabled: true,
    // Metropolis also runs its services channel in the pinned soak; leave it off
    // here so the measurement isolates the landlord archetype.
  });
  const startMoney = totalMoneySupply(state);
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);

  // Capture landlord revenue at DAYS-30 to annualize a trailing yield.
  const revAt: Record<string, number> = {};
  sim.run((DAYS - 30) * tpd);
  for (const fid in state.firms) {
    if (state.firms[fid]!.strategy.archetype === 'landlord') revAt[fid] = landlordRevenue(state, fid);
  }
  sim.run(30 * tpd);

  const s = sim.getState();
  const ai = Object.values(s.firms).filter((f) => f.ownerType === 'ai');
  const landlords = ai.filter((f) => f.strategy.archetype === 'landlord');
  const insolventAll = ai.filter((f) => f.bankruptcyStatus === 'insolvent').length;
  const insolventLL = landlords.filter((f) => f.bankruptcyStatus === 'insolvent').length;
  const occ = townHousingOccupancy(s);
  const money = totalMoneySupply(s);
  const conserved = money === startMoney;

  const yields: string[] = [];
  for (const f of landlords) {
    const bv = landlordBookValue(s, f.id);
    const rev30 = landlordRevenue(s, f.id) - (revAt[f.id] ?? landlordRevenue(s, f.id));
    const annual = rev30 * (365 / 30);
    const y = bv > 0 ? (annual / bv) * 100 : 0;
    yields.push(`${f.name}: bv=$${(bv / 100).toFixed(0)} yield=${y.toFixed(1)}% cash=$${(f.cash / 100).toFixed(0)} ${f.bankruptcyStatus}`);
  }

  console.log(`\n[${preset} seed ${seed}] day ${DAYS}`);
  console.log(`  AI firms: ${ai.length} (landlords ${landlords.length}); insolvent: all ${insolventAll}, landlords ${insolventLL}`);
  console.log(`  housing occupancy: ${(occ * 100).toFixed(1)}%  housingTightDays=${s.housingTightDays}`);
  console.log(`  conservation: ${conserved ? 'EXACT' : `DRIFT ${(money - startMoney)}c`}`);
  for (const line of yields) console.log(`    ${line}`);
}

void START_MONEY;
for (const preset of ['city', 'metropolis'] as SizePreset[]) {
  for (const seed of SEEDS) run(preset, seed);
}
