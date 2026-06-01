/**
 * Inventory.ts — Inventory record types and helpers.
 *
 * An inventory is a map from ProductId to a stack with quantity and a quality
 * value (a running average for produced/blended goods). Inventory helpers are
 * pure functions that mutate the passed-in inventory object.
 */

import type { ProductId } from '../core/Id';

export interface InventoryStack {
  productId: ProductId;
  quantity: number;
  /** Average quality (0..100) of the units currently in the stack. */
  quality: number;
}

export type Inventory = Record<ProductId, InventoryStack>;

export function getQuantity(inv: Inventory, productId: ProductId): number {
  return inv[productId]?.quantity ?? 0;
}

export function getQuality(inv: Inventory, productId: ProductId): number {
  return inv[productId]?.quality ?? 0;
}

export function totalUnits(inv: Inventory): number {
  let sum = 0;
  for (const key in inv) sum += inv[key]!.quantity;
  return sum;
}

/** Add units, blending quality as a quantity-weighted average. */
export function addStock(
  inv: Inventory,
  productId: ProductId,
  quantity: number,
  quality: number,
): void {
  if (quantity <= 0) return;
  const existing = inv[productId];
  if (!existing) {
    inv[productId] = { productId, quantity, quality };
    return;
  }
  const total = existing.quantity + quantity;
  existing.quality =
    (existing.quality * existing.quantity + quality * quantity) / total;
  existing.quantity = total;
}

/** Remove up to `quantity` units. Returns how many were actually removed. */
export function removeStock(
  inv: Inventory,
  productId: ProductId,
  quantity: number,
): number {
  const existing = inv[productId];
  if (!existing || existing.quantity <= 0) return 0;
  const removed = Math.min(existing.quantity, quantity);
  existing.quantity -= removed;
  if (existing.quantity <= 0) {
    existing.quantity = 0;
  }
  return removed;
}

/** Whether the inventory contains at least `quantity` of a product. */
export function hasStock(
  inv: Inventory,
  productId: ProductId,
  quantity: number,
): boolean {
  return getQuantity(inv, productId) >= quantity;
}
