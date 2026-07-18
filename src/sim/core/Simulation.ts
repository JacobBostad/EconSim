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
import { getFacilityDef } from '../data/facilityDefinitions';
import { getRecipe } from '../data/recipes';
import { getProduct } from '../data/products';
import { addStock, totalUnits } from '../entities/Inventory';
import {
  IMPORT_MARKUP,
  CENTS,
  RND_QUALITY_GAIN_PER_1000,
  LOAN_CREDIT_LIMIT_MULTIPLE,
  LOAN_MIN_CREDIT,
  MAX_STAKE_PCT,
  FESTIVAL_COST,
  MAX_RETAIL_PRODUCTS,
  FUND_HOME_COST,
  IMMIGRANT_START_CASH,
  WIZARD_AD_BUDGET,
} from '../data/constants';
import { companyValuation } from '../selectors/companySelectors';
import { worldImportMult } from '../data/worldEvents';
import { CHAIN_BLUEPRINTS, chainCost } from '../data/chains';
import { performAcquisition } from './Acquisition';
import { upgradeFacility } from './Upgrades';
import { sellFacility } from './Demolition';
import { performExport, performCityPurchase, pickBestCity } from './Trade';
import { landCostMultiplier, landValueAt } from './LandValue';
import { placementBlocker } from './Placement';
import { WHOLESALE_MULT_MIN, WHOLESALE_MULT_MAX } from './Wholesale';
import type { Contract } from '../entities/Contract';

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
import { runForwardSystem, sellForward } from '../systems/ForwardSystem';
import { runTradeAnnouncementSystem } from '../systems/TradeAnnouncementSystem';
import { runEventLogSystem } from '../systems/EventLogSystem';
import { runBankruptcySystem } from '../systems/BankruptcySystem';
import { runMarketingSystem } from '../systems/MarketingSystem';
import { runFinanceSystem } from '../systems/FinanceSystem';
import { runDividendSystem } from '../systems/DividendSystem';
import { runImmigrationSystem } from '../systems/ImmigrationSystem';
import { runSatisfactionSystem } from '../systems/SatisfactionSystem';
import { runAccountingSystem } from '../systems/AccountingSystem';
import { runPayrollSystem } from '../systems/PayrollSystem';
import { runRentSystem } from '../systems/RentSystem';
import { runTownStatsSystem } from '../systems/TownStatsSystem';
import { runCitizenScheduleSystem } from '../systems/CitizenScheduleSystem';
import { runMovementSystem } from '../systems/MovementSystem';
import { runLaborSystem, hireCitizen, fireCitizen, findUnemployed, trainCrew } from '../systems/LaborSystem';
import { runProductionSystem } from '../systems/ProductionSystem';
import { runLogisticsSystem } from '../systems/LogisticsSystem';
import { runRetailDemandSystem } from '../systems/RetailDemandSystem';

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
  runRushOrderSystem, // rush offers/expiry after prices land (own rng stream)
  runFireSaleSystem, // rival fire-sale offers/expiry (own rng stream)
  runMarketStatsSystem, // finalize previous day's stats; hourly inventory totals
  runAIStrategySystem, // AI reacts using the finalized day (sets ad/R&D/loans)
  runManagerSystem, // hired managers run their stores (after AI, same signals)
  runEventLogSystem, // player-facing alerts (before daily stats are reset)
  runMarketingSystem, // ad spend -> brand; brand decay (marketing expense)
  runFinanceSystem, // accrue loan interest
  runDividendSystem, // distribute completed day's profits to shareholders
  runBankruptcySystem,
  runSatisfactionSystem,
  runTierSystem, // prosperity ladder: derives tiers after satisfaction lands
  runTownStatsSystem, // record daily town vitals after the satisfaction step
  runImmigrationSystem, // a prosperous town attracts new citizens
  runRentSystem, // apartment rent (before accounting snapshots the day)
  runAccountingSystem, // maintenance + snapshot + reset daily accumulators
  runPayrollSystem,
  // --- per-tick simulation ---
  runCitizenScheduleSystem,
  runMovementSystem,
  runLaborSystem,
  runProductionSystem,
  runLogisticsSystem,
  runRetailDemandSystem,
  runAchievementSystem, // hourly; sees the fully-updated tick
  runMissionSystem, // hourly; guided chain advances after achievements
];

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
    const ctx = makeContext(this.state);
    for (const system of SYSTEMS) system(ctx);

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
        const firm = s.firms[command.firmId];
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
        const fac = s.facilities[command.facilityId];
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
        const fac = s.facilities[command.facilityId];
        if (fac) fac.wholesaleEnabled = command.enabled;
        return;
      }
      case 'SET_POSITIONING': {
        const fac = s.facilities[command.facilityId];
        if (fac && fac.type === 'retail') fac.positioning = command.positioning;
        return;
      }
      case 'HIRE_MANAGER': {
        const firm = s.firms[command.firmId];
        if (!firm) return;
        const role = command.role ?? 'store';
        const day = computeTime(s.tick, s.config).day;
        const cand = managerCandidates(s, day, role)[command.candidateIndex];
        if (!cand) return;
        let facilityId: string | null = null;
        let where = `${firm.name}'s ${role} desk`;
        if (role === 'store') {
          const fac = command.facilityId ? s.facilities[command.facilityId] : undefined;
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
      case 'BUY_FROM_CITY':
        performCityPurchase(
          s, command.firmId, command.facilityId, command.productId,
          command.quantity, command.cityId,
        );
        return;
      case 'FIRE_MANAGER': {
        const firm = s.firms[command.firmId];
        if (!firm) return;
        const mgr = firm.managers.find((m) => m.id === command.managerId);
        if (!mgr) return;
        firm.managers = firm.managers.filter((m) => m.id !== command.managerId);
        const post = mgr.facilityId
          ? (s.facilities[mgr.facilityId]?.name ?? 'their store')
          : `the ${mgr.role} desk`;
        emitEvent(s, 'info', 'player',
          `${mgr.name} was let go from ${post}.`, mgr.facilityId ?? command.firmId);
        return;
      }
      case 'SET_WHOLESALE_PRICE': {
        const fac = s.facilities[command.facilityId];
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
        const firm = s.firms[command.firmId];
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
        this.tradeShares(command.firmId, command.targetFirmId, command.percent);
        return;
      case 'SELL_SHARES':
        this.tradeShares(command.firmId, command.targetFirmId, -command.percent);
        return;
    }
  }

  /**
   * Buy (positive pct) or sell (negative pct) a stake in another firm at the
   * current valuation. Shares trade against the public float, so cash moves
   * to/from the world account and total money stays conserved.
   */
  private tradeShares(firmId: FirmId, targetFirmId: FirmId, pct: number): void {
    const s = this.state;
    const firm = s.firms[firmId];
    const target = s.firms[targetFirmId];
    if (!firm || !target || firmId === targetFirmId || pct === 0) return;
    if (target.ownerType !== 'player' && target.ownerType !== 'ai') return;

    const held = firm.sharesHeld[targetFirmId] ?? 0;
    const wanted = Math.round(pct);
    const applied =
      wanted > 0
        ? Math.min(wanted, MAX_STAKE_PCT - held)
        : Math.max(wanted, -held);
    if (applied === 0) {
      emitEvent(s, 'warning', 'finance',
        wanted > 0
          ? `Cannot exceed a ${MAX_STAKE_PCT}% stake in ${target.name}.`
          : `No ${target.name} shares to sell.`,
        firmId);
      return;
    }

    const pricePerPct = Math.max(1, Math.round(companyValuation(s, targetFirmId).valuation / 100));
    const cost = Math.abs(applied) * pricePerPct;

    if (applied > 0) {
      if (!canAfford(s, firmAccount(firmId), cost)) {
        emitEvent(s, 'danger', 'finance', `Not enough cash to buy ${applied}% of ${target.name} (${formatMoney(cost)}).`, firmId);
        return;
      }
      recordTransaction(s, {
        from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost,
        firmId: null, category: 'none',
        note: `Bought ${applied}% of ${target.name}`,
      });
      firm.sharesHeld[targetFirmId] = held + applied;
      emitEvent(s, 'success', 'finance', `${firm.name} bought ${applied}% of ${target.name} for ${formatMoney(cost)}.`, targetFirmId);
    } else {
      recordTransaction(s, {
        from: WORLD_ACCOUNT, to: firmAccount(firmId), amount: cost,
        firmId: null, category: 'none',
        note: `Sold ${-applied}% of ${target.name}`,
      });
      const remaining = held + applied;
      if (remaining <= 0) delete firm.sharesHeld[targetFirmId];
      else firm.sharesHeld[targetFirmId] = remaining;
      emitEvent(s, 'info', 'finance', `${firm.name} sold ${-applied}% of ${target.name} for ${formatMoney(cost)}.`, targetFirmId);
    }
  }

  /**
   * Chain wizard: build producer → factory → store for a consumer product in
   * one command, wire the two supply contracts, staff every stage from the
   * unemployed pool, select recipes, and seed the retail price. Deterministic
   * placement scans fixed rows for clear ground.
   */
  private buildChain(firmId: FirmId, productId: string): void {
    const s = this.state;
    const firm = s.firms[firmId];
    const bp = CHAIN_BLUEPRINTS[productId];
    if (!firm || !bp) return;

    // Wizard placements sit in mid-value rows; budget for a modest premium.
    const cost = Math.round(chainCost(bp) * 1.2);
    if (!canAfford(s, firmAccount(firmId), cost)) {
      emitEvent(s, 'danger', 'player', `A full ${getProduct(bp.productId).name} chain costs about ${formatMoney(cost)} — not enough cash.`, firmId);
      return;
    }

    // Prefer clear ground nearest the homes' center of mass — a store on the
    // town edge never sees foot traffic, whatever it costs.
    let homeCx = s.config.mapWidth / 2;
    let homeCount = 0;
    for (const fid in s.facilities) {
      const f = s.facilities[fid]!;
      if (f.type === 'home') { homeCx += f.location.x; homeCount++; }
    }
    if (homeCount > 0) homeCx = (homeCx - s.config.mapWidth / 2) / homeCount;
    const findSpot = (y: number): { x: number; y: number } | null => {
      let best: { x: number; y: number } | null = null;
      let bestDist = Infinity;
      for (let x = 12; x <= s.config.mapWidth - 8; x += 6) {
        let clear = true;
        for (const fid in s.facilities) {
          const loc = s.facilities[fid]!.location;
          const dx = loc.x - x;
          const dy = loc.y - y;
          if (dx * dx + dy * dy < 36) {
            clear = false;
            break;
          }
        }
        if (clear && Math.abs(x - homeCx) < bestDist) {
          bestDist = Math.abs(x - homeCx);
          best = { x, y };
        }
      }
      return best;
    };
    const spots = [findSpot(20), findSpot(33), findSpot(51)];
    if (spots.some((p) => p === null)) {
      emitEvent(s, 'warning', 'player', 'No clear ground for a full chain — build the stages manually.', firmId);
      return;
    }

    const build = (defId: string, loc: { x: number; y: number }) => {
      const def = getFacilityDef(defId);
      const mult = landCostMultiplier(landValueAt(s, loc));
      const price = Math.round(def.buildCost * mult);
      const fac = createFacility(s, defId, firmId, loc);
      fac.buildCost = price;
      fac.operatingCostPerDay = Math.round(def.maintenanceCostPerDay * mult);
      if (price > 0) {
        recordTransaction(s, {
          from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: price,
          firmId, category: 'buildSpend', note: `Built ${def.name}`,
        });
      }
      return fac;
    };
    const producer = build(bp.producerDefId, spots[0]!);
    const factory = build('factory', spots[1]!);
    const store = build('retail', spots[2]!);

    producer.activeRecipeId = bp.producerRecipeId;
    factory.activeRecipeId = bp.factoryRecipeId;
    store.retailProductIds = [bp.productId];
    if (!firm.pricesByProduct[bp.productId]) {
      firm.pricesByProduct[bp.productId] = getProduct(bp.productId).basePrice;
    }
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

    const staff = (facilityId: string, count: number): void => {
      for (let i = 0; i < count; i++) {
        const cid = findUnemployed(s);
        if (!cid || !hireCitizen(s, facilityId, cid)) break;
      }
    };
    staff(producer.id, getRecipe(bp.producerRecipeId).laborRequired);
    staff(factory.id, getRecipe(bp.factoryRecipeId).laborRequired);
    staff(store.id, 1);

    const wire = (sourceId: string, destId: string, pid: string): void => {
      const id = nextId(s.idCounters, 'ctr');
      s.contracts[id] = {
        id, ownerFirmId: firmId, sourceFacilityId: sourceId,
        destinationFacilityId: destId, productId: pid,
        targetQuantity: 40, reorderPoint: 16, maxInventory: 80,
        transportCost: 0, active: true,
      };
    };
    wire(producer.id, factory.id, bp.inputProductId);
    wire(factory.id, store.id, bp.productId);

    emitEvent(s, 'success', 'player',
      `🪄 Built a full ${getProduct(bp.productId).name} chain: ${producer.name} → ${factory.name} → ${store.name} — wired, staffed, auto-priced, and advertised. Tune any of it in the store inspector.`,
      store.id);
  }

  /**
   * Export goods staged in a warehouse to Port Rosa at the trade city's
   * current price minus the freight fee. Revenue arrives from the world
   * account (Port Rosa is off-map), so money stays conserved.
   */
  private exportGoods(command: Extract<Command, { type: 'EXPORT_GOODS' }>): void {
    const s = this.state;
    const fac = s.facilities[command.facilityId];
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
    const firm = s.firms[firmId];
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
    const citizens = Object.keys(s.citizens).length;
    const homes = Object.values(s.facilities).filter((f) => f.type === 'home').length;
    if (citizens >= s.config.maxCitizens || homes >= s.config.maxHomes) {
      emitEvent(s, 'warning', 'player', 'The town is at capacity — no room for another home.', firmId);
      return;
    }
    if (!canAfford(s, firmAccount(firmId), FUND_HOME_COST)) {
      emitEvent(s, 'danger', 'player', `Funding a home costs ${formatMoney(FUND_HOME_COST)}.`, firmId);
      return;
    }
    // Deterministic placement: scan the residential band for clear ground.
    let loc: { x: number; y: number } | null = null;
    for (let y = 60; y <= s.config.mapHeight - 4 && !loc; y += 8) {
      for (let x = 14; x <= s.config.mapWidth - 8; x += 6) {
        let clear = true;
        for (const fid in s.facilities) {
          const l = s.facilities[fid]!.location;
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
    for (let i = 0; i < 2 && Object.keys(s.citizens).length < s.config.maxCitizens; i++) {
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
    const firm = this.state.firms[firmId];
    if (!firm) return 0;
    let inv = 0;
    for (const facId of firm.facilities) {
      const fac = this.state.facilities[facId];
      if (!fac) continue;
      for (const bag of [fac.inputInventory, fac.outputInventory]) {
        for (const pid in bag) inv += bag[pid]!.quantity * getProduct(pid).basePrice;
      }
    }
    return firm.cash + inv;
  }

  private investRnd(command: Extract<Command, { type: 'INVEST_RND' }>): void {
    const s = this.state;
    const firm = s.firms[command.firmId];
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
    const firm = s.firms[command.firmId];
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
    const firm = s.firms[command.firmId];
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
    const firm = this.state.firms[this.state.playerFirmId];
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
    const firm = s.firms[command.firmId];
    if (!firm) return;
    const def = getFacilityDef(command.defId);
    const blocker = placementBlocker(s, command.location);
    if (blocker) {
      emitEvent(s, 'warning', 'player', `Too close to ${blocker.name} — pick clearer ground.`, firm.id);
      return;
    }
    // Location economics: pricier ground (and rent) near the homes.
    const mult = landCostMultiplier(landValueAt(s, command.location));
    const cost = Math.round(def.buildCost * mult);
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
    const fac = this.state.facilities[command.facilityId];
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
    const fac = this.state.facilities[command.facilityId];
    if (!fac || fac.type !== 'retail') return;
    const def = getFacilityDef(fac.defId);
    if (command.productId !== null && !def.allowedProductsForSale.includes(command.productId)) {
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
    const fac = this.state.facilities[command.facilityId];
    if (!fac || fac.type !== 'retail') return;
    const def = getFacilityDef(fac.defId);
    if (!def.allowedProductsForSale.includes(command.productId)) return;
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
    const firm = this.state.firms[firmId];
    if (firm && !firm.pricesByProduct[productId]) {
      firm.pricesByProduct[productId] = getProduct(productId).basePrice;
    }
  }

  private setPrice(command: Extract<Command, { type: 'SET_PRICE' }>): void {
    const firm = this.state.firms[command.firmId];
    if (!firm || command.price <= 0) return;
    firm.pricesByProduct[command.productId] = Math.round(command.price);
  }

  private setWage(command: Extract<Command, { type: 'SET_WAGE' }>): void {
    const firm = this.state.firms[command.firmId];
    if (!firm || command.wage < 0) return;
    firm.wagePolicy.baseWage = Math.round(command.wage);
    for (const cid of firm.employees) {
      const cit = this.state.citizens[cid];
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
    const fac = s.facilities[command.facilityId];
    if (ok && fac) {
      const cit = s.citizens[citizenId];
      emitEvent(s, 'success', 'player', `Hired ${cit?.name ?? citizenId} at ${fac.name}.`, fac.id);
    } else if (fac) {
      emitEvent(s, 'warning', 'player', `Could not hire at ${fac.name} (full or invalid).`, fac.id);
    }
  }

  private createContract(
    command: Extract<Command, { type: 'CREATE_SUPPLY_CONTRACT' }>,
  ): void {
    const s = this.state;
    const source = s.facilities[command.sourceFacilityId];
    const dest = s.facilities[command.destinationFacilityId];
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
    const firm = s.firms[command.firmId];
    const dest = s.facilities[command.destinationFacilityId];
    if (!firm || !dest) return;
    const product = getProduct(command.productId);
    const importer = Object.values(s.firms).find((f) => f.ownerType === 'external');
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
