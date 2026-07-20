/**
 * recipes.ts — Production recipes (data-driven).
 *
 * Extraction recipes (farms, mines, importer) have no inputs. Manufacturing
 * recipes (factory/bakery) consume inputs to make outputs. To add a recipe,
 * append it here and list its id in the relevant facility definition's
 * allowedRecipes.
 */

import type { Recipe } from '../entities/Recipe';
import type { RecipeId } from '../core/Id';
import { dollars } from './constants';

export const RECIPES: Record<RecipeId, Recipe> = {
  // --- Bread chain -------------------------------------------------------
  grow_grain: {
    id: 'grow_grain',
    name: 'Grow Grain',
    facilityType: 'farm',
    inputs: [],
    outputs: [{ productId: 'grain', quantity: 10 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(1.5), // seed, water, fuel
  },
  bake_bread: {
    id: 'bake_bread',
    name: 'Bake Bread',
    facilityType: 'factory',
    inputs: [{ productId: 'grain', quantity: 3 }],
    outputs: [{ productId: 'bread', quantity: 13 }],
    laborRequired: 2,
    ticksRequired: 2,
    baseEfficiency: 1,
    variableCost: dollars(1.2),
  },

  roast_coffee: {
    id: 'roast_coffee',
    name: 'Roast Coffee',
    facilityType: 'factory',
    inputs: [{ productId: 'grain', quantity: 2 }],
    outputs: [{ productId: 'coffee', quantity: 10 }],
    laborRequired: 2,
    ticksRequired: 2,
    baseEfficiency: 1,
    variableCost: dollars(0.8),
  },

  // --- Tools chain -------------------------------------------------------
  mine_minerals: {
    id: 'mine_minerals',
    name: 'Mine Minerals',
    facilityType: 'mine',
    inputs: [],
    outputs: [{ productId: 'minerals', quantity: 8 }],
    laborRequired: 2,
    ticksRequired: 4,
    baseEfficiency: 1,
    variableCost: dollars(1.8),
  },
  make_tools: {
    id: 'make_tools',
    name: 'Make Tools',
    facilityType: 'factory',
    inputs: [{ productId: 'minerals', quantity: 4 }],
    outputs: [{ productId: 'tools', quantity: 10 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(1.8),
  },

  // --- Apparel chain -----------------------------------------------------
  grow_cotton: {
    id: 'grow_cotton',
    name: 'Grow Cotton',
    facilityType: 'farm',
    inputs: [],
    outputs: [{ productId: 'cotton', quantity: 8 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(1.6),
  },
  sew_clothes: {
    id: 'sew_clothes',
    name: 'Sew Clothes',
    facilityType: 'factory',
    inputs: [{ productId: 'cotton', quantity: 3 }],
    outputs: [{ productId: 'clothes', quantity: 8 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(1.6),
  },

  // --- Luxury tier (requires mastery — see minQuality) -------------------
  bake_pastries: {
    id: 'bake_pastries',
    name: 'Bake Pastries',
    facilityType: 'factory',
    inputs: [{ productId: 'grain', quantity: 2 }],
    outputs: [{ productId: 'pastries', quantity: 6 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(2.4),
    minQuality: 75,
  },
  craft_jewelry: {
    id: 'craft_jewelry',
    name: 'Craft Jewelry',
    facilityType: 'factory',
    inputs: [{ productId: 'minerals', quantity: 3 }],
    outputs: [{ productId: 'jewelry', quantity: 4 }],
    laborRequired: 2,
    ticksRequired: 4,
    baseEfficiency: 1,
    variableCost: dollars(4.0),
    minQuality: 75,
  },

  // --- Arc C1 breadth chains (city/metropolis products) ------------------
  // Extraction yields/labor mirror the classic farm/mine recipes; manufacturing
  // costs scale with the product's ticket so a chain's margin lands in the same
  // band as the shipped chains (bread/tools) rather than out-earning them.
  grow_produce: {
    id: 'grow_produce',
    name: 'Grow Produce',
    facilityType: 'farm',
    inputs: [],
    outputs: [{ productId: 'produce', quantity: 10 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(1.6),
  },
  cook_meals: {
    id: 'cook_meals',
    name: 'Cook Meals',
    facilityType: 'factory',
    inputs: [{ productId: 'produce', quantity: 3 }],
    outputs: [{ productId: 'meals', quantity: 11 }],
    laborRequired: 2,
    ticksRequired: 2,
    baseEfficiency: 1,
    variableCost: dollars(1.4),
  },
  tan_leather: {
    id: 'tan_leather',
    name: 'Tan Leather',
    facilityType: 'farm',
    inputs: [],
    outputs: [{ productId: 'leather', quantity: 8 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(1.9),
  },
  make_shoes: {
    id: 'make_shoes',
    name: 'Make Shoes',
    facilityType: 'factory',
    inputs: [{ productId: 'leather', quantity: 3 }],
    outputs: [{ productId: 'shoes', quantity: 8 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(1.6),
  },
  cut_lumber: {
    id: 'cut_lumber',
    name: 'Cut Lumber',
    facilityType: 'farm',
    inputs: [],
    outputs: [{ productId: 'lumber', quantity: 8 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(1.5),
  },
  build_furniture: {
    id: 'build_furniture',
    name: 'Build Furniture',
    facilityType: 'factory',
    inputs: [{ productId: 'lumber', quantity: 4 }],
    outputs: [{ productId: 'furniture', quantity: 6 }],
    laborRequired: 2,
    ticksRequired: 4,
    baseEfficiency: 1,
    variableCost: dollars(2.6),
  },
  assemble_appliances: {
    id: 'assemble_appliances',
    name: 'Assemble Appliances',
    facilityType: 'factory',
    inputs: [{ productId: 'minerals', quantity: 4 }],
    outputs: [{ productId: 'appliances', quantity: 5 }],
    laborRequired: 2,
    ticksRequired: 4,
    baseEfficiency: 1,
    variableCost: dollars(3.4),
  },
  grow_grapes: {
    id: 'grow_grapes',
    name: 'Grow Grapes',
    facilityType: 'farm',
    inputs: [],
    outputs: [{ productId: 'grapes', quantity: 9 }],
    laborRequired: 2,
    ticksRequired: 3,
    baseEfficiency: 1,
    variableCost: dollars(1.7),
  },
  ferment_wine: {
    id: 'ferment_wine',
    name: 'Ferment Wine',
    facilityType: 'factory',
    inputs: [{ productId: 'grapes', quantity: 3 }],
    outputs: [{ productId: 'wine', quantity: 6 }],
    laborRequired: 2,
    ticksRequired: 4,
    baseEfficiency: 1,
    variableCost: dollars(2.2),
  },

  // --- Importer (extraction from the outside world) ----------------------
  import_grain: {
    id: 'import_grain',
    name: 'Import Grain',
    facilityType: 'importer',
    inputs: [],
    outputs: [{ productId: 'grain', quantity: 8 }],
    laborRequired: 0,
    ticksRequired: 2,
    baseEfficiency: 1,
    variableCost: dollars(2.6),
  },
  import_minerals: {
    id: 'import_minerals',
    name: 'Import Minerals',
    facilityType: 'importer',
    inputs: [],
    outputs: [{ productId: 'minerals', quantity: 8 }],
    laborRequired: 0,
    ticksRequired: 2,
    baseEfficiency: 1,
    variableCost: dollars(3.4),
  },
  import_cotton: {
    id: 'import_cotton',
    name: 'Import Cotton',
    facilityType: 'importer',
    inputs: [],
    outputs: [{ productId: 'cotton', quantity: 8 }],
    laborRequired: 0,
    ticksRequired: 2,
    baseEfficiency: 1,
    variableCost: dollars(3.6),
  },
};

export function getRecipe(id: RecipeId): Recipe {
  const r = RECIPES[id];
  if (!r) throw new Error(`Unknown recipe: ${id}`);
  return r;
}
