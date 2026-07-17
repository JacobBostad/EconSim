/**
 * startingScenario.ts — Builds the initial, immediately-playable GameState.
 *
 * The town has 40 citizens in 20 homes, two AI competitors running full supply
 * chains (a bread chain and a tools chain), an external importer, and a player
 * firm with starting cash but no facilities (buildable empty land). Initial
 * inventories and employment are seeded so the economy starts moving on tick 0.
 *
 * Everything is generated deterministically from the seed via the Rng.
 */

import type { GameState } from '../core/GameState';
import type { SimulationConfig } from '../core/SimulationConfig';
import { DEFAULT_CONFIG } from '../core/SimulationConfig';
import { Rng, seedToState } from '../core/Random';
import { nextId, type IdCounters } from '../core/Id';
import type { Citizen } from '../entities/Citizen';
import type { Firm, FirmOwnerType } from '../entities/Firm';
import { emptyStrategy } from '../entities/Firm';
import type { Facility } from '../entities/Facility';
import { emptyFacilityDailyStats } from '../entities/Facility';
import type { Contract } from '../entities/Contract';
import type { Vec2 } from '../entities/Location';
import { emptyAccounting } from '../entities/Accounting';
import { emptyMarketStat } from '../entities/Market';
import { addStock, type Inventory } from '../entities/Inventory';
import { makeCitizenNeeds } from '../entities/factories';
import { getFacilityDef } from './facilityDefinitions';
import { getProduct, CONSUMER_PRODUCT_IDS, ALL_PRODUCT_IDS } from './products';
import { FIRST_NAMES, LAST_NAMES } from './names';
import { dollars } from './constants';
import { SAVE_VERSION } from '../core/GameState';

const NUM_HOMES = 20;
const CITIZENS_PER_HOME = 2;
const PLAYER_START_CASH = dollars(15000);
const CITIZEN_START_CASH = dollars(400);
const DEFAULT_AI_WAGE = dollars(14);
const PLAYER_DEFAULT_WAGE = dollars(15);

interface Builder {
  state: GameState;
  rng: Rng;
  counters: IdCounters;
}

function newFacility(
  b: Builder,
  defId: string,
  ownerFirmId: string,
  location: Vec2,
  opts: { name?: string; activeRecipeId?: string | null; retailProductId?: string | null } = {},
): Facility {
  const def = getFacilityDef(defId);
  const id = nextId(b.counters, 'fac');
  const fac: Facility = {
    id,
    defId,
    name: opts.name ?? def.name,
    type: def.type,
    ownerFirmId,
    location,
    employees: [],
    inputInventory: {},
    outputInventory: {},
    storageCapacity: def.storageCapacity,
    recipes: [...def.allowedRecipes],
    activeRecipeId: opts.activeRecipeId ?? null,
    retailProductId: opts.retailProductId ?? null,
    operatingCostPerDay: def.maintenanceCostPerDay,
    buildCost: def.buildCost,
    productionProgress: 0,
    status: 'idle',
    bottleneckReason: null,
    dailyStats: emptyFacilityDailyStats(),
    presentWorkers: 0,
    residentIds: [],
  };
  b.state.facilities[id] = fac;
  b.state.firms[ownerFirmId]!.facilities.push(id);
  return fac;
}

function newFirm(
  b: Builder,
  name: string,
  ownerType: FirmOwnerType,
  cash: number,
  strategy: Firm['strategy'],
  wage: number,
): Firm {
  const id = nextId(b.counters, 'firm');
  const firm: Firm = {
    id,
    name,
    ownerType,
    cash,
    facilities: [],
    employees: [],
    pricesByProduct: {},
    wagePolicy: { baseWage: wage },
    accounting: emptyAccounting(),
    strategy,
    bankruptcyStatus: 'healthy',
    daysInsolvent: 0,
    marketShareByProduct: {},
    createdAtTick: 0,
    brandByProduct: {},
    adBudgetByProduct: {},
    qualityByProduct: {},
    debt: 0,
    interestRatePerDay: 0.0009,
    sharesHeld: {},
  };
  b.state.firms[id] = firm;
  return firm;
}

// Needs generation is shared with runtime immigration — see entities/factories.

