/**
 * C3 deep-chain probe — the Arc C3 diagnostic baseline.
 *
 * Arc C3 deepens two metropolis chains from raw->consumer (2 stages) to
 * raw->intermediate->consumer (3 stages):
 *   minerals -> STEEL  -> appliances
 *   lumber   -> PLANKS -> furniture
 * The intermediate is a producer good (no needSpec, never retailed) that moves
 * firm-to-firm on the existing wholesale/contract machinery.
 *
 * This probe stands up WIZARD-built 3-stage chains for the player in a
 * metropolis and runs 300 days. It shows the deep chain runs END-TO-END
 * PROFITABLY: the intermediate genuinely FLOWS stage-to-stage, the finished
 * good reaches retail AND (its thin-local-demand surplus) the export market,
 * and every dollar is conserved. Reports, without touching the balance:
 *
 *   (1) chain depth table — product -> stage count / recipe path;
 *   (2) steel/planks throughput — units the intermediate stage produced and
 *       shipped downstream over the run (the intermediate genuinely FLOWS);
 *   (3) deterministic per-unit value-add through the appliances chain — each
 *       stage lifts its input to a higher-value output, so the deep chain is
 *       profitable per unit of throughput (overhead aside);
 *   (4) per-stage P&L (7-day EMA at day 300) + the bottom line: the firm's cash
 *       delta over the run and units retailed locally vs exported;
 *   (5) perf + conservation — ms/tick at day 300, money conserved to the cent.
 *
 * Why an export leg: metropolis appliance/furniture demand is a comfortable+
 * durable served ONLY by the named cast, of whom just a handful reach the
 * comfortable tier (measured ~2-4 buyers) — so a LONE deep chain cannot cover
 * its 7-worker overhead on local retail alone (the same "single-product chain
 * is sub-scale" finding as the 2-stage chains, deliberate). The documented arc
 * is to serve the local shelf AND export the surplus; a deep chain that does so
 * is strongly cash-positive. The probe drives exactly that managed operation.
 *
 * Timing note: Date/Date.now is banned INSIDE the sim; this harness runs OUTSIDE
 * it — wall timing uses process.hrtime, which never touches sim state.
 *
 * Runnable: `npx tsx docs/design/probes/c3-chains.ts` (DAYS overrides the
 * 300-day length; SEEDS overrides the seed list, comma-separated).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { totalMoneySupply, recordTransaction } from '../../../src/sim/core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../../../src/sim/core/Transactions';
import { nextId } from '../../../src/sim/core/Id';
import { createFacility } from '../../../src/sim/entities/factories';
import { CHAIN_BLUEPRINTS, stageOutput } from '../../../src/sim/data/chains';
import { getRecipe } from '../../../src/sim/data/recipes';
import { getProduct } from '../../../src/sim/data/products';
import type { Facility } from '../../../src/sim/entities/Facility';
import type { GameState } from '../../../src/sim/core/GameState';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '7,11,4').split(',').map((s) => Number(s.trim()));

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function depthTable(): void {
  console.log('\n=== (1) chain depth (product -> stages) ===');
  for (const [pid, bp] of Object.entries(CHAIN_BLUEPRINTS)) {
    const path = bp.stages.map((st) => st.recipeId).join(' -> ') + ' -> [retail]';
    console.log(`  ${pid.padEnd(11)} ${bp.stages.length} stages: ${path}`);
  }
}

/** Deterministic per-unit value-add through a chain: each stage's embodied
 * variable cost per output unit vs the product's reference (base) price. Proves
 * the deep chain is profitable per unit of throughput, independent of any run. */
function valueAddTable(productId: string): void {
  console.log(`\n=== (3) per-unit value-add: ${productId} chain (reference/base prices) ===`);
  const bp = CHAIN_BLUEPRINTS[productId]!;
  let embodiedVar = 0; // cumulative variable cost embodied per unit of this stage's output
  for (const stage of bp.stages) {
    const r = getRecipe(stage.recipeId);
    const out = stageOutput(stage);
    const perOut = r.outputs[0]!.quantity;
    // Variable cost this stage adds per output unit.
    const stageVarPerUnit = r.variableCost / perOut;
    // Embodied input cost per output unit (sum of inputs' embodied cost).
    let inputEmbodied = 0;
    for (const inp of r.inputs) inputEmbodied += (embodiedVar || 0) * (inp.quantity / perOut);
    // For the first stage inputs are none; for later stages use the running total.
    embodiedVar = (r.inputs.length === 0 ? 0 : embodiedVar * (r.inputs[0]!.quantity / perOut)) + stageVarPerUnit;
    const ref = getProduct(out).basePrice;
    console.log(
      `  ${stage.recipeId.padEnd(18)} -> ${out.padEnd(11)} embodiedVar=${money(Math.round(embodiedVar)).padStart(8)}  base=${money(ref).padStart(8)}  margin=${money(ref - Math.round(embodiedVar)).padStart(8)}`,
    );
    void inputEmbodied;
  }
}

function firmFacilities(state: GameState, firmId: string): Facility[] {
  return state.firms[firmId]!.facilities.map((fid) => state.facilities[fid]!);
}

/** Add a warehouse fed by `factory`'s output and export its surplus daily — the
 * documented "serve local + export the rest" logistics for a durable chain. */
