# Cohorts and Districts — the world-scale population model

The ambition that started this: after PR #1 the town plays deeply at
80 citizens and ~7 firms, and the new target is a real-world-scale
city — population orders of magnitude higher, 25-30+ firms, districts.
Three parallel codebase investigations measured why "just add
citizens" dies long before 10,000, at four independent walls:

- **~200-400 citizens: the economy breaks first.** `homeSlotFor`
  (`ImmigrationSystem.ts:41`) allocates each new household one slot
  further down the map, while shopping reach is a fixed radius
  (`maxShoppingDistance: 95`, `SimulationConfig.ts:108`). Homes march
  south out of range of every store; the new families cannot buy
  bread, satisfaction craters, immigration stalls. This is not a
  performance limit — the simulated town is *wrong* past this point.
- **~1,000-5,000: effective-O(N²) loops bite.** `soldSomewhere` scans
  all facilities per need per citizen (`SatisfactionSystem.ts:63`),
  `chooseBestStore` scores every store per shopper per trip
  (`RetailDemandSystem.ts:111`), and `runJobMarket`
  (`LaborSystem.ts:181`) matches all seekers against all openings.
- **~1,000-2,000: rendering craters.** The canvas draws every home,
  citizen, and vehicle every frame with no culling or LOD.
- **~2,700: saves fail silently.** ~1.8KB per citizen against the
  5MB localStorage quota, and `saveGame` swallows the quota exception
  and just returns false (`saveLoad.ts:39-47`) — the player finds out
  when the town they closed last night never existed.

Ten thousand citizens as agents is therefore unreachable — not one
wall but four, each needing a different rewrite. The architecture the
roadmap commits to instead is a **hybrid**: a fully-simulated *cast*
of ~150 named citizens (comfortably under every measured threshold —
homes in reach, loops cheap, savable) carrying all the per-citizen
texture the game is built on, plus *cohorts* — aggregate
`district × tier` population blocks that hold the other thousands of
people as real economic mass: real money, real demand, real labor,
real migration. The crowd is simulated as economics; the cast is
simulated as people; the curator keeps the cast a faithful sample of
the crowd.

This doc covers roadmap Arcs A2-A4 (plan: world-scale roadmap, HD1 /
HD6 / HD7). A1 — demand-as-data (`Product.needSpec`) and satisfaction
normalization — shipped separately and is assumed throughout: cohort
demand is only possible because the demand curve became data.

## Design principles

1. **Cohorts are real money-holding accounts.** `AccountKind` gains
   `'cohort'` (`Transactions.ts:22`, `cohortAccount` at
   `Transactions.ts:73`); `getAccountCash` / `addAccountCash` /
   `totalMoneySupply` (`GameState.ts:216,222,403`) learn the new
   kind. Every cohort flow is a `recordTransaction`
   (`GameState.ts:262`): wages firm→pool per firm×cohort, subsistence
   world→pool, spending pool→store booked as `revenue`, migration and
   tier moves transferring pro-rata slices of the pool. Conservation
   holds **by construction** — the invariant every money test already
   asserts extends to cohorts with zero new machinery. The rejected
   alternative — multiplying cast purchases by a population factor —
   was discarded for lumpy shelf depletion and fragile coupling
   between cast behavior and crowd outcomes.
2. **Zero shared-rng draws in cohort math.** Cohort updates are pure
   functions of state; where texture needs randomness, it comes from
   salted-hash gates keyed `(seed, day, cohortId)` — the independent
   deterministic stream pattern `FireSaleSystem.ts:31-36` proved.
   Every iteration with economic effect runs in sorted-key order.
   Consequence: enabling cohorts consumes not a single draw from the
   shared rng, so the cast's behavior in a City-preset town stays
   comparable with a Village town at the same seed, and the Village
   preset is untouched by definition.
3. **The cast is a representative sample, not a separate town.**
   ~150 named citizens apportioned across `district × tier` strata by
   largest remainder — every stratum gets ⌊quota⌋ seats and the
   largest fractional remainders round up, so the cast's demographics
   track the crowd's within one citizen per stratum. A daily curator
   rebalances at most one citizen per day, and cohort-level events
   (a family leaving, an ascension to affluence) preferentially
   manifest through a matching cast member, so Gazette stories keep
   naming names while the numbers move underneath.
