/**
 * InventorySystem — applies perishable spoilage once per day.
 *
 * Each day, perishable products lose a fraction of their stock equal to their
 * `perishability`. Spoiled units simply vanish (no cash effect — the cost was
 * already incurred when the goods were produced/purchased). This creates real
 * pressure to size inventory and pricing correctly rather than hoarding.
 */

import type { SimContext } from '../core/GameState';
import { townOf } from '../core/Town';
import { isDayBoundary } from '../core/Tick';
import { getProduct } from '../data/products';
import { removeStock, type Inventory } from '../entities/Inventory';

export function runInventorySystem(ctx: SimContext): void {
  if (!isDayBoundary(ctx.state.tick, ctx.config)) return;
  const { state } = ctx;
  const town = townOf(state, ctx.townId);
  for (const fid in town.facilities) {
    const fac = town.facilities[fid]!;
    if (fac.type === 'importer') continue; // importer buffer doesn't spoil
    spoil(fac.inputInventory);
    spoil(fac.outputInventory);
  }
}

function spoil(inv: Inventory): void {
  for (const pid in inv) {
    const stack = inv[pid]!;
    if (stack.quantity <= 0) continue;
    const perish = getProduct(pid).perishability;
    if (perish <= 0) continue;
    const lost = Math.floor(stack.quantity * perish);
    if (lost > 0) removeStock(inv, pid, lost);
  }
}
