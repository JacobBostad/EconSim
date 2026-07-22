/**
 * City-challenge probe — the balance evidence for Challenge mode at City scale.
 *
 * Runs the SAME scripted 200-day bot (the playtestV7 pillar-era strategy: a
 * delegated bread chain, an executive logistics desk, R&D into a premium sign,
 * announcement trading, and forwards) at THREE settings and prints the day-200
 * challengeScore breakdown for each, so the City score can be read directly
 * against the Village norm it must live beside:
 *
 *   - Village / meadowbrook (the classic challenge — the calibration baseline);
 *   - City / meadowbrook (the same town, the whole crowd economy switched on);
 *   - City / grand_junction (the authored City challenge scenario).
 *
 * The score is unchanged sim behavior scored by challengeScore — the probe only
 * measures; it never tunes the sim. It exists to answer the one balance
 * question: does a competent City run land in a sane band vs a Village one, or
 * do the valuation / export caps (tuned for the Village) mis-score the City?
 *
 * Runnable: `npx tsx docs/design/probes/city-challenge.ts`  (SEEDS env override).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { worldScaleConfig } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay, computeTime } from '../../../src/sim/core/Tick';
import { totalMoneySupply } from '../../../src/sim/core/GameState';
import { challengeScore, CHALLENGE_END_DAY } from '../../../src/sim/selectors/reportSelectors';
import { companyValuation } from '../../../src/sim/selectors/companySelectors';
import { cityPrice, exportFreightFee } from '../../../src/sim/core/Trade';
import { getQuantity } from '../../../src/sim/entities/Inventory';
import { getProduct } from '../../../src/sim/data/products';
import { TRADE_CITY_IDS } from '../../../src/sim/data/tradeCities';
import type { GameState } from '../../../src/sim/core/GameState';
import type { SimulationConfig } from '../../../src/sim/core/SimulationConfig';

const SEEDS = (process.env.SEEDS ?? '11,9').split(',').map((s) => Number(s.trim()));

/** Run the v7 bread-chain bot for 200 days and return the finished state.
 * Conservation is measured AFTER the probe-only working-capital injection, so
 * it tracks the sim's own bookkeeping (the injection itself is not a leak). */