4. **One demand curve, not two.** Per-(cohort, product) demand is
   `population × needSpec midpoint rates × tier/world/season
   multipliers` — the same curve agents follow (`Product.ts:74`) —
   and settles through the same stores via re-normalized
   `scoreStore` weights (`RetailDemandSystem.ts:57`), feeding
   `marketStats` and `facility.dailyStats` identically to agent
   purchases. AI pricing, shortage response, and wholesale logic need
   zero changes: a cohort customer is indistinguishable from a
   thousand agent customers in every signal a firm reads.
5. **Village = today's game, bit-identically.** Cohorts ship dark:
   the `'village'` size preset carries cohort cap 0, and a town with
   zero cohort population takes no cohort code path that mutates
   state. Old saves and golden fixtures v1-v6 load and replay
   unchanged — never regenerated, per standing rule.

## Phase A2 — dark foundations (IN PROGRESS)

Everything lands; nothing turns on. Acceptance is that *nothing
visibly changes* in any existing scenario, save, or probe.

- **`District` entity** (`entities/District.ts`): `{kind, bounds,
  landValueBase, desirability, housingCapacity, adjacent}` with a
  `districtAt` partition lookup. In A2 districts are pure **metadata
  over the current map** — a partition every map point belongs to —
  so cohorts are keyed correctly from birth and nothing needs
  re-keying when A4 makes districts physical.
- **`Cohort` entity** (`entities/Cohort.ts`): keyed
  `${districtId}:${tier}`, holding `{population, employed, cashPool,
  avgSatisfaction, avgSkill, backlogByProduct, gateStreaks}`. All
  cohorts start empty.
- **`'cohort'` account kind** wired through the account helpers and
  `totalMoneySupply` (principle 1), tested against the conservation
  fixtures even while pools sit at zero.
- **`DistrictSystem`**: recomputes each district's `desirability`
  daily from the homes, jobs, and shops present — a cache read by UI
  and, from A3, by migration. Never read for money math in A2.
- **`sizePreset` config**: `'village' | 'city' | 'metropolis'`
  bundling cast target, cohort cap (0 / ~2,000 / ~10,000), map
  dimensions, founder cap (6/18/30), and log caps (HD7). Village is
  the only preset reachable in A2 and reproduces today's config
  field-for-field. A `serialize < 2.5MB` guard joins the suite and
  the silent `saveGame` failure gets surfaced to the player.
- **Districts UI panel**; normalize-only save migration (missing
  `districts`/`cohorts` default to the Village partition and empty
  records — no SAVE_VERSION bump).

**The gate for A3 — the shadow-cohort parity probe.** A3 is the
riskiest phase of the roadmap: a second demand engine that must agree
with the agent engine *at the margin*, whose errors silently
re-balance the economy rather than crash. So the spike runs during
A2, before any A3 code: mirror the live 80-160-agent town into a
prototype cohort engine every day — shadow pools computed from the
real citizens, zero state mutation — and compare the two engines over
**300 days × 3 seeds**. The agreement envelope that green-lights A3:

- per-product units sold within **±10%**,
- average satisfaction within **±5 points**,
- tier shares within **±8 points**.

If the shadow engine can't track the agent town inside that envelope,
A3's formulas get fixed *here*, where divergence is measurable
against ground truth, not in a live cohort city where nothing crashes
and everything drifts. The envelope then becomes A3's standing
regression test. Spike verdict and measurements will be appended
below when the probe completes.

## Phase A3 — the cohort economy live (PLANNED)

City preset turns on: ~2,000 residents, of whom ~150 are cast and the
rest live in cohorts. The full HD1 mechanics:

- **`CohortDemandSystem`** — demand settles in **5 slices across the
  shop window** (hours 16-21, `SimulationConfig.ts:98-99`), not one
  end-of-day lump, so shelf depletion interleaves with cast shopping
  the way a real crowd's would. Per slice, each cohort's remaining
  demand for each product is allocated across **district-local
  stores** by re-normalized `scoreStore` weights with **share ∝ w²**
  (squaring sharpens the split toward better stores — closer to a
  crowd of individual best-choice shoppers than proportional w would
  be), each allocation capped by shelf stock, pool cash, and the
  walkaway price (`needSpec.maxPriceMult` × tier cap). One
  `recordTransaction` per cohort × store per slice, booked as
  `revenue`, updating `marketStats` and `dailyStats` exactly as agent
  purchases do. Unmet demand accrues to `backlogByProduct`, capped at
  **3 days'** demand — the cohort analogue of need-urgency saturation
  (`URGENCY_CAP`).
