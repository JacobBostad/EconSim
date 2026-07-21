/**
 * Metropolis-playability probe — the human-player audit for the Metropolis
 * New-Game option (the engine preset is soak-proven for AI; this asks whether
 * it is a good PLAYER experience before wiring the UI).
 *
 * Runs the METROPOLIS preset with the SAME flags a player game sets
 * (services/realEstate/tradeDemandPools ON; investors OFF — that founder row is
 * city-only by design) and reports, per seed 11/4/7:
 *
 *   (a) player foothold — playerStartCash vs the metropolis catalog's chain
 *       build costs (the C1 breadth + C3 deep chains the wizard now reaches),
 *       and vs the $28k AI founderCash the player competes against;
 *   (b) save size — serialized state bytes at day 300 vs the ~5 MB localStorage
 *       quota, so autosave (saveGame → localStorage.setItem) cannot silently
 *       fail on the 10k-crowd-cap preset;
 *   (c) perf — ms/tick at day 300 and the implied sustainable tps at the
 *       player-facing 100× speed (SPEED_TPS[100] = 280 tps target);
 *   (d) money conserved to the cent (flags-on player config, all seeds).
 *
 * Timing note: process.hrtime runs OUTSIDE the sim (Date/Date.now are banned
 * INSIDE it), so wall timing never touches sim state.
 *
 * Runnable: `npx tsx docs/design/probes/metropolis-playability.ts`
 * (DAYS overrides 300; SEEDS overrides the comma-separated seed list).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG, SIZE_PRESETS } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import { serialize } from '../../../src/sim/persistence/saveLoad';
import { CHAIN_BLUEPRINTS, chainCost } from '../../../src/sim/data/chains';
import { productAvailableInPreset, getProduct } from '../../../src/sim/data/products';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map((s) => Number(s.trim()));
const CENTS = 100;
const D = (c: number) => (c / CENTS).toFixed(2);
// The player-game flags (mirrors useGameStore.newGame('metropolis')). Investors
// is deliberately absent: its founder row is gated === 'city', so it is inert at
// metropolis anyway — see the store comment.
const PLAYER_FLAGS = {
  sizePreset: 'metropolis' as const,
  servicesEnabled: true,
  realEstateEnabled: true,
  tradeDemandPoolsEnabled: true,
};
const founderCash = SIZE_PRESETS.metropolis.founderCash;

// --- (a) chain affordability (static; independent of seed) ------------------
console.log('=== Metropolis chain wizard reach & cost (vs AI founderCash $%s) ===', D(founderCash));
const chains = Object.values(CHAIN_BLUEPRINTS).filter((bp) =>
  productAvailableInPreset(bp.productId, 'metropolis'),
);
for (const bp of chains) {
  const village = productAvailableInPreset(bp.productId, 'village');
  const tag = village ? 'shipped' : bp.stages.length >= 3 ? 'C3-deep' : 'C1-breadth';
  console.log(
    `  ${getProduct(bp.productId).name.padEnd(12)} $${D(chainCost(bp)).padStart(9)}  ${String(bp.stages.length + 1)} stages  [${tag}]`,
  );
}
const cheapest = Math.min(...chains.map(chainCost));
const deepest = Math.max(...chains.map(chainCost));
console.log(`  cheapest chain $${D(cheapest)}  deepest chain $${D(deepest)}`);

for (const seed of SEEDS) {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, ...PLAYER_FLAGS });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const initialMoney = totalMoneySupply(state);
  const playerCash = state.firms[state.playerFirmId]!.cash;

  let winNs = 0n;
  let worstConserved = 0;
  const t0 = process.hrtime.bigint();
  sim.run(tpd * DAYS);
  winNs += process.hrtime.bigint() - t0;
  const money = totalMoneySupply(state);
  worstConserved = Math.abs(money - initialMoney);

  const bytes = serialize(state).length;
  const msPerTick = Number(winNs) / 1e6 / (tpd * DAYS);
  const ai = Object.values(state.firms).filter((f) => f.ownerType === 'ai');
  const insolvent = ai.filter((f) => f.bankruptcyStatus === 'insolvent').length;
  // At 100× the loop asks for SPEED_TPS[100] = 280 ticks/sec; sustainable tps is
  // 1000 / msPerTick (one core). >280 ⇒ 100× runs at full speed.
  const sustainableTps = 1000 / msPerTick;

  console.log(JSON.stringify({
    seed,
    playerStartCash: D(playerCash),
    playerVsAiFounder: D(playerCash - founderCash),
    canAffordDeepChain: playerCash >= deepest,
    canAffordTwoStarterChains: playerCash >= cheapest * 2,
    aiFirmsDay300: ai.length,
    insolventDay300: insolvent,
    saveBytes: bytes,
    saveKiB: (bytes / 1024).toFixed(1),
    quotaFractionOf5MB: (bytes / (5 * 1024 * 1024)).toFixed(4),
    msPerTick: msPerTick.toFixed(3),
    sustainableTps: sustainableTps.toFixed(0),
    fullSpeedAt100x: sustainableTps >= 280,
    conservedToCent: worstConserved === 0,
  }, null, 1));
}