function runBot(seed: number, config: SimulationConfig, scenarioId: string): { state: GameState; conserved: boolean } {
  const sim = new Simulation(createInitialState(seed, config, scenarioId));
  const state = sim.getState();
  const tpd = ticksPerDay(state.config);
  const player = state.firms[state.playerFirmId]!;
  player.cash = 40000_00; // the v7 bot's working capital (probe-only)
  const supply0 = totalMoneySupply(state);
  let stage = 0;
  let annHolding: string | null = null;
  let annForwarded = false;

  const facs = () => player.facilities.map((i) => state.facilities[i]!);
  for (let d = 0; d < CHALLENGE_END_DAY; d++) {
    const day = computeTime(state.tick, state.config).day;
    if (stage === 0 && player.cash >= 12000_00) {
      sim.dispatch({ type: 'BUILD_CHAIN', firmId: player.id, productId: 'bread' });
      sim.dispatch({ type: 'BUILD_FACILITY', firmId: player.id, defId: 'warehouse', location: { x: 100, y: 20 } });
      const wh = facs().find((f) => f.type === 'warehouse');
      const factory = facs().find((f) => f.type === 'factory');
      const shop = facs().find((f) => f.type === 'retail');
      if (wh && factory && shop) {
        sim.dispatch({ type: 'CREATE_SUPPLY_CONTRACT', ownerFirmId: player.id, sourceFacilityId: factory.id, destinationFacilityId: wh.id, productId: 'bread', targetQuantity: 6, reorderPoint: 500, maxInventory: 999 });
        sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, facilityId: shop.id, candidateIndex: 1 });
        sim.dispatch({ type: 'HIRE_MANAGER', firmId: player.id, role: 'logistics', candidateIndex: 0 });
        stage = 1;
      }
    }
    if (stage === 1 && player.cash > 15000_00) {
      sim.dispatch({ type: 'INVEST_RND', firmId: player.id, productId: 'bread', amount: 2000_00 });
      if ((player.qualityByProduct['bread'] ?? 50) >= 62) {
        const shop = facs().find((f) => f.type === 'retail');
        if (shop) sim.dispatch({ type: 'SET_POSITIONING', facilityId: shop.id, positioning: 'premium' });
        stage = 2;
      }
    }
    const wh = facs().find((f) => f.type === 'warehouse');
    const ann = state.tradeAnnouncement;
    if (wh && ann && ann.mult > 1) {
      if (!annHolding && day < ann.effectDay && player.cash > 5000_00) {
        const buyCity = TRADE_CITY_IDS.reduce((a, b) =>
          cityPrice(state, a, ann.productId) * (1 + exportFreightFee(state, a)) <
          cityPrice(state, b, ann.productId) * (1 + exportFreightFee(state, b)) ? a : b);
        sim.dispatch({ type: 'BUY_FROM_CITY', firmId: player.id, facilityId: wh.id, productId: ann.productId, quantity: 50, cityId: buyCity });
        annHolding = ann.productId;
      } else if (annHolding && !annForwarded && day >= ann.effectDay && player.forwards.length < 2
          && cityPrice(state, ann.cityId, annHolding) >= getProduct(annHolding).basePrice * 1.3) {
        sim.dispatch({ type: 'SELL_FORWARD', firmId: player.id, productId: annHolding, quantity: 30, cityId: ann.cityId, deliveryDay: day + 3 });
        annForwarded = true;
      } else if (annHolding && day >= ann.effectDay + ann.durationDays - 2) {
        sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: annHolding, quantity: annForwarded ? 20 : 50, cityId: ann.cityId });
        annHolding = null;
        annForwarded = false;
      }
    }
    if (!ann && annHolding && wh) {
      sim.dispatch({ type: 'EXPORT_GOODS', firmId: player.id, facilityId: wh.id, productId: annHolding, quantity: annForwarded ? 20 : 50 });
      annHolding = null;
      annForwarded = false;
    }
    if (wh && player.forwards.length < 2 && getQuantity(wh.inputInventory, 'bread') + getQuantity(wh.outputInventory, 'bread') >= 30) {
      for (const cid of TRADE_CITY_IDS) {
        if (cityPrice(state, cid, 'bread') >= getProduct('bread').basePrice * 1.3) {
          sim.dispatch({ type: 'SELL_FORWARD', firmId: player.id, productId: 'bread', quantity: 30, cityId: cid, deliveryDay: day + 5 });
          break;
        }
      }
    }
    for (const fac of facs()) {
      const target = fac.type === 'home' || fac.defId === 'apartment' ? 0 : 2;
      if (fac.employees.length < target) sim.dispatch({ type: 'HIRE_WORKER', facilityId: fac.id, citizenId: null });
    }
    sim.run(tpd);
  }
  return { state, conserved: totalMoneySupply(state) === supply0 };
}

function report(label: string, run: { state: GameState; conserved: boolean }): void {
  const { state, conserved } = run;
  const s = challengeScore(state);
  const player = state.firms[state.playerFirmId]!;
  console.log(`\n${label}`);
  console.log(`  score        ${s.total}/1000  (raw ${s.rawTotal} × ${s.difficultyMult})`);
  console.log(`  valuation    ${s.valuationPts}/600   $${(s.valuation / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  console.log(`  satisfaction ${s.satisfactionPts}/150   ${s.satisfaction.toFixed(1)}/100 (cast+crowd)`);
  console.log(`  share        ${s.sharePts}/150   ${(s.peakShare * 100).toFixed(0)}%`);
  console.log(`  exports      ${s.exportPts}/100   $${(s.exportRevenue / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  console.log(`  firm         ${player.bankruptcyStatus}, netWorth $${(companyValuation(state, player.id).netWorth / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}, ${Object.keys(state.cohorts).length} cohorts, conserved=${conserved}`);
}

for (const seed of SEEDS) {
  console.log(`\n===================== seed ${seed} =====================`);
  const village = worldScaleConfig('standard', true, 'cozy', 'village');
  const city = worldScaleConfig('standard', true, 'cozy', 'city');
  report('Village · meadowbrook', runBot(seed, village, 'meadowbrook'));
  report('City · meadowbrook', runBot(seed, city, 'meadowbrook'));
  report('City · grand_junction', runBot(seed, city, 'grand_junction'));
}
