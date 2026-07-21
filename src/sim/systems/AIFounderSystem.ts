/**
 * AIFounderSystem — capital follows people. When a staple consumer market
 * goes unserved for weeks in a town that is otherwise worth living in, a
 * brand-new AI firm moves in and founds a starter chain for it, built by the
 * same ChainBuilder the player's wizard uses.
 *
 * Three stacked gates keep entries meaningful:
 *  - the GAP must persist: FOUNDER_GAP_DAYS consecutive days with no staffed
 *    seller of the product (any seller — player or AI — resets the count);
 *  - the TOWN must be attractive: average satisfaction at or above the
 *    immigration gate and a minimum population — capital doesn't chase ghost
 *    towns, so a bleeding Dust Hollow only draws founders AFTER the player
 *    stops the exodus;
 *  - the PLAYER gets first mover: nothing founds before FOUNDER_EARLIEST_DAY,
 *    and a total-AI-firm cap keeps the map from crowding.
 *
 * The daily roll is hash-gated (zero rng-stream draws) and the founding
 * capital arrives from the world account — the mirror of how export revenue
 * leaves to it — so total money supply is conserved.
 */

import type { SimContext, GameState } from '../core/GameState';
import { recordTransaction, emitEvent, reindexContracts } from '../core/GameState';
import type { SimulationConfig } from '../core/SimulationConfig';
import { SIZE_PRESETS } from '../core/SimulationConfig';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { nextId } from '../core/Id';
import type { Firm, FirmArchetype } from '../entities/Firm';
import { emptyStrategy } from '../entities/Firm';
import { emptyAccounting } from '../entities/Accounting';
import { getProduct } from '../data/products';
import { CHAIN_BLUEPRINTS, chainCost } from '../data/chains';
import { defaultPersonalityFor, defaultCeoFor, PERSONALITIES } from '../data/personalities';
import { buildStarterChain } from '../core/ChainBuilder';
import { createFacility } from '../entities/factories';
import { getFacilityDef } from '../data/facilityDefinitions';
import { landCostMultiplier, landValueAt } from '../core/LandValue';
import { clamp } from '../../utils/clamp';
import { townHousingOccupancy } from './ai/LandlordBehavior';
import { soldSomewhere } from './SatisfactionSystem';
import { marketCap } from '../selectors/companySelectors';
import { smoothedProfitBase } from './DividendSystem';
import { SERVICE_IDS, getServiceDef, seatDemand } from '../data/services';
import { serviceCapacity } from './ServiceBillingSystem';
import { foundServiceFacility } from './ai/ServiceBehavior';
import {
  IMMIGRATION_MIN_SATISFACTION,
  FOUNDER_EARLIEST_DAY,
  FOUNDER_GAP_DAYS,
  FOUNDER_DAILY_CHANCE,
  FOUNDER_MIN_POPULATION,
  FOUNDER_UNDERSUPPLY_WINDOW,
  FOUNDER_UNDERSUPPLY_DAYS,
  INVESTOR_YIELD_BAR,
  INVESTOR_SIGNAL_DAYS,
  INVESTOR_ENTRY_COOLDOWN,
  INVESTOR_FOUNDER_CASH,
  dollars,
} from '../data/constants';

/** The live founder cap: the size preset's `founderMaxAiFirms` (Village
 * resolves to exactly the FOUNDER_MAX_AI_FIRMS baseline of 6; City 18;
 * Metropolis 30). Replaces the old hard constant so a bigger town supports
 * more competitors. */
export function founderMaxAiFirms(config: SimulationConfig): number {
  return SIZE_PRESETS[config.sizePreset].founderMaxAiFirms;
}

/** Town-wide days between under-supply entries, per preset (A5). Village/City
 * resolve to the FOUNDER_UNDERSUPPLY_COOLDOWN baseline (20); Metropolis paces
 * faster (7) so a 30-cap map actually fills — see SIZE_PRESETS. */
export function founderUndersupplyCooldown(config: SimulationConfig): number {
  return SIZE_PRESETS[config.sizePreset].founderUndersupplyCooldown;
}

/** Smoothed fill-rate below which a staple counts as under-supplied, per preset
 * (A5). Village/City keep the FOUNDER_UNDERSUPPLY_FILL_RATE baseline (0.65);
 * Metropolis lifts it (0.80) so the signal keeps firing until the big crowd is
 * genuinely served — see SIZE_PRESETS. */
export function founderUndersupplyFillRate(config: SimulationConfig): number {
  return SIZE_PRESETS[config.sizePreset].founderUndersupplyFillRate;
}

/** Founding capital a new firm receives from the world account, per preset (A5).
 * Village/City keep the FOUNDER_CASH baseline ($22k); Metropolis raises it ($28k)
 * for ramp runway on the bigger, pricier map — see SIZE_PRESETS. */
export function founderCash(config: SimulationConfig): number {
  return SIZE_PRESETS[config.sizePreset].founderCash;
}

/** The wage a freshly-founded operator pays its crowd workers, per preset (the
 * City cast-parity pass). $16 everywhere by default (= the historical
 * `dollars(16)` literal), so this is inert; a City-decoupling ship would raise
 * City to $18 so crowd workers clear the comfortable wage bar and comfortable
 * formation rides the wage leg instead of the runaway pool. See SIZE_PRESETS. */
export function founderCrowdWage(config: SimulationConfig): number {
  return SIZE_PRESETS[config.sizePreset].founderCrowdWage;
}

