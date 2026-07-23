/**
 * Simulation.ts — the engine. Independent of React.
 *
 * Usage:
 *   const sim = new Simulation(createInitialState(seed));
 *   sim.dispatch({ type: 'RESUME' });
 *   sim.tick();                 // advance exactly one tick
 *   const state = sim.getState();
 *
 * The engine owns all rules. The UI only dispatches Commands and reads state.
 * Each tick advances the clock by one and runs every system in a fixed order
 * (daily roll-up systems first so the just-completed day is finalized before the
 * new day's per-tick systems run). Determinism comes entirely from the seeded
 * rng state carried inside GameState.
 */

import type { GameState, SimContext } from './GameState';
import { formatMoney } from '../../utils/formatMoney';
import { makeContext, emitEvent, recordTransaction, canAfford } from './GameState';
import type { Command } from './Commands';
import { nextId } from './Id';
import type { FirmId } from './Id';
import { firmAccount, WORLD_ACCOUNT } from './Transactions';
import { computeTime } from './Tick';
import { createInitialState } from '../data/startingScenario';
import { createFacility, createCitizen } from '../entities/factories';
import { Rng } from './Random';
import { townOf, HOME_TOWN_ID, sortedTownIds, type TownId } from './Town';
import { getFacilityDef } from '../data/facilityDefinitions';
import { getRecipe } from '../data/recipes';
import { getProduct, productAvailableInPreset } from '../data/products';
import { addStock, totalUnits } from '../entities/Inventory';
import {
  IMPORT_MARKUP,
  CENTS,
  RND_QUALITY_GAIN_PER_1000,
  LOAN_CREDIT_LIMIT_MULTIPLE,
  LOAN_MIN_CREDIT,
  FESTIVAL_COST,
  MAX_RETAIL_PRODUCTS,
  FUND_HOME_COST,
  IMMIGRANT_START_CASH,
  WIZARD_AD_BUDGET,
} from '../data/constants';
import { tradeShares } from './Shares';
import { worldImportMult } from '../data/worldEvents';
import { CHAIN_BLUEPRINTS, chainCost } from '../data/chains';
import { buildStarterChain } from './ChainBuilder';
import { performAcquisition } from './Acquisition';
import { upgradeFacility } from './Upgrades';
import { sellFacility } from './Demolition';
import { performExport, performCityPurchase, pickBestCity } from './Trade';
import { landCostMultiplier, landValueAt } from './LandValue';
import { commercialLeaseAsk } from '../systems/ai/LandlordBehavior';
import { placementBlocker } from './Placement';
import { WHOLESALE_MULT_MIN, WHOLESALE_MULT_MAX } from './Wholesale';
import type { Contract } from '../entities/Contract';
import { COMPUTE_SERVICE_ID } from '../data/services';
import {
  computeCapacity,
  computeSeatDemand,
  listedComputePrice,
} from '../systems/ServiceBillingSystem';

import { runTimeSystem } from '../systems/TimeSystem';
import { runWorldEventSystem } from '../systems/WorldEventSystem';
import { runTradeCitySystem } from '../systems/TradeCitySystem';
import { runRushOrderSystem } from '../systems/RushOrderSystem';
import { runFireSaleSystem } from '../systems/FireSaleSystem';
import { runTierSystem } from '../systems/TierSystem';
import { acceptFacilityOffer } from './FireSale';
import { runAchievementSystem } from '../systems/AchievementSystem';
import { runMissionSystem } from '../systems/MissionSystem';
import { runMarketStatsSystem } from '../systems/MarketStatsSystem';
import { runAIStrategySystem } from '../systems/AIStrategySystem';
import { runManagerSystem, managerCandidates } from '../systems/ManagerSystem';
import { runForwardSystem, sellForward, closeForward } from '../systems/ForwardSystem';
import { runFreightSystem } from '../systems/FreightSystem';
import { runTradeAnnouncementSystem } from '../systems/TradeAnnouncementSystem';
import { runEventLogSystem } from '../systems/EventLogSystem';
import { runBankruptcySystem } from '../systems/BankruptcySystem';
import { runMarketingSystem } from '../systems/MarketingSystem';
import { runFinanceSystem } from '../systems/FinanceSystem';
import { runDividendSystem } from '../systems/DividendSystem';
import { runImmigrationSystem } from '../systems/ImmigrationSystem';
import { runCastCuratorSystem } from '../systems/CastCuratorSystem';
import { runAIFounderSystem } from '../systems/AIFounderSystem';
import { runDistrictSystem } from '../systems/DistrictSystem';
import { runSatisfactionSystem } from '../systems/SatisfactionSystem';
import { runCohortSocialSystem } from '../systems/CohortSocialSystem';
import { runAccountingSystem } from '../systems/AccountingSystem';
import { runPayrollSystem } from '../systems/PayrollSystem';
import { runRentSystem } from '../systems/RentSystem';
import { runCrowdRentSystem } from '../systems/CrowdRentSystem';
import { runCommercialRentSystem } from '../systems/CommercialRentSystem';
import { runServiceBillingSystem } from '../systems/ServiceBillingSystem';
import { runTownStatsSystem } from '../systems/TownStatsSystem';
import { runCitizenScheduleSystem } from '../systems/CitizenScheduleSystem';
import { runMovementSystem } from '../systems/MovementSystem';
import { runLaborSystem, hireCitizen, fireCitizen, findUnemployed, trainCrew } from '../systems/LaborSystem';
import { runCohortLaborSystem } from '../systems/CohortLaborSystem';
import { runCohortDemandSystem } from '../systems/CohortDemandSystem';
import { runProductionSystem } from '../systems/ProductionSystem';
import { runLogisticsSystem } from '../systems/LogisticsSystem';
import { runRetailDemandSystem, runRestockRevisitSystem } from '../systems/RetailDemandSystem';

type SystemFn = (ctx: SimContext) => void;

