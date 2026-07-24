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
import { townOf } from '../core/Town';
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
import {
  poolConsumptionPerDay,
  poolLocalProductionPerDay,
  poolTargetInventory,
} from '../data/tradePool';
import { clamp } from '../../utils/clamp';
import { getQuantity } from '../entities/Inventory';
import { performExport, pickBestCity } from '../core/Trade';
import { isLivePartnerCity } from '../core/PartnerMarket';
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
 * Arc E (opt-in): each trade city is TWO-SIDED. Every day it eats its ration
 * (`drain`), its OWN producers make a fraction of that consumption (`localProd`
 * — the step-2 supply side, unthrottled: the stub town's economy), and IMPORTS
 * (the throttleable restock tender) cover only the REMAINING gap — the
 * consumption production doesn't meet, plus the pull back to the target buffer.
 *
 * Imports never go negative (a city doesn't ship its own glut away — that would
 * erase an export overhang the same day), so a deep overhang can only work off
 * through consumption-minus-production: a port that SELF-SUPPLIES a good keeps
 * its shelf full and a dump there lingers hard/long, while a port that IMPORTS
 * it absorbs the dump fast — the specialization the arc is about. Equilibrium is
 * untouched by the supply side: at inv = target with no tender, imports =
 * (drain − localProd) exactly replaces the consumption production doesn't, so a
 * seeded-at-target pool still quotes mult 1.0 day to day (only SHOCKED
 * trajectories diverge from step 1). A pre-announced TENDER (annMult > 1)
 * throttles the imports so the larder runs down and the headline shock bites
 * through real cover — biting HARDEST on goods the city under-produces (it can't
 * self-supply the shortfall) and barely on those it makes itself.
 *
 * The changed cover is read by cityPrice; this loop moves stock only — no money
 * (production is the town's own economy, cash-free like consumption), no shared
 * rng, sorted-product iteration. Absent the pool (flag off) it never runs.
 */
function updatePools(ctx: SimContext): void {
  const { state } = ctx;
  for (const cid of TRADE_CITY_IDS) {
    // A LIVE partner (slice 5) has RETIRED its pool: its export larder is real
    // shelf stock refilled by PartnerMarketSystem, so it carries no `pool` row to
    // tick here. `updatePools` is the STUB-city supply side only (ironvale, and a
    // flag-off port_rosa where the pool row stays). The `!pool` guard already
    // skips a live partner (it has no pool); this is the explicit statement of it.
    if (isLivePartnerCity(state, cid)) continue;
    const pool = state.tradeCities[cid]?.pool;
    if (!pool) continue;
    for (const pid of PRODUCT_IDS_BY_PRESET[state.config.sizePreset]) {
      const inv = pool.inventory[pid];
      if (inv === undefined) continue; // a product this city doesn't consume
      const drain = poolConsumptionPerDay(cid, pid);
      const localProd = poolLocalProductionPerDay(cid, pid);
      const target = poolTargetInventory(cid, pid);
      const annMult = tradeAnnouncementMult(state, cid, pid, ctx.time.day);
      const throttle = annMult > 1 ? TRADE_POOL_SHORTAGE_THROTTLE : 1;
      const imports =
        Math.max(0, drain - localProd + (target - inv) * TRADE_POOL_REPLENISH_RATE) * throttle;
      pool.inventory[pid] = Math.max(0, inv - drain + localProd + imports);
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
  const town = townOf(state, ctx.townId);
  for (const fid in town.facilities) {
    const fac = town.facilities[fid]!;
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
