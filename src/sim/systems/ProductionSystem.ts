/**
 * ProductionSystem — turns inputs + labor into outputs at production facilities.
 *
 * Per-tick formula (matches README / FormulaTooltip):
 *   workerFactor      = laborRequired > 0 ? min(1, presentWorkers/laborRequired) : 1
 *   inputAvailability = all inputs present ? 1 : 0
 *   efficiency        = baseEfficiency * workerFactor * inputAvailability
 *   productionProgress += efficiency   (per tick)
 * On completion (progress >= ticksRequired) inputs are consumed, outputs added,
 * and the recipe's variable cost is paid to the world account. Status reflects
 * the binding constraint (input-starved / labor-starved / inventory-full).
 */

import type { SimContext } from '../core/GameState';
import { recordTransaction } from '../core/GameState';
import { firmAccount, WORLD_ACCOUNT } from '../core/Transactions';
import { getRecipe } from '../data/recipes';
import { getProduct } from '../data/products';
import {
  addStock,
  removeStock,
  getQuantity,
  totalUnits,
} from '../entities/Inventory';
import { worldProductionMult } from '../data/worldEvents';

const PRODUCING_TYPES = new Set(['farm', 'mine', 'factory', 'importer']);

export function runProductionSystem(ctx: SimContext): void {
  const { state } = ctx;
  for (const fid in state.facilities) {
    const fac = state.facilities[fid]!;
    if (fac.status === 'closed') continue;
    if (!PRODUCING_TYPES.has(fac.type)) continue;
    if (!fac.activeRecipeId) {
      fac.status = 'idle';
      fac.bottleneckReason = 'No recipe selected';
      continue;
    }
    const recipe = getRecipe(fac.activeRecipeId);

    // Input availability.
    let inputsAvailable = true;
    let missingInput = '';
    for (const io of recipe.inputs) {
      if (getQuantity(fac.inputInventory, io.productId) < io.quantity) {
        inputsAvailable = false;
        missingInput = getProduct(io.productId).name;
        break;
      }
    }

    const workerFactor =
      recipe.laborRequired > 0
        ? Math.min(1, fac.presentWorkers / recipe.laborRequired)
        : 1;

    // Output capacity check.
    const outUnits = recipe.outputs.reduce((s, o) => s + o.quantity, 0);
    const projected = totalUnits(fac.outputInventory) + outUnits;
    const storageFull = projected > fac.storageCapacity;

    if (!inputsAvailable) {
      fac.status = 'input-starved';
      fac.bottleneckReason = `Missing input: ${missingInput}`;
      continue;
    }
    if (workerFactor <= 0) {
      fac.status = 'labor-starved';
      fac.bottleneckReason =
        recipe.laborRequired > 0
          ? `No workers present (need ${recipe.laborRequired})`
          : null;
      continue;
    }
    if (storageFull) {
      fac.status = 'inventory-full';
      fac.bottleneckReason = 'Output storage full';
      continue;
    }

    fac.status = 'active';
    fac.bottleneckReason = null;
    fac.dailyStats.ticksActive += 1;

    // inputAvailability == 1 here; world events (droughts, rich veins...)
    // scale output up or down while they last.
    const efficiency =
      recipe.baseEfficiency * workerFactor * worldProductionMult(state, fac.type);
    fac.productionProgress += efficiency;

    if (fac.productionProgress >= recipe.ticksRequired) {
      fac.productionProgress -= recipe.ticksRequired;
      // Consume inputs.
      for (const io of recipe.inputs) {
        removeStock(fac.inputInventory, io.productId, io.quantity);
      }
      // Produce outputs, stamped with this firm's quality (raised by R&D).
      const firm = state.firms[fac.ownerFirmId];
      for (const io of recipe.outputs) {
        const product = getProduct(io.productId);
        const quality = firm?.qualityByProduct[io.productId] ?? product.defaultQuality;
        addStock(fac.outputInventory, io.productId, io.quantity, quality);
        fac.dailyStats.unitsProduced += io.quantity;
      }
      // Pay variable cost to the world account.
      if (recipe.variableCost > 0) {
        recordTransaction(state, {
          from: firmAccount(fac.ownerFirmId),
          to: WORLD_ACCOUNT,
          amount: recipe.variableCost,
          firmId: fac.ownerFirmId,
          category: 'variableCost',
          note: `Variable cost: ${recipe.name}`,
        });
        fac.dailyStats.variableCost += recipe.variableCost;
      }
    }
  }
}