function newCitizen(b: Builder, homeId: string, homeLoc: Vec2): Citizen {
  const id = nextId(b.counters, 'cit');
  const first = b.rng.pick(FIRST_NAMES) ?? 'Sam';
  const last = b.rng.pick(LAST_NAMES) ?? 'Doe';
  const prefs: Record<string, number> = {};
  for (const pid of CONSUMER_PRODUCT_IDS) prefs[pid] = b.rng.range(0.85, 1.15);
  const cit: Citizen = {
    id,
    name: `${first} ${last}`,
    homeFacilityId: homeId,
    employerFirmId: null,
    workplaceFacilityId: null,
    role: 'unemployed',
    wage: 0,
    cash: CITIZEN_START_CASH,
    needs: makeCitizenNeeds(b.rng),
    preferences: prefs,
    currentLocation: { ...homeLoc },
    targetLocation: { ...homeLoc },
    targetFacilityId: null,
    movementState: 'idle',
    activity: 'home',
    satisfaction: 70,
    employmentStatus: 'unemployed',
    lastPurchasedFromByProduct: {},
    storeReliability: {},
    dailyStats: { day: 0, wagesEarned: 0, spent: 0, purchases: 0, unmetNeeds: 0 },
    lastShopTick: -1000,
    missedPaydays: 0,
  };
  b.state.citizens[id] = cit;
  b.state.facilities[homeId]!.residentIds.push(id);
  return cit;
}

/** Employ a citizen at a facility/firm. */
function employ(
  b: Builder,
  citizenId: string,
  firmId: string,
  facilityId: string,
  role: string,
  wage: number,
): void {
  const cit = b.state.citizens[citizenId]!;
  cit.employerFirmId = firmId;
  cit.workplaceFacilityId = facilityId;
  cit.role = role;
  cit.wage = wage;
  cit.employmentStatus = 'employed';
  b.state.facilities[facilityId]!.employees.push(citizenId);
  b.state.firms[firmId]!.employees.push(citizenId);
}

function stock(inv: Inventory, productId: string, qty: number): void {
  addStock(inv, productId, qty, getProduct(productId).defaultQuality);
}

