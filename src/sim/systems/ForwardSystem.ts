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
/**
 * Fee to close a forward early, as a share of the position's locked notional —
 * the same friction idiom as a share trade (SHARE_TRADE_FEE, 3%), paid to the
 * world. Early exit at the mark is far cheaper than the 15% deliberate-default,
 * but not free: the desk still takes its cut for unwinding the paper.
 */
export const FORWARD_CLOSE_FEE = 0.03;

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

/**
 * Mark-to-market value of an open short forward: the locked-price advantage
 * over selling the same goods at today's city quote, freight-adjusted —
 * `(lockedPrice − cityPrice) × (1 − freight) × qty`. Positive = the lock is
 * still in the money (the market fell below it); negative = the market ran
 * past the lock and the position is underwater. This mirrors settlement: a
 * firm that delivers owned goods nets `lockedPrice × (1 − freight) × qty`,
 * exactly `mark` more than it would get selling those goods spot today, so
 * closing at the mark and holding to settlement are economically equivalent.
 */
export function forwardMark(state: GameState, fwd: { productId: ProductId; quantity: number; cityId: string; lockedPrice: number }): number {
  const freight = exportFreightFee(state, fwd.cityId);
  const spot = cityPrice(state, fwd.cityId, fwd.productId);
  return Math.round((fwd.lockedPrice - spot) * (1 - freight) * fwd.quantity);
}

/**
 * Close an open forward early, cash-settling it at the mark instead of riding
 * to delivery (or eating the 15% deliberate-default). Releasing the hedge un-
 * softens the city quote FIRST (the mirror of the impact signing applied), so
 * the mark is read against the market without this firm's own footprint — a
 * sign-then-close round trip nets the spread it paid, not a free gain. A 3%
 * notional fee (the share-trade idiom) is taken to the world. All settlement
 * is via recordTransaction, so money stays conserved. Returns true on success.
 */
export function closeForward(state: GameState, firmId: FirmId, forwardId: string): boolean {
  const firm = state.firms[firmId];
  if (!firm) return false;
  const fwd = firm.forwards.find((f) => f.id === forwardId);
  if (!fwd) return false;
  const product = getProduct(fwd.productId);
  const city = getTradeCity(fwd.cityId);

  // Release the hedged demand back to the book before marking (signing pushed
  // the quote down with direction -1; closing restores it with +1). Snapshot
  // the raw quote first: applyPriceImpact rounds and clamps, so +1 then -1 is
  // NOT an exact round trip — a rejected close must restore the snapshot, or
  // repeated unaffordable CLOSE_FORWARD dispatches would ratchet the quote
  // down for free (review finding).
  const book = state.tradeCities[fwd.cityId];
  const quoteBefore = book?.pricesByProduct[fwd.productId];
  applyPriceImpact(state, fwd.cityId, fwd.productId, fwd.quantity, 1);

  const mark = forwardMark(state, fwd);
  const fee = Math.round(fwd.lockedPrice * fwd.quantity * FORWARD_CLOSE_FEE);

  // A firm can't be forced to close into insolvency: the net cash effect is
  // mark − fee (the mark is settled before the fee, so a winning close is
  // always affordable even from zero cash). A losing close is rejected only if
  // it would push the firm negative.
  if (firm.cash + mark - fee < 0) {
    emitEvent(state, 'warning', 'finance',
      `${city.emoji} ${firm.name} can't afford to close its ${product.name} forward (${formatMoney(fee - mark - firm.cash)} short).`, firmId);
    // Restore the exact pre-close quote so a rejected close leaves the book
    // byte-identical.
    if (book) {
      if (quoteBefore === undefined) delete book.pricesByProduct[fwd.productId];
      else book.pricesByProduct[fwd.productId] = quoteBefore;
    }
    return false;
  }

  firm.forwards = firm.forwards.filter((f) => f.id !== forwardId);

  if (mark > 0) {
    recordTransaction(state, {
      from: WORLD_ACCOUNT, to: firmAccount(firmId), amount: mark,
      firmId, category: 'revenue', productId: fwd.productId,
      note: `Closed forward at mark (+${formatMoney(mark)}) on ${fwd.quantity} ${product.name} to ${city.name}`,
    });
  } else if (mark < 0) {
    recordTransaction(state, {
      from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: -mark,
      firmId, category: 'logistics', productId: fwd.productId,
      note: `Closed forward at mark (${formatMoney(mark)}) on ${fwd.quantity} ${product.name} to ${city.name}`,
    });
  }
  if (fee > 0) {
    recordTransaction(state, {
      from: firmAccount(firmId), to: WORLD_ACCOUNT, amount: fee,
      firmId, category: 'logistics', productId: fwd.productId,
      note: `Forward close fee (${formatMoney(fee)})`,
    });
  }
  emitEvent(state, mark >= 0 ? 'success' : 'info', 'finance',
    `${city.emoji} ${firm.name} closed its ${fwd.quantity} ${product.name} forward to ${city.name} at mark — ${formatMoney(mark)} P&L (${formatMoney(fee)} fee).`, firmId);
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
