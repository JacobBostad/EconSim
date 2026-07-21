# Deep supply chains — Arc C3 design

## The hole this fills

Every supply chain in EconSim was exactly two production stages deep:
a producer extracts a raw, a factory turns it into a consumer good, a store
retails it. `raw -> consumer`. There was no middle — no producer good that one
firm makes and another consumes, no `intermediate` category in play, no
industrial layer between the mine and the shelf. A metropolis with 30 firms
still had the industrial depth of a village: everyone one hop from dirt to
retail.

Arc C3 adds the middle. The `intermediate` product category (long present in
the type, never instantiated) goes live, and two metropolis chains deepen from
two stages to three:

```
minerals -> STEEL  -> appliances     (was: minerals -> appliances)
lumber   -> PLANKS -> furniture       (was: lumber   -> furniture)
```

Steel and planks are **producer goods**: no `needSpec` (citizens never crave
them), no retail shelf, `needType: 'none'`. They move firm-to-firm — or
stage-to-stage inside one firm — on the existing wholesale/contract machinery,
exactly like a raw. The `intermediate` category is display-only; no economic
branch reads it.

## The blueprint generalization

A `ChainBlueprint` was a fixed triple: `producerDefId`, `producerRecipeId`,
`factoryRecipeId`, `inputProductId`. C3 replaces that with an ordered list of
production `stages` (each a facility + a recipe), with the store appended after
the last stage:

```ts
interface ChainStage { facilityDefId; recipeId; }
interface ChainBlueprint { productId; stages: ChainStage[]; }
```

A 2-stage chain is `stages.length === 2`; a deep chain is 3. `ChainBuilder`
walks the stages in order — build each stage's facility, set its recipe, staff
it by its recipe's labor, wire it to the next stage (shipping that stage's
output), then the last stage to the store. The wiring product between stage *i*
and *i+1* is stage *i*'s recipe output; the last stage ships the consumer good.

**Bit-identity is the contract.** A 2-stage blueprint builds BYTE-IDENTICALLY
to the pre-C3 producer/factory/store triple: same facilities, same creation
order (hence same ids), same coordinates (Village keeps its pinned fixed build
rows 20/33/51; City/Metropolis resolve the same sequential district slots), same
staffing order, same two contracts with the same 40/16/80 sizing. The Village
wizard and AI-founder paths are pinned by the 300-day exact-rngState baseline,
which reproduces unchanged (`docs/design/probes/village-bitidentity-check.ts`),
and `chains.test.ts` pins the concrete 2-stage structure directly.

## Why these two chains (the choice)

The task floated three shapes: restructure appliances (given), and one of
`lumber -> paper -> books` (a new consumer good) or `steel also feeds tools`
(a shared hub). We restructured **two existing C1 durables** — appliances and
furniture — into 3-stage chains instead, for three reasons:

1. **Zero new consumer-demand rng.** A new consumer product (books) would add a
   `needSpec` and draw from the shared rng at every metropolis citizen's
   creation, moving the metropolis trajectory more than necessary. Restructuring
   appliances/furniture touches only PRODUCTION — their `needSpec`, `basePrice`,
   and tier targeting are untouched, so the citizen-need draw sequence, the
   metropolis basket-affordability bound, and the cast renormalization ceiling
   are all exactly as C1 left them. The two new intermediates carry no needSpec,
   so they add no citizen draws at all.

