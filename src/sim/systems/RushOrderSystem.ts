/**
 * RushOrderSystem — timed bulk-export contracts ("a buyer is assembling a
 * convoy: land N units at the ports by day D for a cash bonus").
 *
 * Offers roll daily once the player owns a warehouse (there's no way to
 * fulfill one without a staging point, so earlier offers would be noise).
 * The product is drawn from what the player can plausibly deliver — goods
 * already staged in their warehouses first, then goods their facilities
 * produce — and the bonus is locked at offer time from the best current
 * port quote, so the deal doesn't move under the player's feet.
 *
 * Randomness comes from a hash of (seed, day) rather than the shared sim
 * rng stream: rush orders are a bolt-on opportunity, and drawing from
 * ctx.rng would shift every downstream roll and re-deal long-calibrated
 * outcomes (playtest-bot floors, scenario probes) for no gameplay reason.
 * Same seed + same day still always gives the same offer.
 *
 * Fulfillment is counted in performExport (any port counts — the buyer
 * charters freight from wherever the goods land); expiry is handled here
 * at the day boundary after the deadline.
 */

import type { SimContext, GameState, RushOrder } from '../core/GameState';
import { emitEvent } from '../core/GameState';
import { isDayBoundary } from '../core/Tick';
import type { ProductId } from '../core/Id';
import { getProduct } from '../data/products';
import { getRecipe } from '../data/recipes';
import { pickBestCity } from '../core/Trade';
import { getTradeCity, TRADE_CITY_IDS } from '../data/tradeCities';
import { formatMoney } from '../../utils/formatMoney';

/** No offers before the town has had a chance to build anything. */
export const RUSH_EARLIEST_DAY = 12;
/** Daily offer chance once eligible (~one offer per ten eligible days). */
export const RUSH_DAILY_CHANCE = 0.1;
/** Days from offer to deadline (inclusive of the deadline day). */
export const RUSH_WINDOW_DAYS = 6;
/** Completion bonus as a share of the order's value at the best port quote. */
export const RUSH_BONUS_RATE = 0.35;

/** Independent deterministic stream per (seed, day) — see header. */
function rushRoll(seed: number, day: number, salt: number): number {
  let t = (seed ^ Math.imul(day + 1, 0x9e3779b9) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Products the player could plausibly deliver, best candidates first. */
function candidateProducts(state: GameState): ProductId[] {
  const staged = new Set<ProductId>();
  const produced = new Set<ProductId>();
  for (const fid in state.facilities) {
    const f = state.facilities[fid]!;
    if (f.ownerFirmId !== state.playerFirmId) continue;
    if (f.type === 'warehouse') {
      for (const inv of [f.inputInventory, f.outputInventory]) {
        for (const pid in inv) {
          if (inv[pid as ProductId]!.quantity > 0) staged.add(pid as ProductId);
        }
      }
    }
    // Only what the facility is actually running — a factory *could* switch
    // to jewelry, but an offer for it would just lapse as noise.
    if (f.activeRecipeId) {
      for (const out of getRecipe(f.activeRecipeId).outputs) produced.add(out.productId);
    }
  }
  const list = [...staged, ...[...produced].filter((p) => !staged.has(p))];
  return list.length > 0 ? list : (['bread', 'tools'] as ProductId[]);
}

export function runRushOrderSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  const day = ctx.time.day;

  const active = state.rushOrder;
  if (active) {
    if (day > active.deadlineDay) {
      state.rushOrdersMissed += 1;
      state.rushOrder = null;
      emitEvent(state, 'warning', 'economy',
        `${getTradeCity(active.cityId).emoji} The rush order lapsed — ${getTradeCity(active.cityId).name}'s buyer moved on with ${active.filled}/${active.quantity} ${getProduct(active.productId).name} delivered.`);
    }
    return; // one at a time
  }

  if (day < RUSH_EARLIEST_DAY) return;
  const hasWarehouse = Object.values(state.facilities).some(
    (f) => f.ownerFirmId === state.playerFirmId && f.type === 'warehouse',
  );
  if (!hasWarehouse) return;
  if (rushRoll(state.seed, day, 0) >= RUSH_DAILY_CHANCE) return;

  const candidates = candidateProducts(state);
  const productId = candidates[Math.floor(rushRoll(state.seed, day, 1) * candidates.length)]!;
  const cityId = TRADE_CITY_IDS[Math.floor(rushRoll(state.seed, day, 2) * TRADE_CITY_IDS.length)]!;
  // 30–90 units in steps of 5 — a real haul, but fillable: a single staffed
  // production line makes ~10-13/day, so six days plus staged stock covers
  // the top of the range without demanding a second line.
  const quantity = 30 + Math.floor(rushRoll(state.seed, day, 3) * 13) * 5;
  const quote = pickBestCity(state, productId);
  const bonusCents = Math.round(quantity * quote.price * RUSH_BONUS_RATE);

  const order: RushOrder = {
    cityId,
    productId,
    quantity,
    filled: 0,
    startDay: day,
    deadlineDay: day + RUSH_WINDOW_DAYS,
    bonusCents,
  };
  state.rushOrder = order;
  const city = getTradeCity(cityId);
  emitEvent(state, 'success', 'economy',
    `${city.emoji} Rush order from ${city.name}: deliver ${quantity} ${getProduct(productId).name} to the ports by day ${order.deadlineDay + 1} for a ${formatMoney(bonusCents)} bonus on top of export revenue.`);
}
