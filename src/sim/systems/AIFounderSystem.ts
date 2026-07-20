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
import { recordTransaction, emitEvent } from '../core/GameState';
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
  FOUNDER_MAX_AI_FIRMS,
  FOUNDER_MIN_POPULATION,
  FOUNDER_CASH,
  dollars,
} from '../data/constants';

/** Staples a founder will move in on. Coffee and luxury stay with the
 * existing late-game AI entries — this system fills the basic gaps. */
export const FOUNDER_PRODUCTS = ['bread', 'tools', 'clothes'] as const;

/** Firm-name pools per product, picked by hash — flavor, not mechanics. */
const FOUNDER_NAMES: Record<string, string[]> = {
  bread: ['Prairie Oven Co', 'Hearthstone Baking', 'Miller & Crumb'],
  tools: ['Anvil Brothers', 'Keystone Toolworks', 'Ridgeline Forge Co'],
  clothes: ['Thimble & Cloth', 'Meridian Garment Co', 'Weaver House'],
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

function foundFirm(state: GameState, productId: string, day: number): void {
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
    strategy: emptyStrategy(productId as Firm['strategy']['kind']),
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

  // Founding capital arrives from outside the town — conserved.
  recordTransaction(state, {
    from: WORLD_ACCOUNT, to: firmAccount(id), amount: FOUNDER_CASH,
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

  state.marketGapDays[productId] = 0;
  const ceo = firm.ceoName ? ` ${PERSONALITIES[personality]!.icon} ${firm.ceoName} arrives to run it.` : '';
  emitEvent(state, 'info', 'economy',
    `📰 New competition: ${name} moves into town to sell ${getProduct(productId).name.toLowerCase()} — nobody else would.${ceo}`,
    built.store.id);
}

export function runAIFounderSystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  const day = ctx.time.day;

  // Track the gaps every day (cheap, and the counters read well in debug).
  for (const pid of FOUNDER_PRODUCTS) {
    state.marketGapDays[pid] = soldSomewhere(state, pid)
      ? 0
      : (state.marketGapDays[pid] ?? 0) + 1;
  }

  if (day < FOUNDER_EARLIEST_DAY) return;
  const cits = Object.values(state.citizens);
  if (cits.length < FOUNDER_MIN_POPULATION) return;
  const avgSat = cits.reduce((a, c) => a + c.satisfaction, 0) / cits.length;
  if (avgSat < IMMIGRATION_MIN_SATISFACTION) return;
  const aiCount = Object.values(state.firms).filter((f) => f.ownerType === 'ai').length;
  if (aiCount >= FOUNDER_MAX_AI_FIRMS) return;
  if (state.worldCash < FOUNDER_CASH) return;
  if (!founderRoll(state.seed, day)) return;

  // One entry per day: the first persistent gap in fixed product order.
  for (const pid of FOUNDER_PRODUCTS) {
    if ((state.marketGapDays[pid] ?? 0) >= FOUNDER_GAP_DAYS && CHAIN_BLUEPRINTS[pid]) {
      if (FOUNDER_CASH >= Math.round(chainCost(CHAIN_BLUEPRINTS[pid]!) * 1.2)) {
        foundFirm(state, pid, day);
      }
      return;
    }
  }
}