2. **No base-staple founder risk.** Making a *heavily-founded* staple deep
   (e.g. tools, which every preset's founder builds) would add a whole factory's
   fixed overhead — a fourth facility's maintenance and two more wages — to a
   chain the metropolis founder cadence stands up dozens of times. That extra
   overhead threatens the pinned metropolis solvency guard (the founder-scale /
   200-day soak). Appliances and furniture are comfortable+ durables that the
   founder cadence rarely reaches (base staples saturate the cap first — see the
   C1 "honest limit"), so the added stage lands on player/wizard builds, not on
   the pinned unattended field. The 200-day metropolis soak (conservation +
   `unhealthy/ai <= 0.2`) passes unchanged.

3. **Village and City never see any of it.** Both intermediates and both new
   recipes are `availableIn: 'metropolis'` / metropolis-output; every
   preset-filtered product list and facility recipe copy drops them below
   metropolis, so Village stays byte-identical and the City tier-band
   calibration stays on its pinned trajectory.

A shared steel hub feeding tools would have been the richer economic object, but
it costs the base-staple founder solvency the metropolis guards pin — measured,
and not worth the gamble. Two independent deep chains deliver the depth safely.

## Save-compat: legacy recipe aliases

The old single-factory recipes — `assemble_appliances` (minerals -> appliances)
and `build_furniture` (lumber -> furniture) — stay in the catalog and in
`factory.allowedRecipes`, marked as legacy aliases. No new build selects them
(the blueprints run the 3-stage path: `smelt_steel` -> `forge_appliances`,
`mill_planks` -> `assemble_furniture`), but a **mid-flight metropolis save**
whose factory is set to the old recipe keeps producing after the update. Save
migration backfills market-stat and trade-city entries for the new intermediates
automatically (they are metropolis-catalog products); nothing else is needed.
We keep-as-alias rather than normalize because normalization would have to
rewrite live facility recipes and re-wire contracts in a loaded save — more
surface, more risk — for a recipe that costs nothing to leave runnable.

## AI operator across three stages

Input sourcing already reaches across the deep chain. A wizard/founder chain is
intra-firm end to end, so its stage-to-stage contracts (minerals -> steel ->
appliances) are never touched by `manageSourcing` (it only repoints contracts
whose source is the importer or another firm). And the importer supplies ANY
product on demand at `basePrice x markup` with no per-product recipe, so an
intermediate that ever needs importing (a firm running only the finishing stage)
is covered by the same machinery as a raw — and a firm that overproduces steel
sells it to local buyers through the exact wholesale scan a raw uses. No gap;
verified by the C3 probe (steel flows stage-to-stage, conserved, no starvation).

## Measured (docs/design/probes/c3-chains.ts, 300d metropolis, seeds 7/11/4)

A wizard-built 3-stage appliances chain (plus a furniture chain), run with the
documented "serve the shelf + export the surplus" logistics:

- **Steel flows**: ~29 u/day produced AND shipped mine -> steel -> appliances
  (planks ~29 u/day lumber -> planks -> furniture). The intermediate is real
  and moving, not stockpiled.
- **Per-unit value-add** (reference prices): minerals $0.23 embodied ->
  steel $0.42 (base $5) -> appliances $0.65 (base $42). Every stage lifts its
  input to a higher-value output; the deep chain is profitable per unit.
- **Per-stage P&L @ day 300**: the finishing factory nets ~$+1,715/day
  (transfer-credited for the goods it makes); chain P&L net ~$+1,567/day. The
  firm's cash grows ~$+330k over 300 days — **PROFITABLE end-to-end**.
- **Conservation exact**, ~0.31–0.37 ms/tick at day 300, AI field 29–30 firms
  with 2–3 unhealthy (healthy).

**Honest limit — local durable retail is thin by C1 design.** Appliances and
furniture are comfortable+ goods. In a metropolis the CROWD (cohorts) that fills
store traffic never craves the C1 breadth, and the C1-craving named cast is
small and trip-limited (it can barely make its staple trips — see
cohorts-and-districts). So a lone deep chain sells ~0 units of its durable to
local walk-ins, whatever the placement — the same "single-product chain is
sub-scale" reality as the 2-stage chains, and a pre-existing C1 property (C3 did
not change any retail `needSpec`). A deep chain therefore monetizes its durable
output by **exporting the surplus** (a reliable finished-goods market) while the
shelf serves the local trickle — which is exactly the documented arc, and what
makes the chain strongly cash-positive above.