/**
 * Fixed system order. Daily roll-ups run first (finalize the previous day),
 * then the per-tick simulation for the current tick.
 */
const SYSTEMS: SystemFn[] = [
  runTimeSystem,
  // --- daily roll-ups (each guards on the day boundary internally) ---
  runWorldEventSystem, // roll/expire world events first so the day sees them
  runTradeAnnouncementSystem, // roll/expire announced shocks (own rng stream)
  runTradeCitySystem, // Port Rosa price walk (daily; reads announcement mult)
  runForwardSystem, // settle due forwards right after prices land (no rng)
  runFreightSystem, // land + pay arrived inter-town freight (region.md s4/slice4; no rng; no-op flag-off)
  runRushOrderSystem, // rush offers/expiry after prices land (own rng stream)
  runFireSaleSystem, // rival fire-sale offers/expiry (own rng stream)
  runMarketStatsSystem, // finalize previous day's stats; hourly inventory totals
  runDistrictSystem, // daily district desirability cache (dark until A3 reads it)
  runAIStrategySystem, // AI reacts using the finalized day (sets ad/R&D/loans)
  runManagerSystem, // hired managers run their stores (after AI, same signals)
  runEventLogSystem, // player-facing alerts (before daily stats are reset)
  runMarketingSystem, // ad spend -> brand; brand decay (marketing expense)
  runFinanceSystem, // accrue loan interest
  runDividendSystem, // distribute completed day's profits to shareholders
  runBankruptcySystem,
  runSatisfactionSystem,
  runTierSystem, // prosperity ladder: derives tiers after satisfaction lands
  runCohortSocialSystem, // crowd satisfaction, tier mobility, migration (A3)
  runTownStatsSystem, // record daily town vitals after the satisfaction step
  runImmigrationSystem, // a prosperous town attracts new citizens
  runCastCuratorSystem, // keep the cast a faithful sample of the crowd (A3; cast arrivals land first)
  runAIFounderSystem, // ...and its unserved markets attract new rivals
  runRentSystem, // apartment rent (before accounting snapshots the day)
  runCrowdRentSystem, // crowd housing cost: the pool-drift sink + crowd-scale landlording (A3)
  runCommercialRentSystem, // commercial-lease rent: operator -> landlord, firm-to-firm (HD4; no-op until leased)
  runServiceBillingSystem, // B2B compute: firm-to-firm seat bills + coverage boost (HD3; city+ & flag)
  runAccountingSystem, // maintenance + snapshot + reset daily accumulators
  runPayrollSystem,
  // --- per-tick simulation ---
  runCitizenScheduleSystem,
  runMovementSystem,
  runLaborSystem,
  runCohortLaborSystem, // crowd fills remaining slots + counts as present (A3)
  runCohortDemandSystem, // crowd shops the shelves in shop-window slices (A3)
  runProductionSystem,
  runLogisticsSystem,
  runRetailDemandSystem,
  runRestockRevisitSystem, // cast restocked-shelf revisit (cast-parity #3; dark by default)
  runAchievementSystem, // hourly; sees the fully-updated tick
  runMissionSystem, // hourly; guided chain advances after achievements
];

/**
 * PARTNER_SYSTEMS — the light, cast-less subset a partner trade city runs each
 * tick (region.md step 4, slice 3; DISPATCH decision (c): TownScheduler with
 * per-town system lists). A partner (`port_rosa`) is a CROWD-ONLY town — no
 * simulated cast, no founders/rush/fire-sale, no player UI — so its schedule is
 * exactly the town-scoped economic core the crowd needs, and nothing else. Every
 * system here is TOWN-SCOPED (operates on `townOf(ctx.state, ctx.townId)`) and
 * draws ZERO shared rng, which is what keeps a flag-on home byte-identical to
 * flag-off: the partner's pass advances no rng and touches only its own records.
 *
 * Order MIRRORS the relative order these systems hold in `SYSTEMS` above (daily
 * roll-ups finalize the previous day before the per-tick sim runs), so the
 * partner's internal day boundary sequences exactly as home's does.
 *
 * The WORLD-scoped systems (time, world events, the trade-city price walk,
 * forwards, achievements, AI strategy, ...) are NOT in this list — they run
 * exactly ONCE, in home's full `SYSTEMS` pass, since the scheduler runs the full
 * list only for home. The clock is advanced once per tick (in `tick()`), not per
 * town.
 *
 * DELTA vs the design's named subset (region.md § "Which systems must run for
 * it"), documented with reasons:
 *   - SatisfactionSystem / TierSystem are EXCLUDED: both iterate the CAST
 *     (`town.citizens`) only — a crowd-only partner has an empty cast, so they
 *     are pure no-ops there (the crowd's satisfaction/tier machinery lives in
 *     CohortSocialSystem, not these). Running them would burn cycles for nothing.
 *   - CohortSocialSystem is EXCLUDED for slice 3: its tier-promotion CREATION
 *     sites (`moveMass` mints a new tier cohort) and its migration path are
 *     bare-`state` writers still pinned to the home town (region.md step 3 left
 *     them flat "until multi-town"), so running them for the partner would mint
 *     `port_rosa` cohorts into `towns.home` — a cross-town write leak. Threading
 *     those region-wide is the analogue of the money-primitive debt and is
 *     deferred (a follow-up slice), exactly the honest-scope discipline the arc
 *     uses. Consequence: the partner crowd stays a single `worker`-tier block
 *     (no tier mobility / migration) — sufficient for slice 3's acceptance
 *     (the crowd consumes, its firms produce, its book updates) and coherent.
 *   - LogisticsSystem is EXCLUDED: it iterates the WORLD-scoped `state.vehicles`
 *     / `state.contracts` and is paired with the cast-only MovementSystem (which
 *     marks vehicles 'delivered'); the partner mints no contracts (intra- and
 *     inter-town freight is slice 4's `FreightSystem`), so it would be a no-op at
 *     best and a cross-town vehicle-corruption risk at worst. The partner's
 *     production and retail are therefore SEEDED to run without a logistics
 *     linkage (its factory output and its retail shelf are stocked directly by
 *     the factory — freight connects the two economies in slice 4).
 */
