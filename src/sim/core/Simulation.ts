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
import { makeContext, emitEvent, recordTransaction, canAfford } from './GameState';
import type { Command } from './Commands';
import { nextId } from './Id';
import type { FirmId } from './Id';
import { firmAccount, WORLD_ACCOUNT } from './Transactions';
import { createInitialState } from '../data/startingScenario';
import { createFacility } from '../entities/factories';
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
  ACQUISITION_PREMIUM_HEALTHY,
  ACQUISITION_PREMIUM_DISTRESSED,
} from '../data/constants';
import { companyValuation } from '../selectors/companySelectors';
import { worldImportMult } from '../data/worldEvents';
import type { Contract } from '../entities/Contract';

import { runTimeSystem } from '../systems/TimeSystem';
import { runWorldEventSystem } from '../systems/WorldEventSystem';
import { runAchievementSystem } from '../systems/AchievementSystem';
import { runMissionSystem } from '../systems/MissionSystem';
import { runMarketStatsSystem } from '../systems/MarketStatsSystem';
import { runAIStrategySystem } from '../systems/AIStrategySystem';
import { runEventLogSystem } from '../systems/EventLogSystem';
import { runBankruptcySystem } from '../systems/BankruptcySystem';
import { runMarketingSystem } from '../systems/MarketingSystem';
import { runFinanceSystem } from '../systems/FinanceSystem';
import { runDividendSystem } from '../systems/DividendSystem';
import { runImmigrationSystem } from '../systems/ImmigrationSystem';
import { runSatisfactionSystem } from '../systems/SatisfactionSystem';
import { runAccountingSystem } from '../systems/AccountingSystem';
import { runPayrollSystem } from '../systems/PayrollSystem';
import { runCitizenScheduleSystem } from '../systems/CitizenScheduleSystem';
import { runMovementSystem } from '../systems/MovementSystem';
import { runLaborSystem, hireCitizen, fireCitizen, findUnemployed } from '../systems/LaborSystem';
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
  runMarketStatsSystem, // finalize previous day's stats; hourly inventory totals
  runAIStrategySystem, // AI reacts using the finalized day (sets ad/R&D/loans)
  runEventLogSystem, // player-facing alerts (before daily stats are reset)
  runMarketingSystem, // ad spend -> brand; brand decay (marketing expense)
  runFinanceSystem, // accrue loan interest
  runDividendSystem, // distribute completed day's profits to shareholders
  runBankruptcySystem,
  runSatisfactionSystem,
  runImmigrationSystem, // a prosperous town attracts new citizens
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
      case 'SET_PRICE':
        this.setPrice(command);
        return;
      case 'SET_WAGE':
        this.setWage(command);
        return;
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
        this.acquireFirm(command.firmId, command.targetFirmId);
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
        emitEvent(s, 'danger', 'finance', `Not enough cash to buy ${applied}% of ${target.name} (${cost}¢).`, firmId);
        return;
      }
      recordTransaction(s, {
        from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: cost,
        firmId: null, category: 'none',
        note: `Bought ${applied}% of ${target.name}`,
      });
      firm.sharesHeld[targetFirmId] = held + applied;
      emitEvent(s, 'success', 'finance', `${firm.name} bought ${applied}% of ${target.name} for ${cost}¢.`, targetFirmId);
    } else {
      recordTransaction(s, {
        from: WORLD_ACCOUNT, to: firmAccount(firmId), amount: cost,
        firmId: null, category: 'none',
        note: `Sold ${-applied}% of ${target.name}`,
      });
      const remaining = held + applied;
      if (remaining <= 0) delete firm.sharesHeld[targetFirmId];
      else firm.sharesHeld[targetFirmId] = remaining;
      emitEvent(s, 'info', 'finance', `${firm.name} sold ${-applied}% of ${target.name} for ${cost}¢.`, targetFirmId);
    }
  }

  /**
   * Full takeover of an AI firm. The buyer pays a premium on valuation
   * (discounted for distressed targets, reduced by any stake already held) to
   * the outside shareholders (world account), then absorbs everything: cash,
   * debt, facilities, employees, in-flight shipments, contracts, brand/quality/
   * prices, and remaining share stakes. The target firm ceases to exist.
   */
  private acquireFirm(firmId: FirmId, targetFirmId: FirmId): void {
    const s = this.state;
    const buyer = s.firms[firmId];
    const target = s.firms[targetFirmId];
    if (!buyer || !target || firmId === targetFirmId) return;
    if (target.ownerType !== 'ai') return; // only AI rivals can be bought out

    const val = companyValuation(s, targetFirmId).valuation;
    const premium =
      target.bankruptcyStatus === 'healthy'
        ? ACQUISITION_PREMIUM_HEALTHY
        : ACQUISITION_PREMIUM_DISTRESSED;
    const heldPct = buyer.sharesHeld[targetFirmId] ?? 0;
    const cost = Math.max(1, Math.round((val * premium * (100 - heldPct)) / 100));

    if (!canAfford(s, firmAccount(buyer.id), cost)) {
      emitEvent(s, 'danger', 'finance',
        `Not enough cash to acquire ${target.name} (needs ${cost}¢).`, buyer.id);
      return;
    }

    // Pay the outside shareholders.
    recordTransaction(s, {
      from: firmAccount(buyer.id), to: WORLD_ACCOUNT, amount: cost,
      firmId: null, category: 'none', note: `Acquired ${target.name}`,
    });

    // Absorb the target's cash position (positive or negative).
    if (target.cash > 0) {
      recordTransaction(s, {
        from: firmAccount(target.id), to: firmAccount(buyer.id), amount: target.cash,
        firmId: null, category: 'none', note: `Cash of acquired ${target.name}`,
      });
    } else if (target.cash < 0) {
      recordTransaction(s, {
        from: firmAccount(buyer.id), to: firmAccount(target.id), amount: -target.cash,
        firmId: null, category: 'none', note: `Covered debts of acquired ${target.name}`,
      });
    }
    buyer.debt += target.debt;

    // Facilities, staff, shipments, contracts.
    for (const facId of target.facilities) {
      const fac = s.facilities[facId];
      if (!fac) continue;
      fac.ownerFirmId = buyer.id;
      buyer.facilities.push(facId);
    }
    for (const cid of target.employees) {
      const cit = s.citizens[cid];
      if (!cit) continue;
      cit.employerFirmId = buyer.id;
      buyer.employees.push(cid);
    }
    for (const vid in s.vehicles) {
      if (s.vehicles[vid]!.ownerFirmId === target.id) s.vehicles[vid]!.ownerFirmId = buyer.id;
    }
    for (const ctrId in s.contracts) {
      if (s.contracts[ctrId]!.ownerFirmId === target.id) s.contracts[ctrId]!.ownerFirmId = buyer.id;
    }

    // Merge product state: keep the better brand/quality; adopt missing prices.
    for (const pid in target.brandByProduct) {
      buyer.brandByProduct[pid] = Math.max(buyer.brandByProduct[pid] ?? 0, target.brandByProduct[pid]!);
    }
    for (const pid in target.qualityByProduct) {
      buyer.qualityByProduct[pid] = Math.max(buyer.qualityByProduct[pid] ?? 0, target.qualityByProduct[pid]!);
    }
    for (const pid in target.pricesByProduct) {
      if (!buyer.pricesByProduct[pid]) buyer.pricesByProduct[pid] = target.pricesByProduct[pid]!;
    }
    for (const pid in target.adBudgetByProduct) {
      if (!buyer.adBudgetByProduct[pid]) buyer.adBudgetByProduct[pid] = target.adBudgetByProduct[pid]!;
    }

    // Share bookkeeping: stakes IN the target vanish (bought out); the target's
    // own stakes transfer to the buyer.
    for (const hid in s.firms) delete s.firms[hid]!.sharesHeld[targetFirmId];
    for (const tid in target.sharesHeld) {
      if (tid === buyer.id) continue;
      buyer.sharesHeld[tid] = Math.min(
        MAX_STAKE_PCT,
        (buyer.sharesHeld[tid] ?? 0) + target.sharesHeld[tid]!,
      );
    }

    buyer.acquiredNames.push(target.name);
    delete s.firms[targetFirmId];
    emitEvent(s, 'success', 'finance',
      `🤝 ${buyer.name} acquired ${target.name} for ${cost}¢ — facilities, staff, and brands absorbed.`,
      buyer.id);
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
    emitEvent(s, 'success', 'finance', `Borrowed ${amount}¢. Total debt ${firm.debt}¢.`, firm.id);
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
    emitEvent(s, 'info', 'finance', `Repaid ${amount}¢. Remaining debt ${firm.debt}¢.`, firm.id);
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
    if (!canAfford(s, firmAccount(firm.id), def.buildCost)) {
      emitEvent(s, 'danger', 'player', `Cannot afford to build ${def.name}.`, firm.id);
      return;
    }
    const fac = createFacility(s, command.defId, firm.id, command.location);
    if (def.buildCost > 0) {
      recordTransaction(s, {
        from: firmAccount(firm.id),
        to: WORLD_ACCOUNT,
        amount: def.buildCost,
        firmId: firm.id,
        category: 'buildSpend',
        note: `Built ${def.name}`,
      });
    }
    emitEvent(s, 'success', 'player', `Built ${fac.name}.`, fac.id);
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
    fac.retailProductId = command.productId;
    // Seed a default price if the firm has none yet.
    if (command.productId) {
      const firm = this.state.firms[fac.ownerFirmId];
      if (firm && !firm.pricesByProduct[command.productId]) {
        firm.pricesByProduct[command.productId] = getProduct(command.productId).basePrice;
      }
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
