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
import type { Firm } from '../entities/Firm';
import { emptyStrategy } from '../entities/Firm';
import { emptyAccounting } from '../entities/Accounting';
import { getProduct } from '../data/products';
import { CHAIN_BLUEPRINTS, chainCost } from '../data/chains';
import { defaultPersonalityFor, defaultCeoFor, PERSONALITIES } from '../data/personalities';
import { buildStarterChain } from '../core/ChainBuilder';
import { soldSomewhere } from './SatisfactionSystem';
import {
  IMMIGRATION_MIN_SATISFACTION,
  FOUNDER_EARLIEST_DAY,
  FOUNDER_GAP_DAYS,
  FOUNDER_DAILY_CHANCE,
  FOUNDER_MIN_POPULATION,
  FOUNDER_UNDERSUPPLY_WINDOW,
  FOUNDER_UNDERSUPPLY_DAYS,
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
    wagePolicy: { baseWage: dollars(16) },
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

export function runAIFounderSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  const day = ctx.time.day;
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

  if (day < FOUNDER_EARLIEST_DAY) return;
  // The population gate reads the WHOLE town (cast + crowd) so a small, starved
  // cast can't stop capital from answering 300 hungry cohort-shoppers. Village:
  // crowd is empty, so this is the cast headcount, exactly as before.
  const { pop, avgSat } = townPopAndSat(state);
  if (pop < FOUNDER_MIN_POPULATION) return;
  const aiCount = Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
  if (aiCount >= founderMaxAiFirms(state.config)) return;
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

  const affordable = (pid: string): boolean =>
    !!CHAIN_BLUEPRINTS[pid] && cash >= Math.round(chainCost(CHAIN_BLUEPRINTS[pid]!) * 1.2);

  // (1) Total-vacancy entry (unchanged): hash-gated daily, the first persistent
  // gap in fixed product order. Keeps the classic "don't chase a struggling
  // town" satisfaction CEILING — an empty shelf in an unhappy town is the
  // player's to claim first (this is the gate the Village founder tests pin).
  // One entry per day; returns once a qualifying gap is found (whether or not
  // it can afford to build it).
  if (avgSat >= IMMIGRATION_MIN_SATISFACTION && founderRoll(state.seed, day)) {
    for (const pid of founderProducts) {
      if ((state.marketGapDays[pid] ?? 0) >= FOUNDER_GAP_DAYS && CHAIN_BLUEPRINTS[pid]) {
        if (affordable(pid)) foundFirm(ctx, pid, day, 'vacancy');
        return;
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
  if (!cityScale) return;
  if (day - state.lastUndersupplyEntryDay < founderUndersupplyCooldown(state.config)) return;
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
  if (aiCount > 0 && unhealthy / aiCount > 0.12) return;
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
  }
}