const PARTNER_SYSTEMS: SystemFn[] = [
  runMarketStatsSystem, // finalize the partner's book; hourly inventory totals
  runDistrictSystem, // daily desirability cache for the partner's districts
  runCrowdRentSystem, // the crowd pays for a roof (pool-drift sink)
  runAccountingSystem, // maintenance + snapshot + reset daily accumulators
  runPayrollSystem, // wages: partner firms -> partner cohort; idle stipend
  runCohortLaborSystem, // crowd staffs the partner's factories + stores
  runCohortDemandSystem, // the crowd shops the partner's shelves
  runProductionSystem, // the partner's factories turn inputs + labor into output
];

/** The system list a town runs each tick. Home runs the full `SYSTEMS`
 * sequence (the bit-identity crux — flag-off, `sortedTownIds` is `['home']`, so
 * the scheduler runs exactly this list once, in exactly today's order); any
 * partner runs the light `PARTNER_SYSTEMS` subset. The schedule is DATA — one
 * reviewable table — per the DISPATCH decision (region.md step 4, § 2). */
function systemsForTown(townId: TownId): SystemFn[] {
  return townId === HOME_TOWN_ID ? SYSTEMS : PARTNER_SYSTEMS;
}

export class Simulation {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  getState(): GameState {
    return this.state;
  }

  /** Replace the entire state (used by load). */
  setState(state: GameState): void {
    this.state = state;
  }

  /** Advance the simulation by exactly one tick. */
  tick(): void {
    const start =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.state.tick += 1;
    // The TownScheduler (region.md step 4, slice 3): run each town's system list
    // in SORTED town order. Sorted order is the ONE new deterministic axis, and
    // home sorts first ('home' < 'port_rosa'), so home's rng draws land in
    // exactly today's position while a cast-less partner draws none. Flag off ⇒
    // `sortedTownIds` is `['home']`, so this loop runs exactly ONCE with
    // `makeContext(state, 'home')` (identity with the pre-scheduler
    // `makeContext(state)`) over the full `SYSTEMS` list — byte-identical to the
    // pre-region tick. Both towns draw from the single shared region rng stream
    // (`state.rngState` is world-scoped), so the schedule's town order IS the
    // draw order — which is why it lives in this one auditable place.
    for (const townId of sortedTownIds(this.state)) {
      const ctx = makeContext(this.state, townId);
      const systems = systemsForTown(townId);
      for (const system of systems) system(ctx);
    }

    const end =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const perf = this.state.perf;
    perf.lastTickMs = end - start;
    perf.ticksSimulated += 1;
    perf.avgTickMs =
      perf.avgTickMs === 0
        ? perf.lastTickMs
        : perf.avgTickMs * 0.95 + perf.lastTickMs * 0.05;
  }