/** Staples a founder will move in on. Coffee and the classic luxuries
 * (pastries/jewelry) stay with the existing late-game AI entries — this
 * system fills the basic gaps. Village keeps exactly the three shipped
 * staples (its founder tests and 300-day baseline pin this set). */
export const FOUNDER_PRODUCTS = ['bread', 'tools', 'clothes'] as const;

/** Metropolis broadens the founder's remit to the Arc C1 breadth chains
 * (metropolis-only products — see products.ts availableIn). Ordered so the
 * classic staples still lead the fixed-order vacancy scan; the breadth products
 * follow. Every entry has a CHAIN_BLUEPRINT. City keeps exactly the shipped
 * three (its A3/A4 tier calibration is pinned to that trajectory, so the C1
 * breadth is metropolis-only). */
const FOUNDER_PRODUCTS_METRO = [
  'bread', 'tools', 'clothes', 'meals', 'shoes', 'furniture', 'appliances', 'wine',
] as const;

/** Founder-eligible staples at a given preset (Arc C1). Village and City stay
 * the shipped three exactly; Metropolis adds the breadth chains. */
export function founderProductsFor(config: SimulationConfig): readonly string[] {
  return config.sizePreset === 'metropolis' ? FOUNDER_PRODUCTS_METRO : FOUNDER_PRODUCTS;
}

/** Firm-name pools per product, picked by hash — flavor, not mechanics. */
const FOUNDER_NAMES: Record<string, string[]> = {
  bread: ['Prairie Oven Co', 'Hearthstone Baking', 'Miller & Crumb'],
  tools: ['Anvil Brothers', 'Keystone Toolworks', 'Ridgeline Forge Co'],
  clothes: ['Thimble & Cloth', 'Meridian Garment Co', 'Weaver House'],
  meals: ['Corner Kitchen Co', 'Harvest Table', 'Daily Plate'],
  shoes: ['Cobblestone & Sons', 'Sole Foundry', 'Wander Bootworks'],
  furniture: ['Oakline Furnishings', 'Timberframe Co', 'Homestead Joinery'],
  appliances: ['Ironclad Appliance Co', 'Copperworks Home', 'Beacon Whitegoods'],
  wine: ['Hillside Vintners', 'Cellar & Vine', 'Amberfield Winery'],
};

/** Holdco name pool (Arc D3) — investment firms, picked by hash. Flavor only. */
const INVESTOR_NAMES = ['Meridian Capital', 'Keystone Holdings', 'Anchor Equity Partners'];

/** Deterministic daily entry gate — same salt family as the other bolt-on
 * rolls, distinct constant so it fires on independent days. */
