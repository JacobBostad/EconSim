# Firm archetypes — Arc D1 design (HD5)

## The hole this fills

Every AI firm in EconSim runs **one loop**: the shopkeeper's. Price the
shelves, staff the plants, shop the wholesale market, expand under shortage,
park spare cash in equity, defend the brand. That loop (`AIStrategySystem`)
grew to ~1,500 lines because it is secretly *four* businesses wearing one
coat — a retailer, a landlord (`maybeBuildApartment`), an investor
(`maybeBuyShares`), and a compute provider (`maybeBuildDatacenter`) — all
gated inside the same per-firm `if (healthy) { … }` block and all sharing the
retailer's cadence.

That worked while every firm WAS a retailer. It stops working the moment we
want a firm that is *only* a landlord, or *only* a holding company: there is
nowhere to put a firm that shouldn't price shelves because it has none. Arc
D1 builds the frame that lets those specialists exist — a **dispatcher** that
routes each firm to a **behavior module** chosen by a new
`strategy.archetype`, and a **founder table** where each archetype supplies
its own opportunity signal. D1 ships the frame with only the operator wired
up; D2–D4 add the specialists.

D1 is a **pure refactor**. Not one economic decision changes. The Village
300-day exact-`rngState` baseline, the plain City baseline, and every money
total are byte-for-byte unchanged (verified — see the module map below).

## Decisions

- **`archetype`, not `personalityId`.** A firm already had a `personalityId`
  (brand builder, price fighter, expansionist, exporter). That is the CEO's
  *temperament* — it shades the knobs *within* a loop (ad multiplier, price-cut
  depth, stake appetite). `archetype` is a different axis entirely: it picks
  *which loop the firm runs at all*. A landlord has no use for a price-cut
  multiplier; an operator does. Keeping them separate means the four
  personalities × four archetypes compose instead of colliding.

- **The operator loop moves VERBATIM.** `runOperatorBehavior` is the old
  per-firm loop body cut and pasted into its own module — same behaviors, same
  order, same early-out when a rescue acquisition mutates the firm map (the old
  loop `continue`d past the loss-streak update; the extracted function
  `return`s before it, identically). The dispatcher calls it for every AI firm,
  because every AI firm is an operator today. That is *why* the baselines don't
  move: structurally the same code runs in the same order.

- **B2/B3/C2 behaviors STAY in the operator loop for now.** Portfolio buying
  (`maybeBuyShares` / `maybeBuyStakeCity`), distress consolidation
  (`maybeRescueAcquisition`), datacenter provisioning (`maybeBuildDatacenter`),
  and apartment development (`maybeBuildApartment`) are the physical seeds of
  the investor / service / landlord archetypes — but D1 does **not** reshuffle
  them into archetype modules. They keep running in the operator's cadence.
  What D1 does is put them in the *sibling module they'll eventually own*
  (`finance.ts` for the investor seam, `expansion.ts` for the landlord/service
  seams) with a comment marking the seam, so D3/D4 lift a self-contained unit
  rather than untangling it from the retailer under load.

- **The non-operator dispatch rows are inert stubs, not fallbacks.** `landlord`
  / `investor` / `service` map to a no-op behavior, not to the operator loop.
  No preset ever founds a non-operator firm and the migration normalizes old
  saves to `operator`, so the stub rows are unreachable in every pinned
  baseline — which is exactly what lets a routing test set a firm to `landlord`
  and prove the operator loop did *not* run on it.