  /** Run many ticks (used by drivers and tests). */
  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tick();
  }

  /** Apply a command. Meta commands (save/load) are handled by the caller. */
  dispatch(command: Command): void {
    const s = this.state;
    // Home-town view (identity in a one-town region, so the returned record is
    // the same reference); gains a `townId` param at the endgame move.
    const firms = townOf(s).firms;
    switch (command.type) {
      case 'START_NEW_GAME':
        this.state = createInitialState(command.seed);
        return;
      case 'LOAD_GAME':
      case 'SAVE_GAME':
        // Handled by the store/persistence layer.
        return;
      case 'PAUSE':
        s.paused = true;
        return;
      case 'RESUME':
        s.paused = false;
        return;
      case 'SET_SPEED':
        s.speed = command.speed;
        s.paused = command.speed === 0;
        return;
      case 'SELECT_ENTITY':
        s.selectedEntityId = command.entityId;
        return;
      case 'CREATE_COMPANY':
        this.createCompany(command.name, command.startingCash);
        return;
      case 'BUILD_FACILITY':
        this.buildFacility(command);
        return;
      case 'SELECT_RECIPE':
        this.selectRecipe(command);
        return;
      case 'SET_RETAIL_PRODUCT':
        this.setRetailProduct(command);
        return;
      case 'TOGGLE_RETAIL_PRODUCT':
        this.toggleRetailProduct(command);
        return;
      case 'SET_PRICE':
        this.setPrice(command);
        return;
      case 'SET_AUTO_PRICE': {
        const firm = firms[command.firmId];
        if (firm) firm.autoPriceByProduct[command.productId] = command.enabled;
        return;
      }
      case 'BUILD_CHAIN':
        this.buildChain(command.firmId, command.productId);
        return;
      case 'EXPORT_GOODS':
        this.exportGoods(command);
        return;
      case 'SET_EXPORT_ORDER': {
        const fac = townOf(s).facilities[command.facilityId];
        if (!fac || fac.type !== 'warehouse') return;
        if (command.minMult === null) {
          delete fac.exportOrders[command.productId];
        } else if (command.minMult > 0) {
          fac.exportOrders[command.productId] = {
            minMult: command.minMult,
            keep: Math.max(0, Math.round(command.keep)),
          };
        }
        return;
      }
      case 'UPGRADE_FACILITY':
        upgradeFacility(s, command.firmId, command.facilityId);
        return;
      case 'SELL_FACILITY':
        sellFacility(s, command.firmId, command.facilityId);
        return;
      case 'ACCEPT_FACILITY_OFFER':
        acceptFacilityOffer(s);
        return;
      case 'TRAIN_CREW':
        trainCrew(s, command.firmId, command.facilityId);
        return;
      case 'CIVIC_ACTION':
        this.civicAction(command.firmId, command.action);
        return;
      case 'SET_WAGE':
        this.setWage(command);
        return;
      case 'TOGGLE_WHOLESALE': {
        const fac = townOf(s).facilities[command.facilityId];
        if (fac) fac.wholesaleEnabled = command.enabled;
        return;
      }
      case 'SET_POSITIONING': {
        const fac = townOf(s).facilities[command.facilityId];
        if (fac && fac.type === 'retail') fac.positioning = command.positioning;
        return;
      }
      case 'HIRE_MANAGER': {
        const firm = firms[command.firmId];
        if (!firm) return;
        const role = command.role ?? 'store';
        const day = computeTime(s.tick, s.config).day;
        const cand = managerCandidates(s, day, role)[command.candidateIndex];
        if (!cand) return;
        let facilityId: string | null = null;
        let where = `${firm.name}'s ${role} desk`;
        if (role === 'store') {
          const fac = command.facilityId ? townOf(s).facilities[command.facilityId] : undefined;
          if (!fac || fac.type !== 'retail' || fac.ownerFirmId !== command.firmId) return;
          if (firm.managers.some((m) => m.role === 'store' && m.facilityId === fac.id)) return;
          facilityId = fac.id;
          where = fac.name;
        } else if (firm.managers.some((m) => m.role === role)) {
          return; // one firm-wide manager per role
        }
        firm.managers.push({
          id: nextId(s.idCounters, 'mgr'),
          name: cand.name,
          role,
          skill: cand.skill,
          salaryPerDay: cand.salaryPerDay,
          facilityId,
          hiredAtTick: s.tick,
        });
        emitEvent(s, 'success', 'player',
          `🤝 ${cand.name} signed on to run ${where} (${formatMoney(cand.salaryPerDay)}/day).`, facilityId ?? command.firmId);
        return;
      }
      case 'SELL_FORWARD':
        sellForward(
          s, command.firmId, command.productId, command.quantity,
          command.cityId, command.deliveryDay, computeTime(s.tick, s.config).day,
        );
        return;
      case 'CLOSE_FORWARD':
        closeForward(s, command.firmId, command.forwardId);
        return;
      case 'BUY_FROM_CITY':
        performCityPurchase(
          s, command.firmId, command.facilityId, command.productId,
          command.quantity, command.cityId,
        );
        return;
      case 'FIRE_MANAGER': {
        const firm = firms[command.firmId];
        if (!firm) return;
        const mgr = firm.managers.find((m) => m.id === command.managerId);
        if (!mgr) return;
        firm.managers = firm.managers.filter((m) => m.id !== command.managerId);
        const post = mgr.facilityId
          ? (townOf(s).facilities[mgr.facilityId]?.name ?? 'their store')
          : `the ${mgr.role} desk`;
        emitEvent(s, 'info', 'player',
          `${mgr.name} was let go from ${post}.`, mgr.facilityId ?? command.firmId);
        return;
      }
      case 'SET_WHOLESALE_PRICE': {
        const fac = townOf(s).facilities[command.facilityId];
        if (!fac || !Number.isFinite(command.mult)) return;
        fac.wholesalePriceMult =
          Math.round(Math.min(WHOLESALE_MULT_MAX, Math.max(WHOLESALE_MULT_MIN, command.mult)) * 100) / 100;
        return;
      }
      case 'HIRE_WORKER':
        this.hire(command);
        return;
      case 'FIRE_WORKER':
        fireCitizen(s, command.facilityId, command.citizenId);
        return;
      case 'CREATE_SUPPLY_CONTRACT':
        this.createContract(command);
        return;
      case 'CANCEL_SUPPLY_CONTRACT':
        delete s.contracts[command.contractId];
        return;
      case 'UPDATE_SUPPLY_CONTRACT': {
        const ctr = s.contracts[command.contractId];
        if (!ctr) return;
        if (command.targetQuantity !== undefined && command.targetQuantity > 0) {
          ctr.targetQuantity = Math.round(command.targetQuantity);
        }
        if (command.reorderPoint !== undefined && command.reorderPoint >= 0) {
          ctr.reorderPoint = Math.round(command.reorderPoint);
        }
        if (command.maxInventory !== undefined && command.maxInventory > 0) {
          ctr.maxInventory = Math.round(command.maxInventory);
        }
        if (command.active !== undefined) ctr.active = command.active;
        return;
      }
      case 'BUY_FROM_IMPORTER':
        this.buyFromImporter(command);
        return;
      case 'SET_AD_BUDGET': {
        const firm = firms[command.firmId];
        if (firm && command.dailyBudget >= 0) {
          firm.adBudgetByProduct[command.productId] = Math.round(command.dailyBudget);
        }
        return;
      }
      case 'INVEST_RND':
        this.investRnd(command);
        return;
      case 'TAKE_LOAN':
        this.takeLoan(command);
        return;
      case 'REPAY_LOAN':
        this.repayLoan(command);
        return;
      case 'ACQUIRE_FIRM':
        performAcquisition(s, command.firmId, command.targetFirmId);
        return;
      case 'BUY_SHARES':
        tradeShares(s, command.firmId, command.targetFirmId, command.percent);
        return;
      case 'SELL_SHARES':
        tradeShares(s, command.firmId, command.targetFirmId, -command.percent);
        return;
      case 'SUBSCRIBE_SERVICE':
        this.subscribeService(command.firmId, command.providerFirmId);
        return;
      case 'CANCEL_SERVICE': {
        for (const cid of Object.keys(s.serviceContracts)) {
          if (s.serviceContracts[cid]!.subscriberFirmId === command.firmId) {
            delete s.serviceContracts[cid];
          }
        }
        return;
      }
    }
  }

  /**
   * Player-side compute subscription. Reserves the firm's seat demand (capped by
   * the provider's free capacity) at the provider's current listed price. The
   * daily ServiceBillingSystem then bills, reprices, and grants coverage boost
   * exactly as it does for AI subscribers. No-op unless the services channel is
   * live and the named provider actually runs a datacenter with room.
   */
  private subscribeService(firmId: FirmId, providerFirmId: FirmId): void {
    const s = this.state;
    if (!s.config.servicesEnabled || s.config.sizePreset === 'village') return;
    const firms = townOf(s).firms;
    const firm = firms[firmId];
    const provider = firms[providerFirmId];
    if (!firm || !provider || firmId === providerFirmId) return;
    const capacity = computeCapacity(s, provider);
    if (capacity <= 0) return;
    let sold = 0;
    for (const cid in s.serviceContracts) {
      const c = s.serviceContracts[cid]!;
      if (c.subscriberFirmId === firmId) return; // already subscribed
      if (c.providerFirmId === providerFirmId) sold += c.seats;
    }
    const desired = computeSeatDemand(firm);
    const seats = Math.min(desired, capacity - sold);
    if (seats <= 0) {
      emitEvent(s, 'warning', 'player', `${provider.name} has no free compute seats right now.`, firmId);
      return;
    }
    const price = listedComputePrice(provider);
    const id = nextId(s.idCounters, 'svc');
    s.serviceContracts[id] = {
      id,
      providerFirmId,
      subscriberFirmId: firmId,
      serviceId: COMPUTE_SERVICE_ID,
      seats,
      pricePerSeatDay: price,
    };
    emitEvent(s, 'success', 'player',
      `Subscribed to ${provider.name} compute — ${seats} seats at ${formatMoney(price)}/seat/day.`, firmId);
  }

  /**
   * Chain wizard: build producer → factory → store for a consumer product in
   * one command, wire the two supply contracts, staff every stage from the
   * unemployed pool, select recipes, and seed the retail price. Deterministic
   * placement scans fixed rows for clear ground.
   */
  private buildChain(firmId: FirmId, productId: string): void {
    const s = this.state;
    const firm = townOf(s).firms[firmId];
    const bp = CHAIN_BLUEPRINTS[productId];
    if (!firm || !bp) return;
    // C1: the wizard only builds chains whose product exists at this preset —
    // the breadth chains (meals/shoes/furniture/appliances/wine) are city-only.
    if (!productAvailableInPreset(productId, s.config.sizePreset)) return;

    // Wizard placements sit in mid-value rows; budget for a modest premium.
    const cost = Math.round(chainCost(bp) * 1.2);
    if (!canAfford(s, firmAccount(firmId), cost)) {
      emitEvent(s, 'danger', 'player', `A full ${getProduct(bp.productId).name} chain costs about ${formatMoney(cost)} — not enough cash.`, firmId);
      return;
    }

    const built = buildStarterChain(s, firmId, productId);
    if (!built) {
      emitEvent(s, 'warning', 'player', 'No clear ground for a full chain — build the stages manually.', firmId);
      return;
    }
    const { store } = built;

    // Entering a market where an incumbent has brand and loyal customers takes
    // penetration pricing AND advertising — the AI's own playbook. Default
    // both on so the wizard hands over a running, self-managing business.
    // NOTE a lone single-product chain is structurally sub-scale (measured:
    // it needs ~60% market share to cover a 5-person wage bill) — the wizard
    // is the launchpad; the game's real arc is adding products to the store,
    // sourcing wholesale, and exporting. Either default is one toggle to undo.
    if (firm.autoPriceByProduct[bp.productId] === undefined) {
      firm.autoPriceByProduct[bp.productId] = true;
    }
    if (!firm.adBudgetByProduct[bp.productId]) {
      firm.adBudgetByProduct[bp.productId] = WIZARD_AD_BUDGET;
    }

    // Name every stage in order (deep C3 chains have an intermediate factory
    // between the producer and the finishing factory), then the store.
    const chainPath = [...built.stages.map((f) => f.name), store.name].join(' → ');
    emitEvent(s, 'success', 'player',
      `🪄 Built a full ${getProduct(bp.productId).name} chain: ${chainPath} — wired, staffed, auto-priced, and advertised. Tune any of it in the store inspector.`,
      store.id);
  }

  /**
   * Export goods staged in a warehouse to Port Rosa at the trade city's
   * current price minus the freight fee. Revenue arrives from the world
   * account (Port Rosa is off-map), so money stays conserved.
   */
  private exportGoods(command: Extract<Command, { type: 'EXPORT_GOODS' }>): void {
    const s = this.state;
    const fac = townOf(s).facilities[command.facilityId];
    if (fac && fac.type !== 'warehouse') {
      emitEvent(s, 'warning', 'logistics', 'Exports ship from warehouses — stage goods there first.', fac.id);
      return;
    }
    const cityId = command.cityId ?? pickBestCity(s, command.productId).cityId;
    performExport(s, command.firmId, command.facilityId, command.productId, command.quantity, 'Exported', cityId);
  }

  /**
   * Civic actions: spend money on the town itself.
   *  - festival: 3 days of boosted demand/spending (a command-started world
   *    event; never rolls naturally).
   *  - fund_home: build a home and move two new citizens in immediately,
   *    bypassing the immigration gate (but not the hard caps).
   */
  private civicAction(firmId: FirmId, action: 'festival' | 'fund_home'): void {
    const s = this.state;
    const firm = townOf(s).firms[firmId];
    if (!firm) return;
    const day = Math.floor(s.tick / (s.config.ticksPerHour * 24));

    if (action === 'festival') {
      if (s.worldEvents.some((ev) => ev.defId === 'festival')) {
        emitEvent(s, 'warning', 'player', 'The festival is already running.', firmId);
        return;
      }
      if (!canAfford(s, firmAccount(firmId), FESTIVAL_COST)) {
        emitEvent(s, 'danger', 'player', `Sponsoring the festival costs ${formatMoney(FESTIVAL_COST)}.`, firmId);
        return;
      }
      recordTransaction(s, {
        from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: FESTIVAL_COST,
        firmId, category: 'marketing', note: 'Sponsored the town festival',
      });
      s.worldEvents.push({ defId: 'festival', startDay: day, endDay: day + 3 });
      emitEvent(s, 'success', 'economy',
        `🎪 ${firm.name} sponsors a three-day town festival — crowds pour into the shops!`, firmId);
      return;
    }

    // fund_home
    const citizens = Object.keys(townOf(s).citizens).length;
    const facilities = townOf(s).facilities;
    const homes = Object.values(facilities).filter((f) => f.type === 'home').length;
    if (citizens >= s.config.maxCitizens || homes >= s.config.maxHomes) {
      emitEvent(s, 'warning', 'player', 'The town is at capacity — no room for another home.', firmId);
      return;
    }
    if (!canAfford(s, firmAccount(firmId), FUND_HOME_COST)) {
      emitEvent(s, 'danger', 'player', `Funding a home costs ${formatMoney(FUND_HOME_COST)}.`, firmId);
      return;
    }
    // Deterministic placement: scan the residential band for clear ground.
    // Map bounds are town-scoped, hoisted out of the scan loop (home-town view,
    // identity in a one-town region); gains a real per-town map at the endgame.
    const town = townOf(s);
    let loc: { x: number; y: number } | null = null;
    for (let y = 60; y <= town.mapHeight - 4 && !loc; y += 8) {
      for (let x = 14; x <= town.mapWidth - 8; x += 6) {
        let clear = true;
        for (const fid in facilities) {
          const l = facilities[fid]!.location;
          const dx = l.x - x, dy = l.y - y;
          if (dx * dx + dy * dy < 30) { clear = false; break; }
        }
        if (clear) { loc = { x, y }; break; }
      }
    }
    if (!loc) {
      emitEvent(s, 'warning', 'player', 'No clear residential ground for a new home.', firmId);
      return;
    }
    recordTransaction(s, {
      from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: FUND_HOME_COST,
      firmId, category: 'buildSpend', note: 'Funded a new home',
    });
    const home = createFacility(s, 'home', s.worldFirmId, loc, { name: `Home ${homes + 1}` });
    const rng = new Rng(s);
    for (let i = 0; i < 2 && Object.keys(townOf(s).citizens).length < s.config.maxCitizens; i++) {
      const cit = createCitizen(s, rng, home.id);
      recordTransaction(s, {
        from: WORLD_ACCOUNT, to: { kind: 'citizen', id: cit.id }, amount: IMMIGRANT_START_CASH,
        firmId: null, category: 'none', note: 'New arrival settling in',
      });
    }
    emitEvent(s, 'success', 'economy',
      `🏡 ${firm.name} funded ${home.name} — two new citizens moved to town.`, home.id);
  }

  /** Net worth used for credit limits: cash + inventory value. */
  private netWorth(firmId: FirmId): number {
    // Home-town view (identity in a one-town region, so the returned record is
    // the same reference); gains a `townId` param at the endgame move.
    const firm = townOf(this.state).firms[firmId];
    if (!firm) return 0;
    let inv = 0;
    for (const facId of firm.facilities) {
      const fac = townOf(this.state).facilities[facId];
      if (!fac) continue;
      for (const bag of [fac.inputInventory, fac.outputInventory]) {
        for (const pid in bag) inv += bag[pid]!.quantity * getProduct(pid).basePrice;
      }
    }
    return firm.cash + inv;
  }

  private investRnd(command: Extract<Command, { type: 'INVEST_RND' }>): void {
    const s = this.state;
    const firm = townOf(s).firms[command.firmId];
    if (!firm || command.amount <= 0) return;
    if (!canAfford(s, firmAccount(firm.id), command.amount)) {
      emitEvent(s, 'danger', 'player', 'Not enough cash for R&D.', firm.id);
      return;
    }
    recordTransaction(s, {
      from: firmAccount(firm.id),
      to: WORLD_ACCOUNT,
      amount: command.amount,
      firmId: firm.id,
      category: 'rnd',
      productId: command.productId,
      note: 'R&D investment',
    });
    const product = getProduct(command.productId);
    const cur = firm.qualityByProduct[command.productId] ?? product.defaultQuality;
    const headroom = (100 - cur) / 100;
    const gain = RND_QUALITY_GAIN_PER_1000 * (command.amount / (1000 * CENTS)) * headroom;
    firm.qualityByProduct[command.productId] = Math.min(100, cur + gain);
    emitEvent(s, 'success', 'player', `R&D improved ${product.name} quality to ${Math.round(firm.qualityByProduct[command.productId]!)}.`, firm.id);
  }

  private takeLoan(command: Extract<Command, { type: 'TAKE_LOAN' }>): void {
    const s = this.state;
    const firm = townOf(s).firms[command.firmId];
    if (!firm || command.amount <= 0) return;
    const limit = Math.max(LOAN_MIN_CREDIT, Math.round(this.netWorth(firm.id) * LOAN_CREDIT_LIMIT_MULTIPLE));
    const available = limit - firm.debt;
    const amount = Math.min(Math.round(command.amount), available);
    if (amount <= 0) {
      emitEvent(s, 'warning', 'finance', 'Credit limit reached — cannot borrow more.', firm.id);
      return;
    }
    firm.debt += amount;
    recordTransaction(s, {
      from: WORLD_ACCOUNT,
      to: firmAccount(firm.id),
      amount,
      firmId: firm.id,
      category: 'loanDraw',
      note: 'Loan drawdown',
    });
    emitEvent(s, 'success', 'finance', `Borrowed ${formatMoney(amount)}. Total debt ${formatMoney(firm.debt)}.`, firm.id);
  }

  private repayLoan(command: Extract<Command, { type: 'REPAY_LOAN' }>): void {
    const s = this.state;
    const firm = townOf(s).firms[command.firmId];
    if (!firm || command.amount <= 0 || firm.debt <= 0) return;
    const amount = Math.min(Math.round(command.amount), firm.debt, Math.max(0, firm.cash));
    if (amount <= 0) return;
    firm.debt -= amount;
    recordTransaction(s, {
      from: firmAccount(firm.id),
      to: WORLD_ACCOUNT,
      amount,
      firmId: firm.id,
      category: 'loanRepay',
      note: 'Loan repayment',
    });
    emitEvent(s, 'info', 'finance', `Repaid ${formatMoney(amount)}. Remaining debt ${formatMoney(firm.debt)}.`, firm.id);
  }

  // ---- command handlers -------------------------------------------------

  private createCompany(name: string, startingCash: number): void {
    const firm = townOf(this.state).firms[this.state.playerFirmId];
    if (!firm) return;
    firm.name = name;
    if (startingCash > firm.cash) {
      recordTransaction(this.state, {
        from: WORLD_ACCOUNT,
        to: firmAccount(firm.id),
        amount: startingCash - firm.cash,
        firmId: firm.id,
        category: 'none',
        note: 'Founder capital',
      });
    }
    emitEvent(this.state, 'success', 'player', `Founded ${name}.`, firm.id);
  }

  private buildFacility(
    command: Extract<Command, { type: 'BUILD_FACILITY' }>,
  ): void {
    const s = this.state;
    const firms = townOf(s).firms;
    const firm = firms[command.firmId];
    if (!firm) return;
    const def = getFacilityDef(command.defId);
    // The service facilities (datacenter, office) are city-scale only and gated on
    // the services flag — never buildable in a Village (they aren't in the Village
    // build menu either).
    if ((def.type === 'datacenter' || def.type === 'office')
      && (!s.config.servicesEnabled || s.config.sizePreset === 'village')) {
      emitEvent(s, 'warning', 'player', 'Service facilities need the city-scale services channel.', firm.id);
      return;
    }
    const blocker = placementBlocker(s, command.location);
    if (blocker) {
      emitEvent(s, 'warning', 'player', `Too close to ${blocker.name} — pick clearer ground.`, firm.id);
      return;
    }
    // Location economics: pricier ground (and rent) near the homes.
    const mult = landCostMultiplier(landValueAt(s, command.location));
    const cost = Math.round(def.buildCost * mult);

    // Lease path (HD4): a landlord firm fronts the build cost, the builder pays
    // $0 upfront and operates the premises for a daily rent. "Lease for $X/day
    // instead of $Y upfront."
    if (command.leaseFrom !== undefined) {
      // SELF-LEASE BLOCK: a firm can never lease its own premises from itself
      // (it would pay itself rent — money to nowhere).
      if (command.leaseFrom === firm.id) {
        emitEvent(s, 'warning', 'player', 'A firm cannot lease premises from itself.', firm.id);
        return;
      }
      const landlord = firms[command.leaseFrom];
      if (!landlord || (landlord.ownerType !== 'ai' && landlord.ownerType !== 'player')) {
        emitEvent(s, 'warning', 'player', 'No such landlord to lease from.', firm.id);
        return;
      }
      if (!canAfford(s, firmAccount(landlord.id), cost)) {
        emitEvent(s, 'warning', 'player', `${landlord.name} can't finance this premises right now.`, firm.id);
        return;
      }
      const fac = createFacility(s, command.defId, firm.id, command.location);
      fac.buildCost = cost; // book value the landlord carries (yield basis)
      fac.operatingCostPerDay = Math.round(def.maintenanceCostPerDay * mult);
      fac.landlordFirmId = landlord.id;
      fac.rentPerDay = commercialLeaseAsk(cost);
      // The LANDLORD fronts the construction capital (it carries the asset).
      recordTransaction(s, {
        from: firmAccount(landlord.id),
        to: WORLD_ACCOUNT,
        amount: cost,
        firmId: landlord.id,
        category: 'buildSpend',
        note: `Financed ${fac.name} for lease`,
      });
      emitEvent(s, 'success', 'player',
        `Leased ${fac.name} from ${landlord.name} — ${formatMoney(fac.rentPerDay)}/day instead of ${formatMoney(cost)} upfront.`,
        fac.id);
      return;
    }

    if (!canAfford(s, firmAccount(firm.id), cost)) {
      emitEvent(s, 'danger', 'player', `Cannot afford to build ${def.name} here (${formatMoney(cost)} with land premium).`, firm.id);
      return;
    }
    const fac = createFacility(s, command.defId, firm.id, command.location);
    fac.buildCost = cost;
    fac.operatingCostPerDay = Math.round(def.maintenanceCostPerDay * mult);
    if (cost > 0) {
      recordTransaction(s, {
        from: firmAccount(firm.id),
        to: WORLD_ACCOUNT,
        amount: cost,
        firmId: firm.id,
        category: 'buildSpend',
        note: `Built ${def.name}`,
      });
    }
    const pct = Math.round((mult - 1) * 100);
    emitEvent(s, 'success', 'player',
      `Built ${fac.name}${pct !== 0 ? ` (land ${pct > 0 ? '+' : ''}${pct}% → rent ${formatMoney(fac.operatingCostPerDay)}/day)` : ''}.`,
      fac.id);
  }

  private selectRecipe(
    command: Extract<Command, { type: 'SELECT_RECIPE' }>,
  ): void {
    const fac = townOf(this.state).facilities[command.facilityId];
    if (!fac) return;
    if (command.recipeId !== null && !fac.recipes.includes(command.recipeId)) return;
    fac.activeRecipeId = command.recipeId;
    fac.productionProgress = 0;
    if (command.recipeId) {
      const r = getRecipe(command.recipeId);
      emitEvent(this.state, 'info', 'player', `${fac.name} now runs: ${r.name}.`, fac.id);
    }
  }

  private setRetailProduct(
    command: Extract<Command, { type: 'SET_RETAIL_PRODUCT' }>,
  ): void {
    const fac = townOf(this.state).facilities[command.facilityId];
    if (!fac || fac.type !== 'retail') return;
    const def = getFacilityDef(fac.defId);
    if (command.productId !== null && !def.allowedProductsForSale.includes(command.productId)) {
      return;
    }
    // C1: a store can only stock products that exist at this preset (a Village
    // store can never shelve a city-only breadth product).
    if (command.productId !== null && !productAvailableInPreset(command.productId, this.state.config.sizePreset)) {
      return;
    }
    // Legacy single-product semantics: replace the whole assortment.
    fac.retailProductIds = command.productId ? [command.productId] : [];
    if (command.productId) this.seedDefaultPrice(fac.ownerFirmId, command.productId);
  }

  /** Add/remove a product from a store's assortment (max MAX_RETAIL_PRODUCTS). */
  private toggleRetailProduct(
    command: Extract<Command, { type: 'TOGGLE_RETAIL_PRODUCT' }>,
  ): void {
    const fac = townOf(this.state).facilities[command.facilityId];
    if (!fac || fac.type !== 'retail') return;
    const def = getFacilityDef(fac.defId);
    if (!def.allowedProductsForSale.includes(command.productId)) return;
    if (!productAvailableInPreset(command.productId, this.state.config.sizePreset)) return;
    const idx = fac.retailProductIds.indexOf(command.productId);
    if (idx >= 0) {
      fac.retailProductIds.splice(idx, 1);
      return;
    }
    if (fac.retailProductIds.length >= MAX_RETAIL_PRODUCTS) {
      emitEvent(this.state, 'warning', 'player',
        `A store can carry at most ${MAX_RETAIL_PRODUCTS} products.`, fac.id);
      return;
    }
    fac.retailProductIds.push(command.productId);
    this.seedDefaultPrice(fac.ownerFirmId, command.productId);
  }

  private seedDefaultPrice(firmId: FirmId, productId: string): void {
    const firm = townOf(this.state).firms[firmId];
    if (firm && !firm.pricesByProduct[productId]) {
      firm.pricesByProduct[productId] = getProduct(productId).basePrice;
    }
  }

  private setPrice(command: Extract<Command, { type: 'SET_PRICE' }>): void {
    const firm = townOf(this.state).firms[command.firmId];
    if (!firm || command.price <= 0) return;
    firm.pricesByProduct[command.productId] = Math.round(command.price);
  }

  private setWage(command: Extract<Command, { type: 'SET_WAGE' }>): void {
    const firm = townOf(this.state).firms[command.firmId];
    if (!firm || command.wage < 0) return;
    firm.wagePolicy.baseWage = Math.round(command.wage);
    for (const cid of firm.employees) {
      const cit = townOf(this.state).citizens[cid];
      if (cit) cit.wage = firm.wagePolicy.baseWage;
    }
  }

  private hire(command: Extract<Command, { type: 'HIRE_WORKER' }>): void {
    const s = this.state;
    const citizenId = command.citizenId ?? findUnemployed(s);
    if (!citizenId) {
      emitEvent(s, 'warning', 'player', 'No unemployed citizens available to hire.');
      return;
    }
    const ok = hireCitizen(s, command.facilityId, citizenId);
    const fac = townOf(s).facilities[command.facilityId];
    if (ok && fac) {
      const cit = townOf(s).citizens[citizenId];
      emitEvent(s, 'success', 'player', `Hired ${cit?.name ?? citizenId} at ${fac.name}.`, fac.id);
    } else if (fac) {
      emitEvent(s, 'warning', 'player', `Could not hire at ${fac.name} (full or invalid).`, fac.id);
    }
  }

  private createContract(
    command: Extract<Command, { type: 'CREATE_SUPPLY_CONTRACT' }>,
  ): void {
    const s = this.state;
    const source = townOf(s).facilities[command.sourceFacilityId];
    const dest = townOf(s).facilities[command.destinationFacilityId];
    if (!source || !dest) return;
    const id = nextId(s.idCounters, 'ctr');
    const contract: Contract = {
      id,
      ownerFirmId: command.ownerFirmId,
      sourceFacilityId: command.sourceFacilityId,
      destinationFacilityId: command.destinationFacilityId,
      productId: command.productId,
      targetQuantity: command.targetQuantity,
      reorderPoint: command.reorderPoint,
      maxInventory: command.maxInventory,
      transportCost: 0,
      active: true,
    };
    s.contracts[id] = contract;
    emitEvent(
      s,
      'success',
      'logistics',
      `Supply contract created: ${source.name} → ${dest.name} (${getProduct(command.productId).name}).`,
      dest.id,
    );
  }

  private buyFromImporter(
    command: Extract<Command, { type: 'BUY_FROM_IMPORTER' }>,
  ): void {
    const s = this.state;
    const firms = townOf(s).firms;
    const firm = firms[command.firmId];
    const dest = townOf(s).facilities[command.destinationFacilityId];
    if (!firm || !dest) return;
    const product = getProduct(command.productId);
    const importer = Object.values(firms).find((f) => f.ownerType === 'external');
    const unitPrice = Math.round(product.basePrice * IMPORT_MARKUP * worldImportMult(s));
    const room = dest.storageCapacity - totalUnits(dest.inputInventory);
    const qty = Math.min(command.quantity, Math.max(0, room));
    if (qty <= 0) return;
    const cost = unitPrice * qty;
    if (!canAfford(s, firmAccount(firm.id), cost)) {
      emitEvent(s, 'danger', 'player', `Cannot afford to import ${qty} ${product.name}.`, firm.id);
      return;
    }
    recordTransaction(s, {
      from: firmAccount(firm.id),
      to: importer ? firmAccount(importer.id) : WORLD_ACCOUNT,
      amount: cost,
      firmId: firm.id,
      category: 'importPurchase',
      productId: command.productId,
      quantity: qty,
      note: `Imported ${qty} ${product.name}`,
    });
    addStock(dest.inputInventory, command.productId, qty, product.defaultQuality);
    emitEvent(s, 'success', 'logistics', `Imported ${qty} ${product.name} to ${dest.name}.`, dest.id);
  }
}
