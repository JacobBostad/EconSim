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
import { seasonProductionMult } from '../data/seasons';
import { isWorkTime } from './CitizenScheduleSystem';

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

    // Mastery gate: luxury recipes need the firm's craft quality first.
    if (recipe.minQuality !== undefined) {
      const outPid = recipe.outputs[0]?.productId;
      const firmQ = outPid
        ? state.firms[fac.ownerFirmId]?.qualityByProduct[outPid] ?? getProduct(outPid).defaultQuality
        : 0;
      if (firmQ < recipe.minQuality) {
        fac.status = 'idle';
        fac.bottleneckReason = `Needs quality ≥ ${recipe.minQuality} (invest R&D in ${outPid ? getProduct(outPid).name : 'product'})`;
        continue;
      }
    }

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

    // Crew skill scales output: an experienced crew (avg skill up to 1.3)
    // outproduces a green one. Falls back to neutral when skill is untracked.
    const avgSkill =
      fac.presentWorkers > 0 && fac.presentSkill > 0
        ? fac.presentSkill / fac.presentWorkers
        : 1;
    // Staffing beyond laborRequired scales output (up to 2.5×) — hiring is a
    // real growth lever, employment absorbs the town's labor pool, and full
    // employment unlocks immigration (the growth flywheel).
    const workerFactor =
      recipe.laborRequired > 0
        ? Math.min(2.5, fac.presentWorkers / recipe.laborRequired) *
          Math.min(1.3, Math.max(0.7, avgSkill))
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
      // Off-hours with a hired crew is a shift break, not a staffing problem —
      // only unstaffed facilities alarm around the clock.
      if (fac.employees.length > 0 && !isWorkTime(ctx)) {
        fac.status = 'idle';
        fac.bottleneckReason = null;
      } else {
        fac.status = 'labor-starved';
        fac.bottleneckReason =
          recipe.laborRequired > 0
            ? `No workers present (need ${recipe.laborRequired})`
            : null;
      }
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

    // inputAvailability == 1 here; seasons cycle farm output and world events
    // (droughts, rich veins...) scale it further while they last.
    const levelMult = 1 + 0.15 * (fac.level - 1);
    const efficiency =
      recipe.baseEfficiency *
      workerFactor *
      levelMult *
      worldProductionMult(state, fac.type) *
      seasonProductionMult(state, fac.type);
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
