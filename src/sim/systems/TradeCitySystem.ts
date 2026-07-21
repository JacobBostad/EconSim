/**
 * TradeCitySystem — the distant trade cities (Port Rosa, Ironvale).
 *
 * Each city is an off-map market with its own price for every product,
 * updated once per day as a bounded, seeded random walk around a per-city
 * center: base price × world-event shift × the city's product bias (Ironvale
 * pays up for industry, discounts food). Goods staged in a warehouse can be
 * EXPORTed at a city's price minus its freight fee — classic arbitrage:
 * stockpile when local goods are cheap, ship to whichever port pays.
 *
 * Both cities share one jitter draw per product with opposite signs, so the
 * walks are anti-correlated: spreads between the ports open and close, and
 * the rng stream stays identical to the single-city era (save-compatible
 * determinism).
 *
 * Threshold crossings (boom above 1.45× the city's center, glut below 0.7×)
 * are announced in the event log so the Gazette carries trade news.
 */

import type { SimContext } from '../core/GameState';
import { emitEvent } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import { PRODUCT_IDS_BY_PRESET, getProduct } from '../data/products';
import {
  TRADE_PRICE_MIN_MULT,
  TRADE_PRICE_MAX_MULT,
  TRADE_WALK_STEP,
  TRADE_BOOM_MULT,
  TRADE_GLUT_MULT,
  TRADE_POOL_REPLENISH_RATE,
  TRADE_POOL_SHORTAGE_THROTTLE,
} from '../data/constants';
import { poolConsumptionPerDay, poolTargetInventory } from '../data/tradePool';
import { clamp } from '../../utils/clamp';
import { getQuantity } from '../entities/Inventory';
import { performExport, pickBestCity } from '../core/Trade';
import { worldTradePriceMult } from '../data/worldEvents';
import { tradeAnnouncementMult } from './TradeAnnouncementSystem';
import { TRADE_CITY_IDS, getTradeCity, cityBias } from '../data/tradeCities';

/** Daily reversion strength toward the (event-shifted) price center. */
const TRADE_CENTER_PULL = 0.12;

export function runTradeCitySystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  updatePrices(ctx);
  updatePools(ctx);
  runStandingOrders(ctx);
}

/**
 * Arc E (opt-in): each trade city eats its daily ration and its own producers/
 * importers restock toward a target buffer — the net is a gentle pull of stock
 * back to target, so an export overhang (piled in at export time) works off over
 * ~a week and a shortfall refills. A pre-announced TENDER (annMult > 1 — a
 * demand crunch) throttles that restock, so the city's larder genuinely runs
 * down and the headline shock bites through real cover, not just the walk
 * center. The changed cover is read by cityPrice; this loop moves stock only —
 * no money, no shared rng, sorted-product iteration. Absent the pool (flag off)
 * it never runs — there is nothing to iterate.
 */
function updatePools(ctx: SimContext): void {
  const { state } = ctx;
  for (const cid of TRADE_CITY_IDS) {
    const pool = state.tradeCities[cid]?.pool;
    if (!pool) continue;
    for (const pid of PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
      const inv = pool.inventory[pid];
      if (inv === undefined) continue; // a product this city doesn't consume
      const drain = poolConsumptionPerDay(cid, pid);
      const target = poolTargetInventory(cid, pid);
      const annMult = tradeAnnouncementMult(state, cid, pid, ctx.time.day);
      const throttle = annMult > 1 ? TRADE_POOL_SHORTAGE_THROTTLE : 1;
      const restock = (drain + (target - inv) * TRADE_POOL_REPLENISH_RATE) * throttle;
      pool.inventory[pid] = Math.max(0, inv - drain + restock);
    }
  }
}

function updatePrices(ctx: SimContext): void {
  const { state } = ctx;

  // Preset-gated (C1): the shared-rng price walk draws exactly one jitter per
  // product PRESENT at this preset — Village walks only the classic catalog, so
  // its draw count and order (hence rngState) are byte-identical to pre-C1.
  for (const pid of PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
    const base = getProduct(pid).basePrice;
    // One rng draw per product, shared by all cities (see header).
    const jitter = ctx.rng.jitter(TRADE_WALK_STEP);

    for (const cid of TRADE_CITY_IDS) {
      const city = getTradeCity(cid);
      const book = state.tradeCities[cid] ?? (state.tradeCities[cid] = { pricesByProduct: {} });
      const bias = cityBias(cid, pid);
      const prev = book.pricesByProduct[pid] ?? Math.round(base * bias);
      // Random walk with a gentle pull toward the event-shifted, city-biased
      // center: a drought makes ports pay up for grain, a recession discounts
      // everything — so world news is also trade news.
      const annMult = tradeAnnouncementMult(state, cid, pid, ctx.time.day);
      const center = base * worldTradePriceMult(state, pid) * bias * annMult;
      const walked = prev * (1 + jitter * city.walkSign);
      // Markets react to NEWS much faster than they drift: while an
      // announced shock is in effect, the pull is strong enough that the
      // quote reaches most of the headline move within a couple of days —
      // otherwise a "1.5×" tender would deliver ~1.2× and informed trading
      // couldn't beat round-trip friction (probed).
      const pull = annMult !== 1 ? 0.4 : TRADE_CENTER_PULL;
      const next = Math.round(
        clamp(
          walked + (center - walked) * pull,
          base * bias * TRADE_PRICE_MIN_MULT,
          base * bias * TRADE_PRICE_MAX_MULT,
        ),
      );
      book.pricesByProduct[pid] = next;

      const prevMult = prev / (base * bias);
      const nextMult = next / (base * bias);
      if (prevMult < TRADE_BOOM_MULT && nextMult >= TRADE_BOOM_MULT) {
        emitEvent(state, 'success', 'economy',
          `${city.emoji} ${city.name} is paying a premium for ${getProduct(pid).name} (${(next / base).toFixed(2)}× base) — exports are lucrative.`);
      } else if (prevMult > TRADE_GLUT_MULT && nextMult <= TRADE_GLUT_MULT) {
        emitEvent(state, 'info', 'economy',
          `${city.emoji} ${getProduct(pid).name} glut in ${city.name} — export prices have collapsed (${(next / base).toFixed(2)}× base).`);
      }
    }
  }
}

/**
 * Standing export orders: after the day's prices land, warehouses with a rule
 * "auto-export when ≥ minMult × base, keep N" sell their surplus hands-free —
 * routed to whichever city nets the most after freight.
 */
function runStandingOrders(ctx: SimContext): void {
  const { state } = ctx;
  for (const fid in state.facilities) {
    const fac = state.facilities[fid]!;
    if (fac.type !== 'warehouse') continue;
    for (const pid in fac.exportOrders) {
      const order = fac.exportOrders[pid]!;
      const base = getProduct(pid).basePrice;
      const best = pickBestCity(state, pid);
      if (best.price < base * order.minMult) continue;
      const have =
        getQuantity(fac.inputInventory, pid) + getQuantity(fac.outputInventory, pid);
      const qty = have - order.keep;
      if (qty <= 0) continue;
      performExport(state, fac.ownerFirmId, fac.id, pid, qty, 'Standing order shipped', best.cityId);
    }
  }
}