export function founderRoll(seed: number, day: number): boolean {
  let t = (seed ^ Math.imul(day + 271, 0xc2b2ae35)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 < FOUNDER_DAILY_CHANCE;
}

function hashPick(seed: number, day: number, n: number): number {
  let t = (seed ^ Math.imul(day + 419, 0x27d4eb2f)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0; // unsigned — a negative index picks nobody
  return t % n;
}

function foundFirm(
  ctx: SimContext,
  productId: string,
  day: number,
  entry: 'vacancy' | 'undersupply' = 'vacancy',
): void {
  const { state } = ctx;
  const aiCount = Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
  const pool = FOUNDER_NAMES[productId] ?? [`New ${getProduct(productId).name} Co`];
  const name = pool[hashPick(state.seed, day, pool.length)]!;
  const personality = defaultPersonalityFor(aiCount);

  const id = nextId(state.idCounters, 'firm');
  const firm: Firm = {
    id,
    name,
    ownerType: 'ai',
    cash: 0,
    facilities: [],
    employees: [],
    pricesByProduct: { [productId]: getProduct(productId).basePrice },
    // Preset-keyed crowd wage: $16 at every shipped preset (bit-identical to the
    // historical dollars(16) literal); a City-decoupling ship raises City to $18.
    wagePolicy: { baseWage: founderCrowdWage(state.config) },
    accounting: emptyAccounting(),
    strategy: emptyStrategy(productId),
    bankruptcyStatus: 'healthy',
    daysInsolvent: 0,
    marketShareByProduct: {},
    createdAtTick: state.tick,
    personalityId: personality,
    ceoName: defaultCeoFor(personality, aiCount),
    brandByProduct: { [productId]: 12 },
    adBudgetByProduct: { [productId]: dollars(10) },
    qualityByProduct: { [productId]: getProduct(productId).defaultQuality },
    debt: 0,
    interestRatePerDay: 0.0009,
    sharesHeld: {},
    shareCostBasis: {},
    acquiredNames: [],
    autoPriceByProduct: {},
    exportRevenue: 0,
    exportRevenueByCity: {},
    wholesaleSpend: 0,
    wholesaleEarned: 0,
    managers: [],
    forwards: [],
    forwardWins: 0,
  };
  state.firms[id] = firm;

  // Founding capital arrives from outside the town — conserved. Per-preset (A5):
  // Metropolis founders get a longer ramp runway than the Village/City baseline.
  recordTransaction(state, {
    from: WORLD_ACCOUNT, to: firmAccount(id), amount: founderCash(state.config),
    firmId: id, category: 'none', note: 'Founding capital',
  });

  const built = buildStarterChain(state, id, productId);
  if (!built) {
    // No clear ground: return the capital and dissolve — nothing happened.
    recordTransaction(state, {
      from: firmAccount(id), to: WORLD_ACCOUNT, amount: firm.cash,
      firmId: id, category: 'none', note: 'Founding abandoned',
    });
    delete state.firms[id];
    return;
  }

  // A whole starter chain (producer→factory→shop contracts) just entered the
  // world; rebuild the index so logistics later this tick sees the new lines.
  reindexContracts(ctx);

  state.marketGapDays[productId] = 0;
  // A fresh seller relieves both shortage signals for this staple.
  state.marketUndersupplyDays[productId] = 0;
  const ceo = firm.ceoName ? ` ${PERSONALITIES[personality]!.icon} ${firm.ceoName} arrives to run it.` : '';
  const product = getProduct(productId).name.toLowerCase();
  const headline =
    entry === 'undersupply'
      ? `📰 New competition: ${name} moves into town to sell ${product} — the shelves can't keep up with demand.${ceo}`
      : `📰 New competition: ${name} moves into town to sell ${product} — nobody else would.${ceo}`;
  emitEvent(state, 'info', 'economy', headline, built.store.id);
}

/**
 * Found an investor holdco (Arc D3, city-scale): an AI firm with NO chain and no
 * shelves — its whole business is the equity book. Founding capital arrives from
 * the world account (conserved) and stays deployable, since nothing is built.
 * The archetype is stamped 'investor', so the dispatcher routes it to
 * runInvestorBehavior; an expansionist persona gives it the appetite to ladder
 * stakes toward the control block.
 */
function foundInvestorFirm(ctx: SimContext, day: number): void {
  const { state } = ctx;
  const aiCount = Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
  const name = INVESTOR_NAMES[hashPick(state.seed, day, INVESTOR_NAMES.length)]!;
  const personality = 'expansionist'; // a holdco accumulates — high stake appetite

  const id = nextId(state.idCounters, 'firm');
  const firm: Firm = {
    id,
    name,
    ownerType: 'ai',
    cash: 0,
    facilities: [],
    employees: [],
    pricesByProduct: {},
    wagePolicy: { baseWage: dollars(16) },
    accounting: emptyAccounting(),
    strategy: emptyStrategy('none', 'investor'),
    bankruptcyStatus: 'healthy',
    daysInsolvent: 0,
    marketShareByProduct: {},
    createdAtTick: state.tick,
    personalityId: personality,
    ceoName: defaultCeoFor(personality, aiCount),
    brandByProduct: {},
    adBudgetByProduct: {},
    qualityByProduct: {},
    debt: 0,
    interestRatePerDay: 0.0009,
    sharesHeld: {},
    shareCostBasis: {},
    acquiredNames: [],
    autoPriceByProduct: {},
    exportRevenue: 0,
    exportRevenueByCity: {},
    wholesaleSpend: 0,
    wholesaleEarned: 0,
    managers: [],
    forwards: [],
    forwardWins: 0,
  };
  state.firms[id] = firm;

  recordTransaction(state, {
    from: WORLD_ACCOUNT, to: firmAccount(id), amount: INVESTOR_FOUNDER_CASH,
    firmId: id, category: 'none', note: 'Holdco founding capital',
  });

  const ceo = firm.ceoName ? ` ${PERSONALITIES[personality]!.icon} ${firm.ceoName} runs the book.` : '';
  emitEvent(state, 'info', 'economy',
    `📰 ${name}, an investment firm, opens in town to build a portfolio of local equity — dividends are fat and stakes are cheap.${ceo}`);
}

/**
 * Town-wide population and average satisfaction over the WHOLE population — the
 * simulated cast plus the crowd cohorts (population-weighted, exactly the mean
 * ImmigrationSystem/CohortSocialSystem's migration uses). At Village size the
 * cohort map is empty, so this reduces to the cast-only mean and the founder
 * gates stay bit-identical to before world-scale.
 */
function townPopAndSat(state: GameState): { pop: number; avgSat: number } {
  let satMass = 0;
  let pop = 0;
  for (const id in state.citizens) {
    satMass += state.citizens[id]!.satisfaction;
    pop += 1;
  }
  for (const cid in state.cohorts) {
    const co = state.cohorts[cid]!;
    satMass += co.avgSatisfaction * co.population;
    pop += co.population;
  }
  return { pop, avgSat: pop > 0 ? satMass / pop : 0 };
}

/**
 * Smoothed town fill-rate for a staple over the last FOUNDER_UNDERSUPPLY_WINDOW
 * finalized days: fulfilled / (fulfilled + unmet) from marketStats history
 * (unitsSold == fulfilledDemand). Returns 1 (fully served) when there is no
 * recorded demand — an empty market is the total-vacancy path's business, not
 * the under-supply signal's.
 */
function smoothedFillRate(state: GameState, productId: string): number {
  const hist = state.marketStats[productId]?.history ?? [];
  let fulfilled = 0;
  let unmet = 0;
  for (let i = Math.max(0, hist.length - FOUNDER_UNDERSUPPLY_WINDOW); i < hist.length; i++) {
    fulfilled += hist[i]!.unitsSold;
    unmet += hist[i]!.unmetDemand;
  }
  const demand = fulfilled + unmet;
  return demand > 0 ? fulfilled / demand : 1;
}

/**
 * A town read shared across archetype founding attempts (Arc D1): the gated
 * day, the whole-town population mood, the AI-firm headcount, and this preset's
 * scale + founding cash. Assembled once per day by the shell after the shared
 * entry gates pass; each archetype row consumes it.
 */
interface FounderTownRead {
  day: number;
  avgSat: number;
  aiCount: number;
  cityScale: boolean;
  cash: number;
}

/**
 * One archetype's founder logic (Arc D1, design HD5). Each row owns:
 *  - `trackSignals` — update its per-day opportunity counters. Runs EVERY day,
 *    before any gate, so streaks accrue during the pre-earliest window too.
 *  - `tryFound` — given the day's town read (shared gates already passed),
 *    attempt one founding. Returns true when it CLAIMS the day's single
 *    founding slot (the world founds at most one firm per day, town-wide);
 *    false to let the next row try.
 *
 * Today only the OPERATOR row is live — it carries the staple vacancy +
 * under-supply signals verbatim. D2–D4 append landlord / investor / service
 * rows to FOUNDER_ARCHETYPES; the shell iterates the table, so a new row is
 * purely additive and never re-touches the operator path.
 */
interface FounderArchetype {
  archetype: FirmArchetype;
  trackSignals(ctx: SimContext): void;
  tryFound(ctx: SimContext, town: FounderTownRead): boolean;
}

// --- operator row: the classic staple-gap + under-supply founder -----------

function operatorTrackSignals(ctx: SimContext): void {
  const { state } = ctx;
  // Preset-gated staple set (C1): Village is the shipped three exactly, so its
  // marketGapDays keys and fixed-order scan are byte-identical to pre-C1;
  // City/Metropolis add the breadth chains.
  const founderProducts = founderProductsFor(state.config);

  // Track total-vacancy gaps every day (cheap, and the counters read well in
  // debug). This runs at every preset — it is the classic Village signal.
  for (const pid of founderProducts) {
    state.marketGapDays[pid] = soldSomewhere(state, pid)
      ? 0
      : (state.marketGapDays[pid] ?? 0) + 1;
  }

  // Under-supply streak tracking is CITY-SCALE ONLY. The Village economy was
  // calibrated (and its founder tests pinned) WITHOUT this signal; a persistent
  // shortage at a staffed counter is a crowd-scale phenomenon (city-soak
  // finding (a)). Gating the whole scan on `sizePreset !== 'village'` makes the
  // under-supply entry structurally impossible to fire in a Village — the
  // streak counter is never even touched there, so Village stays bit-identical.
  const cityScale = state.config.sizePreset !== 'village';
  if (cityScale) {
    const fillTrigger = founderUndersupplyFillRate(state.config);
    for (const pid of founderProducts) {
      state.marketUndersupplyDays[pid] =
        smoothedFillRate(state, pid) < fillTrigger
          ? (state.marketUndersupplyDays[pid] ?? 0) + 1
          : 0;
    }
  }
}

function operatorTryFound(ctx: SimContext, town: FounderTownRead): boolean {
  const { state } = ctx;
  const { day, avgSat, aiCount, cityScale, cash } = town;
  const founderProducts = founderProductsFor(state.config);

  const affordable = (pid: string): boolean =>
    !!CHAIN_BLUEPRINTS[pid] && cash >= Math.round(chainCost(CHAIN_BLUEPRINTS[pid]!) * 1.2);

  // (1) Total-vacancy entry (unchanged): hash-gated daily, the first persistent
  // gap in fixed product order. Keeps the classic "don't chase a struggling
  // town" satisfaction CEILING — an empty shelf in an unhappy town is the
  // player's to claim first (this is the gate the Village founder tests pin).
  // One entry per day; claims the slot once a qualifying gap is found (whether
  // or not it can afford to build it).
  if (avgSat >= IMMIGRATION_MIN_SATISFACTION && founderRoll(state.seed, day)) {
    for (const pid of founderProducts) {
      if ((state.marketGapDays[pid] ?? 0) >= FOUNDER_GAP_DAYS && CHAIN_BLUEPRINTS[pid]) {
        if (affordable(pid)) foundFirm(ctx, pid, day, 'vacancy');
        return true; // vacancy attempt claims the day's founding slot
      }
    }
  }

  // (2) Under-supply entry into an OCCUPIED market — city-scale only, and
  // rate-limited town-wide so a temporary shock doesn't spawn five bakeries.
  // Deliberately NOT gated on the immigration satisfaction ceiling: a chronic
  // paying shortage is exactly what DEPRESSES satisfaction, so requiring a
  // happy town first would be a deadlock (the shortage blocks its own cure).
  // The proof the market is alive and "supports another chain" is the paying
  // demand itself — the fill-rate denominator is real fulfilled+unmet sales,
  // and a truly empty town fails the population gate above. The 15-day streak
  // paces entry against noise; the cooldown paces it town-wide.
  if (!cityScale) return false;
  if (day - state.lastUndersupplyEntryDay < founderUndersupplyCooldown(state.config)) return false;
  // Solvency brake (A5): capital stops chasing a market whose incumbents are
  // already struggling. The under-supply signal is a SERVICE-LEVEL read (town
  // fill-rate), not a PROFITABILITY one — so on the biggest maps it keeps firing
  // while ANY demand is unmet, and the founder-scale probe caught it overshooting
  // the durable ceiling: a Metropolis packed to its 30-firm cap on the raw signal
  // slid into a 10-16 firm insolvency cascade by day 400, because each extra
  // entrant split the same demand until nobody cleared their wage bill. When a
  // meaningful share of AI firms is already distressed/insolvent, a fresh
  // competitor makes it worse, not better — the shortage is then a supply-chain
  // problem for the incumbents to grow into, not a missing-firm problem. Holding
  // off lets the market digest what it has (and the rescue/de-risking paths work
  // the distressed back to health) before another chain lands, which converts the
  // overshoot-and-crash into a stable equilibrium at the sustainable count. The
  // 12% bar rides just above ordinary churn (a firm or two transiently in the red)
  // and trips as soon as a wave of thin new entrants starts bleeding. City never
  // reaches a firm density where this binds; Village never enters this path.
  const unhealthy = Object.values(state.firms).filter(
    (f) => f.ownerType === 'ai' && f.bankruptcyStatus !== 'healthy',
  ).length;
  if (aiCount > 0 && unhealthy / aiCount > 0.12) return false;
  // Enter the MOST-STARVED qualifying staple, not merely the first in product
  // order (A5). The old fixed-order scan always founded on bread whenever bread
  // qualified, so bread stacked competitors while later staples starved unseen —
  // the founder-scale probe caught clothes running a 100-140 day under-supply
  // streak on Metropolis with no founder ever answering it, because bread kept
  // winning the one-entry-per-cooldown budget. Picking the longest streak spreads
  // founders across the products that actually need them: each staple's own
  // demand supports its new firm, so the extra entries stay solvent instead of
  // over-crowding one market. Deterministic: streak length, tie-broken by the
  // fixed FOUNDER_PRODUCTS order (no rng). Single-product shortage tests are
  // unaffected — the lone starved staple is trivially the most-starved.
  let pick: string | null = null;
  let pickStreak = FOUNDER_UNDERSUPPLY_DAYS - 1; // must reach the threshold to enter
  for (const pid of founderProducts) {
    const streak = state.marketUndersupplyDays[pid] ?? 0;
    if (streak > pickStreak && affordable(pid)) {
      pick = pid;
      pickStreak = streak;
    }
  }
  if (pick) {
    foundFirm(ctx, pick, day, 'undersupply');
    state.lastUndersupplyEntryDay = day;
    return true;
  }
  return false;
}

// --- landlord row: a real-estate firm moves in when housing is chronically
// tight (Arc D2, HD4) ---------------------------------------------------------

/** Housing occupancy at or above which the town is "tight" — a landlord's
 * opportunity. Pinned by the real-estate probe (city/metropolis 300-day soaks):
 * a growing crowd city runs its home stock this full, and below this bar there
 * is slack the market can absorb without new development. */
const LANDLORD_OCCUPANCY_BAR = 0.92;
/** Consecutive tight days before a landlord founds — long enough that a
 * transient full week (immigration wave, a block briefly maxed) doesn't spawn a
 * rentals firm, short enough to answer a genuine chronic squeeze. Measured
 * against the soaks (see docs/design/real-estate.md). */
const LANDLORD_FOUNDER_DAYS = 15;
/** Town-wide minimum days between landlord entries, so a sustained squeeze
 * grows the housing stock a firm at a time rather than all at once. */
const LANDLORD_FOUNDER_COOLDOWN = 25;

const LANDLORD_NAMES = ['Cornerstone Properties', 'Meridian Estates', 'Brickyard Holdings'];
// --- investor row: the holdco founder (Arc D3, city-scale only) -------------

/**
 * Median trailing daily dividend yield across LISTED firms — the player and AI
 * firms that are healthy, actually earning (smoothed base > 0), and priced
 * (marketCap > 0). This is the same base/marketCap the operator's yield-buyer
 * and the DividendSystem read, aggregated to a town-wide spread. Returns 0 when
 * no firm qualifies (an empty or all-distressed field is not a holdco's market).
 * Sorted scan → deterministic; no rng.
 */
function medianListedYield(state: GameState): number {
  const yields: number[] = [];
  for (const fid of Object.keys(state.firms).sort()) {
    const f = state.firms[fid]!;
    if (f.ownerType !== 'player' && f.ownerType !== 'ai') continue;
    if (f.bankruptcyStatus !== 'healthy') continue;
    const base = smoothedProfitBase(f);
    if (base <= 0) continue;
    const mcap = marketCap(state, fid);
    if (mcap <= 0) continue;
    yields.push(base / mcap);
  }
  if (yields.length === 0) return 0;
  yields.sort((a, b) => a - b);
  const mid = Math.floor(yields.length / 2);
  return yields.length % 2 ? yields[mid]! : (yields[mid - 1]! + yields[mid]!) / 2;
}

function investorTrackSignals(ctx: SimContext): void {
  const { state } = ctx;
  // OPT-IN + CITY-SCALE ONLY. Double gate (mirroring the servicesEnabled + city
  // gate the B2B channel uses): the flag is OFF in every pinned baseline
  // (DEFAULT_CONFIG, the tier/founder/determinism soaks), so the streak counter
  // is never touched and no investor ever founds there — the city A3 crowd-tier
  // bands stay bit-identical to pre-D3. A holdco drains the firm sector buying
  // stakes against the public float, which would otherwise shift those bands.
  // Gated on === 'city' (not !== 'village'), so Metropolis is excluded too —
  // D3 is city-scale, and the pinned Metropolis founder soak is untouched.
  if (!state.config.investorsEnabled || state.config.sizePreset !== 'city') return;
  state.investorSignalDays =
    medianListedYield(state) >= INVESTOR_YIELD_BAR ? state.investorSignalDays + 1 : 0;
}

function investorTryFound(ctx: SimContext, town: FounderTownRead): boolean {
  const { state } = ctx;
  const { day, aiCount } = town;
  if (!state.config.investorsEnabled || state.config.sizePreset !== 'city') return false;
  // Sustained fat-yield spread, town-wide rate limit, and the same solvency
  // brake the under-supply row uses — capital doesn't spin up a holdco into a
  // field that is already cracking (the shared cap gate in the shell handles the
  // firm-count ceiling). The founder cap is respected by the shell before this
  // row is ever reached.
  if (state.investorSignalDays < INVESTOR_SIGNAL_DAYS) return false;
  if (day - state.lastInvestorEntryDay < INVESTOR_ENTRY_COOLDOWN) return false;
  const unhealthy = Object.values(state.firms).filter(
    (f) => f.ownerType === 'ai' && f.bankruptcyStatus !== 'healthy',
  ).length;
  if (aiCount > 0 && unhealthy / aiCount > 0.12) return false;

  foundInvestorFirm(ctx, day);
  state.lastInvestorEntryDay = day;
  return true;
}

/**
 * Found a landlord firm: a real-estate specialist that develops and rents
 * housing. Unlike a chain founder it builds no producer→factory→store — its
 * founding capital funds its first apartment block, sited near the residential
 * band, and its LandlordBehavior loop grows the stock from there. Money is
 * conserved: founding capital in from the world, the build cost straight back
 * out to it the same tick.
 */
function foundLandlordFirm(ctx: SimContext, day: number): void {
  const { state } = ctx;
  const aiCount = Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
  const name = LANDLORD_NAMES[hashPick(state.seed, day, LANDLORD_NAMES.length)]!;
  const personality = defaultPersonalityFor(aiCount);

  const id = nextId(state.idCounters, 'firm');
  const firm: Firm = {
    id,
    name,
    ownerType: 'ai',
    cash: 0,
    facilities: [],
    employees: [],
    pricesByProduct: {},
    wagePolicy: { baseWage: dollars(16) },
    accounting: emptyAccounting(),
    strategy: emptyStrategy('none', 'landlord'),
    bankruptcyStatus: 'healthy',
    daysInsolvent: 0,
    marketShareByProduct: {},
    createdAtTick: state.tick,
    personalityId: personality,
    ceoName: defaultCeoFor(personality, aiCount),
    brandByProduct: {},
    adBudgetByProduct: {},
    qualityByProduct: {},
    debt: 0,
    interestRatePerDay: 0.0009,
    sharesHeld: {},
    shareCostBasis: {},
    acquiredNames: [],
    autoPriceByProduct: {},
    exportRevenue: 0,
    exportRevenueByCity: {},
    wholesaleSpend: 0,
    wholesaleEarned: 0,
    managers: [],
    forwards: [],
    forwardWins: 0,
  };
  state.firms[id] = firm;

  recordTransaction(state, {
    from: WORLD_ACCOUNT, to: firmAccount(id), amount: founderCash(state.config),
    firmId: id, category: 'none', note: 'Founding capital',
  });

  // Break ground on the firm's first block immediately, so it enters as a real
  // landlord with an asset rather than an empty shell.
  const loc = {
    x: clamp(40 + (hashPick(state.seed, day + 5, 40) - 20), 8, state.config.mapWidth - 8),
    y: clamp(64 + (hashPick(state.seed, day + 9, 12) - 6), 8, state.config.mapHeight - 8),
  };
  const def = getFacilityDef('apartment');
  const mult = landCostMultiplier(landValueAt(state, loc));
  const cost = Math.round(def.buildCost * mult);
  const apt = createFacility(state, 'apartment', id, loc, { name: `${name.split(' ')[0]} Residences` });
  apt.buildCost = cost;
  apt.operatingCostPerDay = Math.round(def.maintenanceCostPerDay * mult);
  recordTransaction(state, {
    from: firmAccount(id), to: WORLD_ACCOUNT, amount: cost,
    firmId: id, category: 'buildSpend', note: 'Built apartment',
  });

  const ceo = firm.ceoName ? ` ${PERSONALITIES[personality]!.icon} ${firm.ceoName} runs it.` : '';
  emitEvent(state, 'info', 'economy',
    `📰 New landlord: ${name} moves into town to build housing — every home is full.${ceo}`, apt.id);
}

function landlordTrackSignals(ctx: SimContext): void {
  const { state } = ctx;
  // City-scale and channel-gated: Village and any flag-off pinned run never
  // touch the streak counter, so their trajectories are untouched.
  if (state.config.sizePreset === 'village' || !state.config.realEstateEnabled) return;
  state.housingTightDays =
    townHousingOccupancy(state) >= LANDLORD_OCCUPANCY_BAR ? state.housingTightDays + 1 : 0;
}

function landlordTryFound(ctx: SimContext, town: FounderTownRead): boolean {
  const { state } = ctx;
  const { day, aiCount } = town;
  // Channel + scale gate: the row is inert in every pinned baseline (Village
  // always; plain city/metropolis with realEstateEnabled off), so the operator
  // field's rng trajectory and the metropolis founder pins are untouched.
  if (!state.config.realEstateEnabled || !town.cityScale) return false;
  if (state.housingTightDays < LANDLORD_FOUNDER_DAYS) return false;
  if (day - state.lastLandlordEntryDay < LANDLORD_FOUNDER_COOLDOWN) return false;
  // Landlords share the town founder cap but must not crowd out the staple
  // operators that feed it: hold real-estate firms to ~1/6 of the cap (City 3,
  // Metropolis 5), so a chronic housing squeeze grows a rentals sector without
  // starving the chains. The founder-scale probe measured metro seed 7 stacking
  // 8 landlords (27% of a 30-cap map) without this brake.
  const landlordCount = Object.values(state.firms).filter(
    (f) => f.ownerType === 'ai' && f.strategy.archetype === 'landlord',
  ).length;
  if (landlordCount >= Math.max(2, Math.floor(founderMaxAiFirms(state.config) / 6))) return false;
  // A5 solvency brake (shared with the operator under-supply row): capital
  // stops entering a field whose incumbents are already distressed.
  const unhealthy = Object.values(state.firms).filter(
    (f) => f.ownerType === 'ai' && f.bankruptcyStatus !== 'healthy',
  ).length;
  if (aiCount > 0 && unhealthy / aiCount > 0.12) return false;

  foundLandlordFirm(ctx, day);
  state.lastLandlordEntryDay = day;
  state.housingTightDays = 0; // fresh stock relieves the squeeze; re-accrue
  return true;
}

// --- service row: a B2B service provider moves in where demand outruns supply --

/** Aggregate uncovered seats (town desired − provider capacity) above which a
 * service counts as under-provisioned for the day. ~15 seats ≈ a third of an L1
 * datacenter / most of an L1 office — a real, provider-sized gap, not noise. */
const SERVICE_FOUNDER_SEAT_BAR = 15;
/** Consecutive under-provisioned days before a provider founds — long enough that
 * a transient spike (a few new firms) doesn't summon a datacenter. */
const SERVICE_FOUNDER_DAYS = 20;
/** Town-wide days between service-provider entries — paces the market like the
 * under-supply cooldown so one shock doesn't spawn four datacenters. */
const SERVICE_FOUNDER_COOLDOWN = 25;

/** Provider-name pools per service, picked by hash — flavor, not mechanics. */
const SERVICE_FOUNDER_NAMES: Record<string, string[]> = {
  compute: ['Nimbus Compute', 'Helix Dataworks', 'Stratus Compute'],
  consulting: ['Vantage Advisory', 'Meridian Consulting', 'Keystone Advisory'],
};

/** Aggregate uncovered seat demand for one service across the whole town:
 * everyone's seat demand minus every provider's capacity, floored at 0. */
function uncoveredSeats(state: GameState, serviceId: string): number {
  const def = getServiceDef(serviceId);
  let desired = 0;
  let capacity = 0;
  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.ownerType !== 'ai' && firm.ownerType !== 'player') continue;
    // A provider's own facilities don't create consumer demand (it never
    // subscribes), so count operator/subscriber-side demand only.
    if (firm.strategy.archetype !== 'service') {
      desired += seatDemand(firm.employees.length, firm.facilities.length);
    }
    capacity += serviceCapacity(state, firm, def);
  }
  return Math.max(0, desired - capacity);
}