- **One versioned migration (the roadmap's single one).** `SAVE_VERSION`
  goes 1 → 2. The v1→v2 step stamps `strategy.archetype = 'operator'` on every
  firm of an old save (every firm predating D1 *was* an operator) and leaves
  money, rng, facilities, and contracts untouched — the loaded world is the
  same run, now carrying one new classifier per firm. A defensive `?? 'operator'`
  in `normalize` backs it up for any hand-rolled fixture that reaches the
  loader without the field. Golden fixtures v1–v7 (all `saveVersion: 1`) load
  unchanged through the chain; a migration test pins that a real v1 save — which
  contains no `"archetype"` string at all — comes out with the field on every
  firm.

## The founder signal table

`AIFounderSystem` decides when *new* firms move to town. D1 generalizes it
from a hard-coded staple scan into a table of archetype rows, so D2–D4 can add
"a landlord moves in where housing is chronically short" without touching the
operator's staple logic.

```ts
interface FounderArchetype {
  archetype: FirmArchetype;
  // Update this archetype's opportunity counters. Runs EVERY day, before any
  // gate, so streaks accrue during the pre-earliest window too.
  trackSignals(ctx: SimContext): void;
  // Given the day's town read (shared gates already passed), attempt one
  // founding. Returns true to CLAIM the day's single founding slot; false to
  // let the next row try.
  tryFound(ctx: SimContext, town: FounderTownRead): boolean;
}
```

The shell keeps the **shared** gates — earliest day, whole-town population and
satisfaction, the AI-firm cap, the Village world-cash floor — then walks the
table: `trackSignals` on every row every day, and after the gates, `tryFound`
on each row until one claims the day (the world founds at most one firm per
day, town-wide). The **operator row** carries today's two entries verbatim:
the staple total-vacancy entry (hash-gated, immigration-ceiling-gated, all
presets) and the city-scale under-supply entry (fill-rate streak, cooldown,
solvency brake, most-starved pick). Because the founder system draws **zero**
from the shared rng (its rolls are pure seed×day hashes), reshaping the control
flow around the table is trivially bit-identical as long as the found/no-found
decisions land in the same order — which they do.

**Adding a row is additive.** A D2 landlord appends
`{ archetype: 'landlord', trackSignals, tryFound }` to `FOUNDER_ARCHETYPES`
and writes its own two methods; the operator row is never re-touched.

## What D2–D4 will add

- **D2 — landlord.** A behavior module that only develops and rents housing
  (lifting the `maybeBuildApartment` seam out of `expansion.ts`), and a founder
  row that moves a rentals firm to town where vacancy is chronically zero.
- **D3 — investor (SHIPPED).** A holdco behavior module (`systems/ai/investor.ts`)
  that only works its equity book — deterministic yield hunting in holdco size
  (bigger blocks, lower idle-cash floor, a cap laddering toward the 40% control
  block), dividend harvesting, and B1 rescue consolidation where the control
  ladder allows. It reuses the B2 `maybeBuyStakeCity` yield logic and the shared
  `tradeShares` caps rather than moving the operator's side-buying out of
  `finance.ts` (operators still dabble; the holdco specialises). A founder row
  (median trailing dividend-yield spread sustained N days) spins one up where
  dividends are fat — gated behind an opt-in `config.investorsEnabled` flag and
  `sizePreset === 'city'`, so every pinned Village/City/Metropolis baseline
  (flag off) is byte-identical to pre-D3. See docs/design/stock-market.md,
  "Arc D3", for the as-built and the crowd-band constraint that forced the flag.
- **D4 — service.** A provider module that only runs compute/logistics/ad
  services (lifting the `maybeBuildDatacenter` seam out of `expansion.ts`), and
  a founder row that enters where a service's demand outruns town capacity.

Each arrives as: a new behavior module + one dispatch-table row + one founder
row + (where the specialist needs new memory) additive `FirmStrategy` fields.
None of it edits the operator path.

## Module map

The old monolith `AIStrategySystem.ts` split into a dispatcher plus a small
`systems/ai/` module set. Nothing moved between behaviors — only *where the
code lives*:

| Module | Holds |
| --- | --- |
| `systems/AIStrategySystem.ts` | the dispatcher: the per-firm archetype router, the `BEHAVIOR_BY_ARCHETYPE` table, the player-QoL auto-price block, the digest flush; re-exports the old public surface (`adjustPrices` / `maybeWidenShelves` / `manageSourcing`, the digest helpers) so callers didn't move |
| `systems/ai/digest.ts` | the routine-event batching shared by dispatcher and behaviors (`routeRoutine`, `flushRoutineDigest`, `newDigestBuffer`) |
| `systems/ai/OperatorBehavior.ts` | the operator loop that stays operator forever — pricing/positioning/ads/quality, wages/restaff/supply-elasticity/shelf-sizing, sourcing/wholesale pricing — plus `runOperatorBehavior`, the orchestrator that calls everything in the exact old order |
| `systems/ai/expansion.ts` | the operator's build behaviors (store/coffee/luxury/upgrade) — and the **landlord (D2)** and **service (D4)** seams (`maybeBuildApartment`, `maybeBuildDatacenter`) |
| `systems/ai/finance.ts` | the operator's capital behaviors (deleverage, export surplus, rescue consolidation) — and the **investor (D3)** seam (`maybeBuyShares` / `maybeBuyStakeCity`), which the operator still uses for side-buying |
| `systems/ai/investor.ts` | the **investor (D3)** holdco loop `runInvestorBehavior` — deterministic holdco-sized yield buying, rescue consolidation, deleveraging; the live `investor` dispatch row |

`AIFounderSystem.ts` stayed one file; internally it grew the `FounderArchetype`
table with the operator row live.

## Verification

- Village seed 1 and seed 777, 300 days: `rngState` and total money supply
  byte-identical before and after (3593176944 / 3403302807, $3,154,000.00).
- City seed 11, 300 days: `rngState` 2546912297 and total money $3,169,000.00
  unchanged — the pure-refactor claim holds at crowd scale too.
- Full suite green (471 tests, +6 for this arc). New tests: the dispatcher
  routes a stub `landlord` away from the operator loop; `dispatchFirmBehavior`
  selects by archetype directly; `SAVE_VERSION` is 2; the v1→v2 step stamps
  `operator` without clobbering an explicit archetype; a real v1 golden save
  gains the field through the migration chain.