export function createInitialState(
  seed: number,
  config: SimulationConfig = DEFAULT_CONFIG,
): GameState {
  const counters: IdCounters = {};
  const state: GameState = {
    saveVersion: SAVE_VERSION,
    seed,
    rngState: seedToState(seed),
    tick: 0,
    speed: 1,
    paused: false, // the world starts alive; the player can pause anytime
    config: { ...config },
    citizens: {},
    firms: {},
    facilities: {},
    vehicles: {},
    contracts: {},
    marketStats: {},
    worldCash: dollars(1_000_000),
    playerFirmId: '',
    worldFirmId: '',
    events: [],
    transactions: [],
    worldEvents: [],
    achievements: [],
    idCounters: counters,
    selectedEntityId: null,
    perf: { lastTickMs: 0, avgTickMs: 0, ticksSimulated: 0 },
  };
  const b: Builder = { state, rng: new Rng(state), counters };

  for (const pid of ALL_PRODUCT_IDS) state.marketStats[pid] = emptyMarketStat(pid);

  // --- World firm (owns homes; sink for external costs) ------------------
  const world = newFirm(b, 'Municipality', 'world', 0, emptyStrategy('none'), 0);
  state.worldFirmId = world.id;

  // --- Homes (residential neighbourhood, lower band) ---------------------
  const homeLocations: Vec2[] = [];
  const cols = 5;
  for (let i = 0; i < NUM_HOMES; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const loc: Vec2 = { x: 16 + col * 11, y: 60 + row * 8 };
    homeLocations.push(loc);
    newFacility(b, 'home', world.id, loc, { name: `Home ${i + 1}` });
  }

  // --- Citizens ----------------------------------------------------------
  const homeFacilityIds = Object.keys(state.facilities).filter(
    (id) => state.facilities[id]!.type === 'home',
  );
  for (let h = 0; h < homeFacilityIds.length; h++) {
    const homeId = homeFacilityIds[h]!;
    for (let c = 0; c < CITIZENS_PER_HOME; c++) {
      newCitizen(b, homeId, state.facilities[homeId]!.location);
    }
  }
  const allCitizenIds = Object.keys(state.citizens);
  let nextWorker = 0;
  const takeWorker = (): string | null =>
    nextWorker < allCitizenIds.length ? allCitizenIds[nextWorker++]! : null;

  // --- Player firm (no facilities; buildable land) -----------------------
  const player = newFirm(
    b,
    'Player Holdings',
    'player',
    PLAYER_START_CASH,
    emptyStrategy('none'),
    PLAYER_DEFAULT_WAGE,
  );
  state.playerFirmId = player.id;

  // --- External importer -------------------------------------------------
  const importer = newFirm(
    b,
    'Global Importers',
    'external',
    dollars(2_000_000),
    emptyStrategy('none'),
    0,
  );
  const importerFac = newFacility(b, 'importer', importer.id, { x: 120, y: 10 }, {
    name: 'Import Terminal',
  });
  // Importer holds a large buffer so contract-based sourcing always succeeds.
  stock(importerFac.outputInventory, 'grain', 100000);
  stock(importerFac.outputInventory, 'minerals', 100000);

  // --- AI Foods: bread chain (farm -> bakery -> retail) ------------------
  const aiFoods = newFirm(
    b,
    'Sunrise Foods',
    'ai',
    dollars(40000),
    emptyStrategy('bread'),
    DEFAULT_AI_WAGE,
  );
  aiFoods.pricesByProduct.bread = getProduct('bread').basePrice;
  aiFoods.brandByProduct.bread = 22;
  aiFoods.qualityByProduct.bread = getProduct('bread').defaultQuality;
  aiFoods.adBudgetByProduct.bread = dollars(20);

  const farm = newFacility(b, 'farm', aiFoods.id, { x: 26, y: 16 }, {
    name: 'Sunrise Farm',
    activeRecipeId: 'grow_grain',
  });
  stock(farm.outputInventory, 'grain', 60);

  const bakery = newFacility(b, 'factory', aiFoods.id, { x: 48, y: 32 }, {
    name: 'Sunrise Bakery',
    activeRecipeId: 'bake_bread',
  });
  stock(bakery.inputInventory, 'grain', 30);
  stock(bakery.outputInventory, 'bread', 24);

  const breadShop = newFacility(b, 'retail', aiFoods.id, { x: 46, y: 48 }, {
    name: 'Sunrise Bread Shop',
    retailProductId: 'bread',
  });
  stock(breadShop.inputInventory, 'bread', 40);

  // Staff the bread chain (lean: roughly at each recipe's labor requirement).
  for (let i = 0; i < 2; i++) {
    const w = takeWorker();
    if (w) employ(b, w, aiFoods.id, farm.id, 'farmhand', DEFAULT_AI_WAGE);
  }
  for (let i = 0; i < 2; i++) {
    const w = takeWorker();
    if (w) employ(b, w, aiFoods.id, bakery.id, 'baker', DEFAULT_AI_WAGE);
  }
  for (let i = 0; i < 2; i++) {
    const w = takeWorker();
    if (w) employ(b, w, aiFoods.id, breadShop.id, 'clerk', DEFAULT_AI_WAGE);
  }

  // --- AI Industrial: tools chain (mine -> factory -> retail) ------------
  const aiInd = newFirm(
    b,
    'Granite Industries',
    'ai',
    dollars(45000),
    emptyStrategy('tools'),
    DEFAULT_AI_WAGE,
  );
  aiInd.pricesByProduct.tools = getProduct('tools').basePrice;
  aiInd.brandByProduct.tools = 22;
  aiInd.qualityByProduct.tools = getProduct('tools').defaultQuality;
  aiInd.adBudgetByProduct.tools = dollars(14);

  const mine = newFacility(b, 'mine', aiInd.id, { x: 104, y: 16 }, {
    name: 'Granite Mine',
    activeRecipeId: 'mine_minerals',
  });
  stock(mine.outputInventory, 'minerals', 50);

  const toolFactory = newFacility(b, 'factory', aiInd.id, { x: 86, y: 32 }, {
    name: 'Granite Tool Works',
    activeRecipeId: 'make_tools',
  });
  stock(toolFactory.inputInventory, 'minerals', 24);
  stock(toolFactory.outputInventory, 'tools', 12);

  const toolShop = newFacility(b, 'retail', aiInd.id, { x: 78, y: 48 }, {
    name: 'Granite Hardware',
    retailProductId: 'tools',
  });
  stock(toolShop.inputInventory, 'tools', 20);

  for (let i = 0; i < 2; i++) {
    const w = takeWorker();
    if (w) employ(b, w, aiInd.id, mine.id, 'miner', DEFAULT_AI_WAGE);
  }
  for (let i = 0; i < 2; i++) {
    const w = takeWorker();
    if (w) employ(b, w, aiInd.id, toolFactory.id, 'machinist', DEFAULT_AI_WAGE);
  }
  for (let i = 0; i < 1; i++) {
    const w = takeWorker();
    if (w) employ(b, w, aiInd.id, toolShop.id, 'clerk', DEFAULT_AI_WAGE);
  }

  // --- AI supply contracts -----------------------------------------------
  const addContract = (
    ownerFirmId: string,
    source: string,
    dest: string,
    productId: string,
    targetQuantity: number,
    reorderPoint: number,
    maxInventory: number,
  ): Contract => {
    const id = nextId(b.counters, 'ctr');
    const ctr: Contract = {
      id,
      ownerFirmId,
      sourceFacilityId: source,
      destinationFacilityId: dest,
      productId,
      targetQuantity,
      reorderPoint,
      maxInventory,
      transportCost: 0,
      active: true,
    };
    state.contracts[id] = ctr;
    return ctr;
  };

  addContract(aiFoods.id, farm.id, bakery.id, 'grain', 40, 15, 80);
  addContract(aiFoods.id, bakery.id, breadShop.id, 'bread', 50, 20, 90);
  addContract(aiInd.id, mine.id, toolFactory.id, 'minerals', 30, 12, 60);
  addContract(aiInd.id, toolFactory.id, toolShop.id, 'tools', 24, 8, 50);

  return state;
}
