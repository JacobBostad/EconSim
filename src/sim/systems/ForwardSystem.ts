/**
 * ForwardSystem — forward-contract settlement for the commodity desk
 * (docs/design/commodity-market.md, Phase 2).
 *
 * SELL_FORWARD locks today's gross city price for delivery by a deadline
 * 3–10 days out. This is shorting with a delivery truck: lock a 1.5×
 * spike now, buy the dip later, deliver at the locked price. Settlement
 * runs at the day boundary and is a pure function of state — no rng — so
 * inserting this system re-deals nothing.
 *
 * On the due day: goods staged in the firm's warehouses (input or output)
 * are pulled and paid at lockedPrice minus THAT day's freight (freight
 * risk stays live — a fuel spike eats margin). Short on goods = partial
 * delivery for the staged part plus a default penalty of 15% of the
 * undelivered value — walking away from a signed contract has a price.
 */

import type { SimContext, GameState } from '../core/GameState';
import { emitEvent, recordTransaction } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { isDayBoundary } from '../core/Tick';
import { nextId } from '../core/Id';
import type { FirmId, ProductId } from '../core/Id';
import { getProduct } from '../data/products';
import { getTradeCity } from '../data/tradeCities';
import { getQuantity, removeStock } from '../entities/Inventory';
import { cityPrice, exportFreightFee, applyPriceImpact, impactedFillPrice } from '../core/Trade';
import { formatMoney } from '../../utils/formatMoney';

export const FORWARD_MAX_OPEN = 2;
export const FORWARD_MAX_QTY = 200;
export const FORWARD_MIN_DAYS = 3;
export const FORWARD_MAX_DAYS = 10;
export const FORWARD_DEFAULT_PENALTY = 0.15;
/** The locked multiple that counts as a genuine spike (achievement bar). */
export const FORWARD_WIN_MULT = 1.3;

/** Sign a forward: lock today's gross city price for delivery by `deliveryDay`. */
export function sellForward(
  state: GameState,
  firmId: FirmId,
  productId: ProductId,
  quantity: number,
  cityId: string,
  deliveryDay: number,
  currentDay: number,
): boolean {
  const firm = state.firms[firmId];
  if (!firm) return false;
  if (firm.forwards.length >= FORWARD_MAX_OPEN) return false;
  const qty = Math.round(quantity);
  if (qty < 1 || qty > FORWARD_MAX_QTY) return false;
  const daysOut = deliveryDay - currentDay;
  if (daysOut < FORWARD_MIN_DAYS || daysOut > FORWARD_MAX_DAYS) return false;
  // The lock fills down the impact curve like any big order.
  const locked = Math.round(impactedFillPrice(cityPrice(state, cityId, productId), qty, -1));
  firm.forwards.push({
    id: nextId(state.idCounters, 'fwd'),
    productId, quantity: qty, cityId, lockedPrice: locked, deliveryDay,
  });
  // The city has hedged that demand — its live quote softens immediately,
  // so stacking forwards on one spike self-defeats like any big trade.
  applyPriceImpact(state, cityId, productId, qty, -1);
  const city = getTradeCity(cityId);
  emitEvent(state, 'info', 'finance',
    `${city.emoji} ${firm.name} signs a forward: ${qty} ${getProduct(productId).name} to ${city.name} by day ${deliveryDay} at ${formatMoney(locked)}/unit locked.`, firmId);
  return true;
}

export function runForwardSystem(ctx: SimContext): void {
  const { state } = ctx;
  if (!isDayBoundary(state.tick, ctx.config)) return;
  const day = ctx.time.day;

  for (const fid in state.firms) {
    const firm = state.firms[fid]!;
    if (firm.forwards.length === 0) continue;
    for (const fwd of [...firm.forwards]) {
      if (fwd.deliveryDay > day) continue;
      firm.forwards = firm.forwards.filter((f) => f.id !== fwd.id);
      const city = getTradeCity(fwd.cityId);
      const product = getProduct(fwd.productId);

      // Pull staged goods across the firm's warehouses.
      let pulled = 0;
      for (const facId of firm.facilities) {
        if (pulled >= fwd.quantity) break;
        const fac = state.facilities[facId];
        if (!fac || fac.type !== 'warehouse') continue;
        for (const inv of [fac.inputInventory, fac.outputInventory]) {
          if (pulled >= fwd.quantity) break;
          const have = getQuantity(inv, fwd.productId);
          if (have <= 0) continue;
          const take = Math.min(have, fwd.quantity - pulled);
          removeStock(inv, fwd.productId, take);
          pulled += take;
        }
      }

      if (pulled > 0) {
        const net = Math.round(fwd.lockedPrice * (1 - exportFreightFee(state, fwd.cityId)));
        recordTransaction(state, {
          from: WORLD_ACCOUNT, to: firmAccount(fid), amount: net * pulled,
          firmId: fid, category: 'revenue', productId: fwd.productId, quantity: pulled,
          note: `Forward delivered: ${pulled} ${product.name} to ${city.name} @ ${formatMoney(net)} locked-net`,
        });
        if (fwd.lockedPrice >= product.basePrice * FORWARD_WIN_MULT) {
          firm.forwardWins += 1;
        }
      }
      const missed = fwd.quantity - pulled;
      if (missed > 0) {
        const penalty = Math.round(fwd.lockedPrice * missed * FORWARD_DEFAULT_PENALTY);
        recordTransaction(state, {
          from: firmAccount(fid), to: WORLD_ACCOUNT, amount: penalty,
          firmId: fid, category: 'logistics', productId: fwd.productId,
          note: `Forward default: ${missed} ${product.name} short to ${city.name}`,
        });
        emitEvent(state, 'warning', 'finance',
          `${city.emoji} ${firm.name} came up ${missed} ${product.name} short on a forward to ${city.name} — ${formatMoney(penalty)} default penalty.`, fid);
      } else {
        const mult = fwd.lockedPrice / product.basePrice;
        emitEvent(state, 'success', 'finance',
          `${city.emoji} Forward delivered — ${fwd.quantity} ${product.name} to ${city.name} at the locked ${mult.toFixed(2)}× price.`, fid);
      }
    }
  }
}
