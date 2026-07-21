/**
 * AI-lease probe — the Arc D2 (HD4) follow-up: the repossession rung + the AI
 * operator's lease-vs-buy decision.
 *
 * WHY THIS IS A MECHANISM PROBE, NOT A STANDARD 300-DAY SOAK. The store/outlet
 * expansion path (`maybeExpand`) is SHORTAGE-GATED: an operator opens another
 * outlet only under sustained unmet demand for its product. In the founder-
 * driven City/Metropolis presets the AIFounderSystem backfills undersupply
 * before any operator's shortage gate trips, so `maybeExpand` never fires and
 * AI leasing is organically dormant (which is exactly why it is inert in every
 * pinned run — see docs/design/probes/real-estate.ts, where 300-day City/Metro
 * flag-on leases = 0). To MEASURE the lease-vs-buy rule and the repossession
 * rung we therefore construct the shortage the rule targets — a cash-tight
 * operator under a real product shortage with a landlord that can finance — and
 * drive the actual operator behavior across a day horizon.
 *
 * It measures, for City seeds 11/4/7, flag ON:
 *   (a) lease count — how many outlets an operator leases rather than buys;
 *   (b) landlord solvency — the lessor never goes insolvent fronting leases;
 *   (c) repossession — a leased tenant driven insolvent hands the premises back;
 *   (d) money conserved to the cent throughout;
 * and, flag OFF, the inertness chain: no landlord is ever seated, so the lessor
 * lookup finds nobody and not a single premises is ever leased.
 *
 * Runnable:  `npx tsx docs/design/probes/ai-lease.ts`  (DAYS / SEEDS overrides).
 */
import { Simulation } from '../../../src/sim/core/Simulation';
import { createInitialState } from '../../../src/sim/data/startingScenario';
import { DEFAULT_CONFIG } from '../../../src/sim/core/SimulationConfig';
import { ticksPerDay } from '../../../src/sim/core/Tick';
import { makeContext, totalMoneySupply } from '../../../src/sim/core/GameState';
import { createFacility } from '../../../src/sim/entities/factories';
import { maybeExpand } from '../../../src/sim/systems/ai/expansion';
import { runBankruptcySystem } from '../../../src/sim/systems/BankruptcySystem';
import { getFacilityDef } from '../../../src/sim/data/facilityDefinitions';
import { landCostMultiplier, landValueAt } from '../../../src/sim/core/LandValue';

const DAYS = Number(process.env.DAYS ?? 300);
const SEEDS = (process.env.SEEDS ?? '11,4,7').split(',').map(Number);
const PRODUCT = 'bread';

/** Flag ON: drive a cash-tight operator under a persistent shortage next to a
 * financing landlord, then repossess one lease by tipping a tenant insolvent. */
function runFlagOn(seed: number): void {
  const state = createInitialState(seed, {
    ...DEFAULT_CONFIG,
    sizePreset: 'city',
    realEstateEnabled: true,
    aiExpandChance: 1, // the shortage day always converts, for a clean count
  });
  const startMoney = totalMoneySupply(state);

  const ai = Object.values(state.firms).filter((f) => f.ownerType === 'ai');
  const op = ai[0]!;
  op.strategy.archetype = 'operator';
  op.facilities = [];
  const store = createFacility(state, 'retail', op.id, { x: 60, y: 52 });
  store.retailProductIds = [PRODUCT];
  const landlord = ai[1]!;
  landlord.strategy.archetype = 'landlord';
  landlord.cash = 60000_00;

  const cost = Math.round(
    getFacilityDef('retail').buildCost * landCostMultiplier(landValueAt(state, { x: 60, y: 52 })),
  );

  let conserved = true;
  // Day horizon: each day refresh the shortage + keep the operator tight (test
  // scaffolding is a direct cash write, so conservation is checked around each
  // behavior call — the lease path itself must neither mint nor burn a cent).
  for (let d = 0; d < DAYS && op.facilities.length < 3; d++) {
    const s0 = op.facilities.map((id) => state.facilities[id]!).find((f) => f.type === 'retail');
    if (s0) s0.dailyStats.lostSales = 20;
    state.marketStats[PRODUCT]!.unmetDemand = 30;
    op.cash = cost; // stay tight (< 2 × cost)
    const before = totalMoneySupply(state);
    maybeExpand(makeContext(state), op.id);
    if (totalMoneySupply(state) !== before) conserved = false;
  }

  const leased = op.facilities.filter((id) => state.facilities[id]!.landlordFirmId === landlord.id);
  const leaseCount = leased.length;

  // Repossession: pick one leased outlet, move it onto a throwaway tenant that
  // holds ONLY it, drive that tenant to the insolvent close-point, and run the
  // bankruptcy tick — the landlord must take the premises back.
  let repossessed = 0;
  if (leaseCount > 0) {
    const facId = leased[0]!;
    const fac = state.facilities[facId]!;
    const tenant = ai[2] ?? op;
    op.facilities = op.facilities.filter((id) => id !== facId);
    tenant.facilities = [facId]; // holds only the lease, so it is the close target
    fac.ownerFirmId = tenant.id;
    tenant.cash = -50000_00;
    tenant.daysInsolvent = state.config.insolvencyCloseDays - 1;
    tenant.sharesHeld = {};
    state.tick = ticksPerDay(state.config);
    const before = totalMoneySupply(state);
    runBankruptcySystem(makeContext(state));
    if (state.facilities[facId]?.ownerFirmId === landlord.id &&
        state.facilities[facId]?.landlordFirmId === undefined) repossessed = 1;
    if (totalMoneySupply(state) !== before) conserved = false; // repossession moves NO money
  }

  // `conserved` isolates the MECHANISM (each maybeExpand + the bankruptcy tick):
  // the direct cash writes above are test scaffolding, so the global supply is
  // expected to differ — what must hold is that the lease + repossession paths
  // never mint or burn a cent, checked around each call.
  console.log(
    `[city seed ${seed}] flag ON: leases=${leaseCount} landlord=${landlord.bankruptcyStatus} ` +
      `landlordCash=$${(landlord.cash / 100).toFixed(0)} repossessed=${repossessed} ` +
      `mechanism-conserved=${conserved ? 'EXACT' : 'DRIFT'}`,
  );
  void startMoney;
}

/** Flag OFF: the whole inertness chain — no landlord is ever seated, so nothing
 * is ever leased, across a full sim. */
function runFlagOff(seed: number): void {
  const state = createInitialState(seed, { ...DEFAULT_CONFIG, sizePreset: 'city' });
  const sim = new Simulation(state);
  sim.dispatch({ type: 'RESUME' });
  sim.run(ticksPerDay(state.config) * DAYS);
  const s = sim.getState();
  const landlords = Object.values(s.firms).filter((f) => f.strategy.archetype === 'landlord').length;
  const leased = Object.values(s.facilities).filter((f) => f.landlordFirmId !== undefined).length;
  console.log(`[city seed ${seed}] flag OFF: landlords=${landlords} leased=${leased} (chain inert)`);
}

for (const seed of SEEDS) runFlagOn(seed);
for (const seed of SEEDS) runFlagOff(seed);