function serviceTrackSignals(ctx: SimContext): void {
  const { state } = ctx;
  // City-scale + services-flag ONLY. Off-flag / Village never touches the counter
  // map, so those states stay byte-identical (the map is never even created).
  if (!state.config.servicesEnabled || state.config.sizePreset === 'village') return;
  for (const serviceId of SERVICE_IDS) {
    state.serviceUncoveredDays[serviceId] =
      uncoveredSeats(state, serviceId) > SERVICE_FOUNDER_SEAT_BAR
        ? (state.serviceUncoveredDays[serviceId] ?? 0) + 1
        : 0;
  }
}

function foundServiceFirm(ctx: SimContext, serviceId: string, day: number): boolean {
  const { state } = ctx;
  const aiCount = Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
  const pool = SERVICE_FOUNDER_NAMES[serviceId] ?? [`New ${serviceId} Co`];
  const name = pool[hashPick(state.seed, day, pool.length)]!;
  const personality = defaultPersonalityFor(aiCount);

  const id = nextId(state.idCounters, 'firm');
  const firm: Firm = {
    id,
    name,
    ownerType: 'ai',
    cash: 0,
    facilities: [],
    employees: [],
    pricesByProduct: {},
    wagePolicy: { baseWage: dollars(16) },
    accounting: emptyAccounting(),
    strategy: emptyStrategy('none', 'service'),
    bankruptcyStatus: 'healthy',
    daysInsolvent: 0,
    marketShareByProduct: {},
    createdAtTick: state.tick,
    personalityId: personality,
    ceoName: defaultCeoFor(personality, aiCount),
    brandByProduct: {},
    adBudgetByProduct: {},
    qualityByProduct: {},
    debt: 0,
    interestRatePerDay: 0.0009,
    sharesHeld: {},
    shareCostBasis: {},
    acquiredNames: [],
    autoPriceByProduct: {},
    exportRevenue: 0,
    exportRevenueByCity: {},
    wholesaleSpend: 0,
    wholesaleEarned: 0,
    managers: [],
    forwards: [],
    forwardWins: 0,
  };
  state.firms[id] = firm;

  // Founding capital arrives from outside the town — conserved.
  recordTransaction(state, {
    from: WORLD_ACCOUNT, to: firmAccount(id), amount: founderCash(state.config),
    firmId: id, category: 'none', note: 'Founding capital',
  });

  // Build its first service facility (a pure-margin provider — deliberately
  // unstaffed, like the seeded Cirrus, so wages never sink a thin seat margin).
  if (!foundServiceFacility(ctx, id, serviceId)) {
    // Couldn't afford the facility with buffer: return the capital and dissolve.
    recordTransaction(state, {
      from: firmAccount(id), to: WORLD_ACCOUNT, amount: firm.cash,
      firmId: id, category: 'none', note: 'Founding abandoned',
    });
    delete state.firms[id];
    return false;
  }

  state.serviceUncoveredDays[serviceId] = 0;
  const def = getServiceDef(serviceId);
  const ceo = firm.ceoName ? ` ${PERSONALITIES[personality]!.icon} ${firm.ceoName} arrives to run it.` : '';
  emitEvent(state, 'info', 'economy',
    `📰 New service: ${name} opens to sell ${def.label} seats — demand had outrun the city's providers.${ceo}`,
    firm.id);
  return true;
}