function attachExportLeg(state: GameState, firmId: string, factory: Facility, productId: string): Facility {
  const wh = createFacility(state, 'warehouse', firmId, {
    x: factory.location.x + 2,
    y: factory.location.y + 2,
  });
  const cid = nextId(state.idCounters, 'ctr');
  state.contracts[cid] = {
    id: cid, ownerFirmId: firmId, sourceFacilityId: factory.id, destinationFacilityId: wh.id,
    productId, targetQuantity: 60, reorderPoint: 20, maxInventory: 300, transportCost: 0, active: true,
  };
  return wh;
}

function runSeed(seed: number): void {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'metropolis' });
  const supply0 = totalMoneySupply(state);
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  const tpd = ticksPerDay(state.config);
  const firmId = state.playerFirmId;

  // Ramp capital (conserved), then stand up two deep chains through the real
  // one-click wizard — exactly the player's path.
  recordTransaction(state, {
    from: WORLD_ACCOUNT, to: firmAccount(firmId), amount: 800_000,
    firmId, category: 'none', note: 'probe capital',
  });
  sim.dispatch({ type: 'BUILD_CHAIN', firmId, productId: 'appliances' });
  sim.dispatch({ type: 'BUILD_CHAIN', firmId, productId: 'furniture' });

  const facs = firmFacilities(state, firmId);
  const mine = facs.find((f) => f.activeRecipeId === 'mine_minerals')!;
  const steelMill = facs.find((f) => f.activeRecipeId === 'smelt_steel')!;
  const applianceFactory = facs.find((f) => f.activeRecipeId === 'forge_appliances')!;
  const applianceStore = facs.find((f) => f.retailProductIds.includes('appliances'))!;
  const plankMill = facs.find((f) => f.activeRecipeId === 'mill_planks')!;
  const furnitureFactory = facs.find((f) => f.activeRecipeId === 'assemble_furniture')!;

  // Managed logistics: warehouse + export leg on each finishing factory.
  const applWh = attachExportLeg(state, firmId, applianceFactory, 'appliances');
  const furnWh = attachExportLeg(state, firmId, furnitureFactory, 'furniture');

  const cash0 = state.firms[firmId]!.cash;
  let steelProduced = 0, steelShipped = 0, planksProduced = 0;
  let applianceRetail = 0, applianceExported = 0, furnitureExported = 0;

  const t0 = process.hrtime.bigint();
  for (let day = 1; day <= DAYS; day++) {
    sim.run(tpd);
    steelProduced += steelMill.yesterdayStats.unitsProduced;
    steelShipped += steelMill.yesterdayStats.unitsShipped;
    planksProduced += plankMill.yesterdayStats.unitsProduced;
    applianceRetail += applianceStore.yesterdayStats.unitsSold;
    // Export whatever the warehouses have accumulated.
    for (const [wh, pid] of [[applWh, 'appliances'], [furnWh, 'furniture']] as const) {
      const q = Math.floor((wh.inputInventory[pid]?.quantity ?? 0) + (wh.outputInventory[pid]?.quantity ?? 0));
      if (q >= 10) {
        sim.dispatch({ type: 'EXPORT_GOODS', firmId, facilityId: wh.id, productId: pid, quantity: q });
        if (pid === 'appliances') applianceExported += q; else furnitureExported += q;
      }
    }
  }
  const ns = Number(process.hrtime.bigint() - t0);
  const msPerTick = ns / 1e6 / (tpd * DAYS);
  const st = sim.getState();
  const cash1 = st.firms[firmId]!.cash;

  console.log(`\n===== seed ${seed} (metropolis, ${DAYS}d) =====`);
  console.log(`  (5) conserved=${totalMoneySupply(st) === supply0}  ms/tick=${msPerTick.toFixed(3)}`);
  console.log(`  (2) steel:  produced=${steelProduced}u shipped=${steelShipped}u (~${(steelProduced / DAYS).toFixed(1)}u/day) — FLOWS mine->steel->appliances`);
  console.log(`      planks: produced=${planksProduced}u (~${(planksProduced / DAYS).toFixed(1)}u/day) — FLOWS lumber->planks->furniture`);
  console.log(`  (4) appliances chain per-stage P&L (7d EMA net, cents/day):`);
  const stages: [string, Facility][] = [
    ['mine (minerals)', mine], ['factory (steel)', steelMill],
    ['factory (appliances)', applianceFactory], ['store (retail)', applianceStore],
  ];
  let chainNet = 0;
  for (const [label, f] of stages) {
    chainNet += f.pnlEma.net;
    console.log(`        ${label.padEnd(22)} net=${money(f.pnlEma.net).padStart(11)}  rev=${money(f.pnlEma.revenue).padStart(11)}  cost=${money(f.pnlEma.cost).padStart(10)}`);
  }
  console.log(`        ${'CHAIN P&L net'.padEnd(22)} ${money(chainNet).padStart(11)}/day`);
  console.log(`  (4) appliances retailed locally=${applianceRetail}u  exported=${applianceExported}u   furniture exported=${furnitureExported}u`);
  console.log(`      firm cash: ${money(cash0)} -> ${money(cash1)}  delta=${money(cash1 - cash0)}  (${cash1 > cash0 ? 'PROFITABLE' : 'LOSS'})`);
  const ai = Object.values(st.firms).filter((f) => f.ownerType === 'ai');
  console.log(`      AI field: firms=${ai.length} unhealthy=${ai.filter((f) => f.bankruptcyStatus !== 'healthy').length}`);
}

depthTable();
valueAddTable('appliances');
valueAddTable('furniture');
for (const seed of SEEDS) runSeed(seed);