- **`CohortSocialSystem`** — the existing satisfaction-equilibrium
  formula (`SatisfactionSystem.ts:114-131`: target from employment
  share, housing, and backlog pressure; drift toward it at the same
  0.12 rate) applied per cohort. Tier gates reuse the TierSystem
  wage/satisfaction/savings bars (`TierSystem.ts:31-53`) evaluated on
  cohort averages, with the same 5/7-day streak hysteresis via
  `gateStreaks`; while a gate holds, **PROMOTE_RATE / DEMOTE_RATE =
  0.02** of the block moves per day, carrying a pro-rata slice of the
  cash pool with it. Migration reuses the immigration/emigration
  gates at cohort scale: inflow **0.004 × district attractiveness**
  per day when the town clears the immigration bar, outflow **0.003**
  when a cohort sits below the emigration bar. All four constants are
  starting values to measure-then-pin against the A3 soaks.
- **`CohortLaborSystem`** — after the cast job market runs, cohort
  headcount fills remaining openings at the cohort's `avgSkill`;
  payroll pays **one transaction per firm × cohort** (firm→pool), so
  a 30-firm city writes hundreds of payroll transactions per day, not
  tens of thousands.
- **`CastCuratorSystem`** — daily, ≤1 citizen: *retire* a cast member
  into the crowd (cash citizen→pool, record absorbed into the
  cohort) or *promote* one out of it (pool→citizen via
  `createCitizen`, `factories.ts:112`), keeping every stratum within
  ±2 of its largest-remainder apportionment as the crowd's
  demographics shift.

Golden save **v7** is minted here (the first fixture with live
cohorts) and joins the load / run-conserved / round-trip trio.

Probes (300 days × 3 seeds, unattended): money conserved to the
cent; tier bands land in 50-70 / 25-40 / 5-15 (worker / comfortable /
affluent); cast strata within ±2 of apportionment throughout;
≤0.6 ms/tick at City preset. Secondary probe: cohort demand must not
starve cast shoppers — cast average satisfaction within 5 points of
cohort average across the soak. Results appended when they ship.

## Phase A4 — physical districts (PLANNED)

Districts stop being metadata and become the map.

- **Map presets**: Village 130×92 (today's map), City 260×184,
  Metropolis 390×276, with authored district layouts per scenario.
- **Placement rewrite**: district slot enumeration replaces the
  three hardcoded placement schemes — the `homeSlotFor` column
  march (`ImmigrationSystem.ts:41`), the fixed `findSpot` build rows
  (`ChainBuilder.ts:54,75` — three rows saturating at ~12-15
  chains), and the AI founders' hardcoded coordinates. Homes go in
  residential districts near their cohort; facilities go in
  commercial/industrial districts with capacity, not a magic y-row.
- **District-local shopping**: `chooseBestStore` restricted to the
  home district plus `adjacent` — which fixes both problems at once:
  travel time (at citizen speed 6 and a ~10-tick shopping trip, ~60
  map units of reach cannot cross a 260-wide city, so town-wide
  scoring would send shoppers on trips they physically cannot
  finish) and the per-shopper full-map store scan.
- **District land-value cache** replacing the O(homes) per-valuation
  loop with a per-district daily aggregate.
- **Renderer**: viewport culling + LOD so only the visible district
  draws at full detail; cohort presence appears as **hash-derived
  ambient density** — background figures seeded from
  `(cohortId, day, tile)`, giving a crowded city without simulating
  a single pedestrian.

Probes: found 30 chains without silent placement abort; every home
reaches at least one staple store within the shop window at walking
speed; fps guard in the e2e suite; ≤0.8 ms/tick.

## Open questions

- **Cast-vs-cohort shelf competition.** Within a shop-window slice,
  cohort bulk purchases and cast agent purchases drain the same
  shelves; a fixed settlement order could systematically starve one
  side of contested stock (the cast is ~7% of a City's demand but
  100% of its stories). Slice interleaving plus the cast-within-5
  satisfaction probe are the watchdogs; if the probe fails, the
  fallback is per-slice stock reservation proportional to demand.
- **Dividend-of-labor edge cases.** Cohort workers staffing cast-run
  (including player-run) facilities are paid at cohort `avgSkill` —
  but training programs, morale effects, and manager bonuses are
  per-citizen machinery. How much of that surface should apply to
  anonymous headcount, and does the answer differ for the player's
  firm (where "train your staff" is a lever) versus AI firms (where
  it's bookkeeping)? Deferred to A3 balancing.
- **Event volume at scale.** Cohort flows generate legitimate events
  (migrations, tier waves, district booms) that would flood the
  400-cap log a Village town tuned. HD7's channels and daily digests
  are the mechanism, but *which* cohort events deserve a named cast
  manifestation versus a digest line is a curation question only
  playtesting answers.