function serviceTryFound(ctx: SimContext, town: FounderTownRead): boolean {
  const { state } = ctx;
  const { day, aiCount } = town;
  if (!state.config.servicesEnabled || state.config.sizePreset === 'village') return false;
  if (day - state.lastServiceEntryDay < SERVICE_FOUNDER_COOLDOWN) return false;
  // Solvency brake (mirrors the operator under-supply row): don't add a provider
  // while a meaningful share of the field is already distressed.
  const unhealthy = Object.values(state.firms).filter(
    (f) => f.ownerType === 'ai' && f.bankruptcyStatus !== 'healthy',
  ).length;
  if (aiCount > 0 && unhealthy / aiCount > 0.12) return false;
  // Enter the MOST under-provisioned service whose streak has cleared the bar.
  // Deterministic: streak length, tie-broken by the fixed SERVICE_IDS order.
  let pick: string | null = null;
  let pickStreak = SERVICE_FOUNDER_DAYS - 1; // must reach the threshold to enter
  for (const serviceId of SERVICE_IDS) {
    const streak = state.serviceUncoveredDays[serviceId] ?? 0;
    if (streak > pickStreak) {
      pick = serviceId;
      pickStreak = streak;
    }
  }
  if (!pick) return false;
  // An abandoned founding (couldn't afford the facility with buffer) must not
  // consume the cooldown window or the day's founding slot — the operator row
  // verifies affordability before claiming, and this row now matches (review
  // finding: a failed entry silently delayed relief of a persistent shortage).
  if (!foundServiceFirm(ctx, pick, day)) return false;
  state.lastServiceEntryDay = day;
  return true;
}

