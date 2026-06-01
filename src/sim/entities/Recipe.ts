/**
 * Recipe.ts — Production recipe type.
 *
 * Recipes are static, data-driven definitions (see /data/recipes.ts). A recipe
 * turns input goods into output goods at a facility over a number of ticks,
 * consuming labor. `variableCost` is the per-batch cost (cents) paid to the
 * "world" account, representing utilities/consumables not modeled as goods.
 */

import type { ProductId, RecipeId } from '../core/Id';
import type { FacilityType } from './Facility';

export interface RecipeIO {
  productId: ProductId;
  quantity: number;
}

export interface Recipe {
  id: RecipeId;
  name: string;
  /** Which facility type can run this recipe. */
  facilityType: FacilityType;
  /** Inputs consumed per completed batch (empty for extraction recipes). */
  inputs: RecipeIO[];
  /** Outputs produced per completed batch. */
  outputs: RecipeIO[];
  /** Workers needed for full-speed production. */
  laborRequired: number;
  /** Ticks of effective progress needed to complete one batch. */
  ticksRequired: number;
  /** Intrinsic efficiency multiplier of the recipe (0..1+). */
  baseEfficiency: number;
  /** Variable cost in cents per completed batch (paid to world account). */
  variableCost: number;
}