/**
 * The founder archetype table (Arc D1 scaffold; Arc D4 adds the service row).
 * Operator first (staple vacancy + under-supply), then service (a B2B provider
 * where a service's demand outruns town capacity). D2–D3 append landlord/investor
 * rows — each with its own trackSignals + tryFound. The shell iterates in table
 * order (operator claims the day's single slot first), so adding a row is additive
 * and leaves the earlier rows untouched. The service row is inert unless
 * servicesEnabled + city-scale, so no services-off baseline can hit it.
 */
const FOUNDER_ARCHETYPES: FounderArchetype[] = [
  { archetype: 'operator', trackSignals: operatorTrackSignals, tryFound: operatorTryFound },
  { archetype: 'landlord', trackSignals: landlordTrackSignals, tryFound: landlordTryFound },
  { archetype: 'investor', trackSignals: investorTrackSignals, tryFound: investorTryFound },
  { archetype: 'service', trackSignals: serviceTrackSignals, tryFound: serviceTryFound },
];

export function runAIFounderSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  const day = ctx.time.day;

  // Every archetype refreshes its opportunity signals each day, before any
  // gate — streaks must accrue during the pre-earliest window too.
  for (const row of FOUNDER_ARCHETYPES) row.trackSignals(ctx);

  // --- shared entry gates (apply to any archetype's founding) --------------
  if (day < FOUNDER_EARLIEST_DAY) return;
  // The population gate reads the WHOLE town (cast + crowd) so a small, starved
  // cast can't stop capital from answering 300 hungry cohort-shoppers. Village:
  // crowd is empty, so this is the cast headcount, exactly as before.
  const { pop, avgSat } = townPopAndSat(state);
  if (pop < FOUNDER_MIN_POPULATION) return;
  const aiCount = Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
  if (aiCount >= founderMaxAiFirms(state.config)) return;
  const cityScale = state.config.sizePreset !== 'village';
  // World-cash gate — VILLAGE ONLY (A5). The world account is the town's
  // source/sink; at crowd scale it legitimately runs a structural deficit
  // (subsistence to a large idle crowd), so the founder-scale probe found a
  // Metropolis world balance sitting BELOW the $22k founding cash for ~200 of
  // 300 days — the gate was choking the very foundings that would employ the
  // crowd and relieve the drain, while a screaming shortage went unanswered
  // (fill-rate 0.2-0.5). Founding is money-conserved (the firm pays land costs
  // straight back the same tick, and export revenue keeps flowing out to the
  // world), so a negative world balance is not insolvency — the probe confirms
  // conservation holds to the cent throughout. Village keeps the guard exactly:
  // its world account stays flush and its founder tests pin this path.
  const cash = founderCash(state.config);
  if (!cityScale && state.worldCash < cash) return;

  // At most one founding per day, town-wide: the first archetype to claim the
  // slot ends the scan, and rows are tried in table order (operator first, so
  // staple coverage always outranks specialist entries).
  const town: FounderTownRead = { day, avgSat, aiCount, cityScale, cash };
  for (const row of FOUNDER_ARCHETYPES) {
    if (row.tryFound(ctx, town)) return;
  }
}
