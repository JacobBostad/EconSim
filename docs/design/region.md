# The region — Arc E design (the roadmap's last arc)

## Where the roadmap lands

Arc A grew one town from an all-agent village into a cohort-and-district city.
Arcs B–D grew the *firm* side: a share market, deep production chains, and the
specialist archetypes (landlords, holdcos, service providers). Every one of
those arcs stayed inside a **single town**: one map, one crowd, one set of
`state.firms`. The distant trade cities — Port Rosa, Ironvale — have always been
the edge of that world: not places, just **price stubs** a warehouse can export
into (`data/tradeCities.ts`, a seeded random walk per product).

Arc E is about the next axis: **the region — several towns sharing one world,
trading with each other.** This is a genuinely large refactor, larger than any
single prior arc, so Arc E ships as a *seed*, not the finished thing:

1. **This design doc** — the region container concept, the honest cost of the
   `GameState` refactor it needs, the migration path, and what stays out of
   scope and why. The plan the next era builds from.
2. **One shippable slice** — the trade cities gain a **cohort-style demand
   pool**, so export prices respond to a real (tiny) economy instead of a pure
   random walk. This is the first brick of "the trade city is a place with an
   economy," landed behind a flag with the pinned world untouched.

## The region concept

A **region** is a container of **towns** that share:

- **One clock and one rng stream** (determinism is region-wide, not per-town).
- **One money supply** — the `WORLD_ACCOUNT` and conservation invariant span the
  region; a shipment from town A to town B is one `recordTransaction`, so the
  cent-conservation guarantee generalizes for free.
- **A trade graph** — towns are nodes; the edges are freight lanes with a fee
  and a lead time (today's `EXPORT_FREIGHT_FEE × freightMult` is the degenerate
  one-hop version). Goods, and eventually people and capital, move along edges.

Each **town** owns what a town owns today: a map, districts, a cast of simulated
citizens, cohorts for the crowd, its own firms and facilities, its own retail
shelves and prices. The player runs firms in one or more towns; the AI founds
firms town-by-town; the crowd shops locally. **The trade cities are just towns
the player doesn't (yet) operate in** — off-map economies that consume, produce,
and price goods, which is exactly what the demand pool this arc ships begins to
make them.

The payoff the region unlocks: **inter-town arbitrage and specialization become
real economics rather than a random walk.** A grain-rich valley town exports to
a mining town that pays up for food and ships back tools; a shock in one town
(a drought, a boom, a founder war) propagates through freight prices to its
trading partners; the player's edge is reading the region, not the dice.

## What the `GameState` refactor would take

Today `GameState` is a **single flat town**. The entity records are top-level:
`state.firms`, `state.facilities`, `state.citizens`, `state.districts`,
`state.cohorts`, `state.marketStats`, one `state.config.mapWidth/Height`. The
~40 systems iterate those records directly. A count of the assumption, measured:

| Flat-town reference | occurrences |
| --- | --- |
| `state.firms` | ~500 |
| `state.facilities` | ~400 |
| `state.citizens` | ~240 |
| `state.districts` / `state.cohorts` | ~160 |

That is **~1,300 call sites** that assume "the town is the world." The region
refactor is fundamentally about moving those records down one level — from
`state.firms` to `state.towns[townId].firms` — and teaching every system which
town it's operating on.

### The finding from the exploration: stubs, not reusable towns

The tempting shortcut is "the town-building code is already reusable — call
`createInitialState` N times and staple the results together." **It is not
reusable in that shape,** and the exploration is worth writing down so the next
era doesn't rediscover it:

- **`createInitialState` builds a `GameState`, not a `Town`.** Population,
  founders, the map, the world firm, the trade-city books, the ledger — it wires
  a whole *world* in one pass. There is no `Town` seam inside it to call twice.
  Extracting one is a real piece of work: everything town-scoped (citizens,
  firms, facilities, districts, cohorts, market stats, map dims) has to become a
  `Town` struct; everything world-scoped (rng, clock, money/ledger, the trade
  graph, achievements/missions) stays on `GameState`.
- **Entity ids are region-unique already** (`nextId` off shared counters), so
  ids don't need namespacing — but **cross-references are untyped strings**
  (`ownerFirmId`, `facilityId`), and nothing today records which town an entity
  lives in. Every entity needs a `townId` (or must live under its town's record)
  before a system can ask "the firms *in this town*."
- **Cohorts are keyed `districtId:tier`** — districts are an *intra-town*
  subdivision, not a multi-town axis. Districts do **not** give regions for free;
  a region is a layer *above* the district/cohort machinery, not a reuse of it.
- **The trade cities are the honest seed.** They already are "a place the
  economy reaches but the player doesn't simulate," with their own per-product
  prices. Growing them from a price stub → a demand pool (this arc) → a producing
  economy → a fully-simulated town is a **gradient**, and each step is
  independently shippable and flag-gateable. That gradient is the migration path.

So the refactor is: **(1)** carve a `Town` struct out of `GameState` (the
mechanical but sprawling ~1,300-site move); **(2)** give every system a town
context (the dispatcher already threads `SimContext` — add the town to it);
**(3)** turn the single `tradeCities` book into the region's trade graph, with
the demand pools as the partner towns' consumption. Step (3) is the only part
that is *new economics*; (1) and (2) are disciplined plumbing that the
bit-identity harness can keep honest one file at a time.

## The migration path

Determinism and save-compatibility make a big-bang refactor unaffordable — the
orchestrator bounces any patch that drifts the pinned village. So the region
lands as a **flag-gated gradient**, the same discipline every world-scale arc
has used (`servicesEnabled`, `realEstateEnabled`, `investorsEnabled`, and now
`tradeDemandPoolsEnabled`):

1. **Demand pools (this arc).** Trade cities consume and price against cover.
   Off by default; a City game opts in; the pinned village/city runs are
   byte-identical. *Shipped.*
2. **Producing trade cities.** The pool gains a supply side (the partner town
   produces some of what it consumes; exports fill the *gap*, not the whole
   larder). Still a stub economy — no map, no agents — but a two-sided one.
   *Shipped — see "What ships now — producing trade cities (step 2)" below.*
3. **The `Town` struct.** The single-town `GameState` becomes
   `state.towns = { home: Town }` — a **one-town region** that must reproduce
   today's pinned runs to the byte (the migration is "wrap the existing records
   in a `home` town, thread the context, change nothing else"). This is the big
   mechanical step, landed as a pure refactor and measured as one. *First slice
   shipped as a `Town` **view** (the safe first move) — see "What ships now — the
   Town seam (step 3, first slice)" below.*
4. **A second simulated town.** With the struct in place, a partner trade city
   graduates from pool to a real (small) simulated town. The freight edge
   carries goods between two live economies.
5. **The region UI.** A town switcher; the Gazette and trade desk report
   per-town and cross-town. (This arc adds the smallest seed of that: the trade
   desk now reports *both* partner cities' *cover*, and the advisor nudges an
   export when a partner runs thin on stock the player holds.)

Save migration rides the existing `SAVE_VERSION` machinery: step 3's wrap is one
versioned migration (old saves load into `towns.home`), exactly the pattern D1
used to stamp `archetype` onto every firm.

## Out of scope (and why)

- **The full `Town` refactor is NOT in this arc.** ~1,300 call sites behind an
  absolute bit-identity contract is not a slice; attempting it here would put
  the pinned village at risk for a feature nobody can play yet. Arc E ships the
  *plan* for it and the *first economics* it enables.
- **Migration of people/capital between towns.** The region's freight graph
  moves *goods* first (this is the export game we already have). People moving
  towns (regional labor markets) and capital moving towns (cross-town ownership)
  are their own arcs — they need the `Town` struct to exist first.
- **The demand pool is a price model, not a second town's ledger.** It holds
  **no money** — exports still settle firm↔`WORLD_ACCOUNT` through
  `recordTransaction`, conserved to the cent. A pool that *held* cash would be a
  second money holder to keep conserved across freight, which is step 2/4's
  problem, not this slice's. Keeping the pool cash-free is the deliberate honest
  scope line: it changes **prices**, nothing else.
- **New rng-consuming behavior.** The pool draws **zero** shared-rng — every
  quantity is a deterministic function of population × spec × stored inventory.
  This is what lets it be flag-gated without touching the pinned trajectories,
  and it keeps the region's future determinism story simple.

## What ships now — trade-city demand pools

The slice, in one paragraph: **each opt-in trade city grows a tiny cohort-style
consumption pool.** It has a population and, per consumer product, an inventory
that exports refill and daily consumption drains. Its export quote picks up a
**cover-driven premium or discount** — thin stock pays up, an export overhang
sells off cheap — layered on top of the existing seeded walk. Dumping 500 units
of bread on Port Rosa now depresses its bread price for *days* (the shipment is
a real inventory overhang that consumption works off over ~a week) instead of a
single impact tick; a starved city pays a premium until its larder refills.

### Design decisions

1. **Flag-gated, not layered-live — and why.** The demand pool writes per-city
   inventory into the serialized state and bends the export quote. The
   bit-identity contract hashes the **whole** state (village seeds 1/11/777, city
   seed 11) and the city's pinned `tierAcceptance` bands read export prices — so
   a pool that ran in the pinned baselines would drift them even though it draws
   no rng. Therefore the honest choice is a config flag
   (`tradeDemandPoolsEnabled`, default off): with it off **no pool key is written
   and the trade book is byte-identical to pre-Arc-E**, proven by diffing the
   full 300-day village serialized state (the only delta is the one new
   `false` config line, exactly as every prior arc's flag). A City world opts in;
   the probe and tests opt in explicitly. *This is option (b) from the arc brief
   — preset/flag-gated with the walk untouched in pinned runs — chosen over
   "layer on top with zero rng draws" because the pinned check hashes state, not
   just rngState, so even a rng-free price bend would fail it.*
2. **A price model, not a money holder.** The pool holds no cash. Exports settle
   world→firm through `recordTransaction` unchanged; the pool just tracks virtual
   inventory and the quote reads its cover. Conservation is untouched by
   construction (probe + test: money invariant across a pooled export).
3. **The pool replaces the one-tick impact for POOLED PRODUCTS.** Pre-Arc-E, a
   large export slammed the book via `applyPriceImpact` and the daily walk
   healed it — a crude, sizeless overhang proxy. A pooled consumer product on a
   pool city instead routes the shipment into the larder (`feedPool`), and the
   durable supply signal comes from **cover**: an overhang that scales with dump
   size and works off with consumption. Because the fed inventory is read *live*
   by the next `cityPrice`, splitting a dump across sub-orders self-penalizes
   (each sub-order sees higher cover), so the anti-arbitrage guarantee the
   one-tick impact provided is preserved — and made *more* persistent (cover
   doesn't heal overnight the way the walk did). The guard is PER-PRODUCT:
   raws/intermediates a pool never stocks keep the classic one-tick impact even
   on a pool city (the review caught a city-level guard silently exempting raw
   exports from all impact — the exact riskless round-trip the impact exists to
   prevent). Forward settlement is now UNIFIED with the spot path (Arc E
   follow-up): a settling forward SHIPS goods into the city, so for a pooled
   consumer good on a pool city the delivered quantity feeds the larder through
   the same per-product guard (`pool?.inventory[productId] !== undefined`) — a
   delivered forward creates the exact cover overhang a spot export of the same
   size would (measured below). The sign/close paper impacts on the walk stay as
   they are, and correctly so: signing (and closing) hedges the city's *demand*
   at paper time when **no goods move**, so there is no larder delta to book then
   — only settlement puts physical stock on the shelf. A deliberate default (the
   15% penalty path) delivers nothing and feeds nothing. *(This resolves the
   "known divergence" an earlier draft of this doc flagged — a forward delivery
   creating no overhang a spot export would.)*
4. **Consumption from spec midpoints, no second demand table.** Per-capita daily
   consumption is read straight off each product's `needSpec` at its midpoint
   (`growthPerDay` midpoint × `preferredQuantity`) — the same numbers the crowd's
   cohorts grow from. A staple (bread) drains fast, a luxury (jewelry) barely at
   all, and there's no hand-authored demand table to keep in sync with the
   catalog. Raws/intermediates (no `needSpec`) aren't consumed by the populace —
   they carry no pool and quote the bare walk.
5. **Unit-elastic cover response, clamped.** The cover multiplier is
   `target_stock / actual_stock` (elasticity 1.0 — a constant-expenditure demand
   curve, quote ∝ 1/stock), clamped to `[0.65, 1.55]×` so a single dump or
   shortage layers *within* the walk's own `[0.6, 1.8]×` band, never past it. A
   pre-announced **tender** (the Gazette's existing trade-shock news) throttles
   the city's restock, so the headline shock bites through *real cover* — the
   larder runs down and the premium is physical, not just a walk-center shift.
6. **Deterministic and sorted throughout.** Zero shared-rng draws; the daily pool
   loop iterates the preset's product list in catalog order; floats are IEEE-
   deterministic. Two pooled runs of a seed agree bit-for-bit through a dump
   (probe + test).

### The smallest honest surface

Where the game already reports export prices — the Gazette's **trade desk** —
each row now shows **cover in days on BOTH ports** when a pool is live (`🔥`
thin / `🧊` glutted, each chip prefixed by its port's emoji), so the reader sees
the full supply picture — which port is short, which is glutted — not just the
one the desk routes to. And the **morning advisor** gains a pool-aware nudge: it
tells the player to ship into a thin port's premium when they actually hold
exportable stock of what that port is short of (cover below the `🔥` thin bar,
`TRADE_POOL_THIN_COVER_DAYS = 4`, ≥ 10 units on hand) — the desk shows the
shortage, the advisor turns it into an action. Both are cover-driven (no rng)
and inert flag-off by construction (no pool ⇒ nothing to read). No new panel;
the classic pure-walk desk and advisor (flag off) are unchanged.

**Skipped (smallest honest surface):** no dedicated pool/region panel, no
per-product cover history sparkline, no second advisor line stacking multiple
thin ports — one nudge for the first held-and-short product is enough for a
briefing, and the desk already carries the full both-port read. The advisor's
walk-price premium line (#5) is kept distinct from the cover line (#5b): a walk
spike and a drained larder are different signals and can fire independently.

### Measured (trade-pool probe, City preset, seed 11)

- **Overhang, from a neutral center, dump 500 bread on Port Rosa:**
  before (walk only) slams to the 0.60× floor and the *walk* bounces it around
  (0.60 → 0.66 → 0.70 → … noisy); after (pool on) the quote sits at **0.74×** and
  recovers **monotonically** as consumption works the overhang off
  (0.74 → 0.76 → 0.78 → … → 0.91 by day 10) — a real inventory decay curve.
- **Overhang scales with dump size** (the property the sizeless one-tick impact
  cannot reproduce): 200 units → 0.87× for ~8 days; 500 → 0.74× for ~15 days;
  1000 → 0.65× (clamp) for ~21 days; 1500 → 0.65× for ~24 days (more stock to
  work off ⇒ a longer glut even at the same clamped depth).
- **Starvation premium** (larder drained to ~1 day of cover): quote pays up to
  **~1.25–1.39×** and holds for ~6 days until restock refills the shelf.
- **Forward settlement feeds the pool** (Arc E follow-up; deliver 200 bread by
  forward vs a deliberate default, walk held at center, measured 3 days out at
  settlement): **before** — a settling forward moved no larder, so its quote sat
  at the **1.000×** baseline (no overhang, cover 6.0d). **After** — the delivered
  200 units land the quote at **0.874× (cover 6.9d)**, the *exact* overhang a
  200-unit **spot** dump produces (0.874× in the sizing table above) — settlement
  is now unified with the spot path. A **deliberate default** (nothing staged)
  ships nothing and its larder is **byte-identical to the no-forward baseline**
  (1.000×, cover 6.0d) — delivers nothing, feeds nothing. Money invariant across
  the delivered settlement (Δ = 0).
- **Conservation:** money invariant across a pooled export (Δ = 0).
- **Determinism:** two seed-7 pooled runs agree bit-for-bit (inventory, rngState,
  full serialized state).
- **Pinned baselines (flag off):** village seeds 1/11/777 reproduce their exact
  300-day `rngState`; city seed 11 reproduces its `rngState` and money supply;
  the full suite is green. The only serialized delta anywhere is the new
  `tradeDemandPoolsEnabled: false` config line.

## What ships now — producing trade cities (step 2)

Step 1 gave each opt-in trade city a **consumption** pool; step 2 makes it
**two-sided**: the partner town now *produces* a fraction of what it consumes,
so **exports fill the GAP its production leaves, not the whole larder.** The
result is genuine specialization — a port's export market DEEPENS in what it
under-produces and SHRINKS in what it self-supplies.

### The model (one daily update, in `TradeCitySystem.updatePools`)

Every day, per pooled product: the city eats its ration (`drain`), its own
producers add `localProd` (a fixed FRACTION of `drain`, **unthrottled** — the
stub town's own economy), and **imports** (the throttleable restock tender)
cover only the remaining gap:

```
imports = max(0, (drain − localProd) + (target − inv) × REPLENISH_RATE) × throttle
inv'    = max(0, inv − drain + localProd + imports)
```

Two properties fall out and are load-bearing:

- **Equilibrium is untouched.** At `inv = target` with no tender, `imports =
  (drain − localProd)` exactly replaces the consumption production doesn't, so
  `inv' = inv` and the quote stays on the bare walk (mult 1.0). A seeded-at-
  target pool therefore quotes **identically to step 1 day-to-day** — only
  *shocked* trajectories diverge. This is why step 2 disturbs no standing price.
- **A deep overhang can only work off through `drain − localProd`.** When the
  larder is far over target the gap-pull term drives `imports` to its zero floor
  (a city doesn't ship its own glut away), so the surplus drains at
  consumption-minus-production. A good the port SELF-SUPPLIES (high `localProd`)
  lingers hard and long; a good it IMPORTS (low `localProd`) is absorbed fast.

Production is data on each city def (`productionByProduct`), read at the same
needSpec spec-midpoints consumption is — **deterministic, no rng, holds no
money** (the town's own economy, same rationale as consumption). Flag-off there
is no pool, so `updatePools` never runs and the book stays byte-identical.

### Per-city production profiles (fraction of own consumption produced locally)

The two ports mirror each other, respecting the existing `cityBias` flavor —
Port Rosa (🚢) food-leaning, Ironvale (🚂) industrial:

| product | category | Port Rosa | Ironvale |
| --- | --- | --- | --- |
| bread | food | **0.85** | 0.20 |
| coffee | food | 0.75 | 0.25 |
| meals | food | 0.75 | 0.25 |
| pastries | luxury | 0.55 | 0.30 |
| wine | luxury | 0.55 | 0.25 |
| clothes | apparel | 0.20 | 0.75 |
| shoes | apparel | 0.20 | 0.75 |
| tools | durable | **0.15** | 0.85 |
| furniture | durable | 0.20 | 0.80 |
| appliances | durable | 0.15 | 0.80 |
| jewelry | luxury | 0.20 | 0.75 |

Fractions are held below 1.0 by design — a port is at most self-sufficient,
never a net exporter, so a dump can always work off (just slowly where its own
output keeps refilling). Read as: **each port is hungry for the other's
specialty.** Port Rosa's deep import markets are tools/apparel/finery (it makes
almost none); Ironvale's is food (bread/coffee/meals). Those are the products
whose cover runs chronically thin and whose desk chip shows a persistent 🔥.

### The specialization (measured — trade-pool-production probe, City, seed 11)

Dump 50% of a port's target buffer on it and time how long the overhang holds
(cover works back within 5% of target; walk held at center to isolate the pool):

| dumped good | Port Rosa (self/import) | Ironvale (self/import) |
| --- | --- | --- |
| **bread** | 85% made → overhang **~23 days** | 20% made → **~18 days** |
| **tools** | 15% made → overhang **~18 days** | 85% made → **~23 days** |

Same `d0` discount (0.667× — the dump is the same fraction of target), but the
good the port MAKES lingers ~5 days longer. Each port holds its own specialty's
glut and absorbs the other's — the mirror.

**Under a tender** (annMult 1.5, 6 days, same city Port Rosa) the gap-only
imports let production shield the self-supplied good while the imported one
starves: bread (85% made) drains only to **1.12×** cover-mult (inv 0.90×
target), tools (15% made) starves to the **1.55× clamp** (inv 0.41× target).
The headline shock bites hardest exactly where the port can't self-supply.

### Overhang curves — before/after the supply side (dump 500 bread, Port Rosa)

Port Rosa now grows 85% of its own bread, so a bread dump overhangs harder AND
longer than step 1's import-only pool:

- **Walk only (pre-Arc-E):** slams the 0.60× floor, then the walk bounces it
  noisily (0.60 → 0.66 → 0.70 → 0.74 → … non-monotonic).
- **Step 1 (import-only pool):** 0.74× → 0.91× over 10 days, monotonic.
- **Step 2 (producing pool):** **0.737× → 0.889×** over 10 days — a shallower
  recovery (its own bakers keep refilling), and size sensitivity stretches:
  200u depressed **~8d**, 500u **~17d**, 1000u **~25d**, 1500u **~25d** (step 1
  was ~8 / ~15 / ~21 / ~24 — every dump lingers longer on the food-rich port).

### Surface (step 2 adds nothing new — deliberate)

The specialization is already visible in step 1's cover chips: a port chronically
thin on a good it under-produces shows a persistent 🔥, and the advisor's cover
nudge points the player at shipping into it. Both read `poolCoverDays` off the
same pool — with production live they simply carry a *truer* signal (Ironvale's
food chip and Port Rosa's tools chip now sit thin structurally, not by chance).
No new panel, no "local vs imported" share label: the honest minimal surface is
the one already there. Verified: the desk chips and advisor hint stay sensible
flag-on and inert flag-off (no pool ⇒ nothing to read).

### Measured (flag-on drift and conservation)

- **playtestV8 (seed 11) re-pinned honestly.** The bot dumps a staple onto
  food-rich Port Rosa, which now self-supplies 85% of its bread — so each dump
  overhangs harder and the play is genuinely less lucrative. Net worth day-250:
  **$60.0k → $62.8k (+$2.8k)**, down from step 1's +$8.2k (the AI's exports feed
  the same two-sided pools, so cross-firm valuations drift too); still solvent,
  still a materially larger book, still conserved to the cent. Floor re-pinned to
  **+$1.5k** with the measured cause documented in the test — the band tracks the
  new regime, it is not widened to hide it. All six legs still fire (lease rent
  $194, forward −$16.85, salvage $1,584, three pool exports moving cover — all
  bit-identical to step 1).
- **Equilibrium & standing prices:** a seeded-at-target City pool quotes the bare
  walk on every product for 8 days running (test) — step 2 drifts no standing
  price, which is why the pinned city/village baselines are untouched.
- **Conservation:** money invariant across 20 days of pure production/consumption/
  import churn (production books no transaction) and across a pooled export.
- **Determinism:** two seed-7 producing-pool runs agree bit-for-bit (inventory,
  rngState, full serialized state).
- **Pinned baselines (flag off) hold unchanged:** village seeds 11/4/7 reproduce
  `rngState` 3274842624 / 2896139677 / 4253583594; city seeds 11/4/7 reproduce
  their `rngState`; the production data lives on the def but never runs without a
  pool, so the serialized book is free of any pool key. Full suite green (551).

## What ships now — the Town seam (step 3, first slice)

Step 3's full move — `state.firms` → `state.towns[townId].firms` across ~1,300
call sites under an absolute bit-identity contract — is not a slice; attempting
it in one patch would put the pinned village at risk for a shape no one can play
yet. So step 3 lands as its own **flag-free gradient**, and this is its first
brick: the `Town` as a **view**, the district family routed through it, and a
recipe the next batches grind through firm-by-firm.

### The design decision — the Town is a VIEW first (option (b)), then MOVE (option (c))

Three ways the flat records and the town records can coexist during the gradient
were weighed:

- **(a) Aliasing** — `state.towns.home.firms` *is* `state.firms` (same object
  reference stored under both paths). Rejected as the FIRST step: the wrapper is
  real serialized state, so the serializer must be taught to skip it or every
  save **doubles** (the records write out under both `firms` and
  `towns.home.firms`). A serializer exclusion is a sharp knife held against the
  one invariant the orchestrator re-verifies to the byte — the wrong tool to
  reach for on move one.
- **(b) The Town is a VIEW** — `townOf(state,'home').districts` is a getter that
  returns `state.districts`; the town is **computed, never stored**. No `towns`
  key enters a save, so serialization is byte-identical and there is **zero
  migration**. Systems adopt `townOf(...)` one call site at a time; each
  conversion is provably behaviour-identical because the accessor returns the
  *same object* the flat path did. **Chosen.** It is the smallest step that still
  makes real structural progress: it introduces the town *seam* (the `townId`
  context + the accessor every future system will call) without moving a single
  byte of state.
- **(c) Records genuinely MOVE** — `state.towns[townId].firms` becomes the home
  of the records, with back-compat getters left at the old flat paths. This is
  the *endgame* shape, but the riskiest first step: it is a real serialized-shape
  change (a versioned migration) landed at the same time as the ~1,300-site read
  conversion, so a drift can come from either half and the bisect is muddy.

**Why (b) then (c) is the right order.** Option (b) lets every reader convert and
be proven identical *before* any byte of state moves — the risky serialized-shape
change (c) then lands against a codebase where every call site already routes
through `townOf`, so it swaps only the accessor's two getters
(`return state.districts` → `return state.towns[townId].districts`) plus a single
versioned migration, and **no call site changes on that day**. The bit-identity
harness bisects cleanly: read-conversion drift (b) and shape-move drift (c) never
mix in the same patch. This is the same flag-gated-gradient discipline steps 1–2
used, applied to a refactor instead of a feature — the referee is bit-identity,
one file at a time, and an honest measured NO-SHIP on any batch is a complete
result.

### The seam, as landed

- **`core/Town.ts`** — `TownId`, `HOME_TOWN_ID = 'home'`, the `Town` view
  interface (`districts`, `cohorts`, `citizens`, `marketStats` getters today;
  firms/facilities/map-dims join batch by batch), and `townOf(state, townId =
  HOME_TOWN_ID): Town`. The getters delegate to the flat records, so
  `townOf(state,'home').districts === state.districts` (same reference). One tiny
  allocation per call; hoist it to a local at the top of a hot loop.
- **`SimContext.townId`** — the town this tick's systems operate on, threaded
  through the existing context the dispatcher already builds. `makeContext` sets
  it to `HOME_TOWN_ID`. A system reads its town's records through
  `townOf(ctx.state, ctx.townId)`.
- **No serialized-state change.** No `towns` key, no `townId` field on any
  entity, no migration. `SAVE_VERSION` is untouched. The whole seam is compile-
  time + in-memory.

### The family converted — districts (the smallest, already town-scoped)

Every **district reader** in the sim layer now routes through the accessor —
**14 call sites across 8 files** (the family's writers stay on the flat path; the
view is read-only by design, and record creation moves in option (c)):

| file | reader sites | town context |
| --- | --- | --- |
| `systems/DistrictSystem.ts` | 3 | `ctx.townId` (hoisted `town`) |
| `systems/CastCuratorSystem.ts` | 5 | `ctx.townId` (4) + home default (1, bare-`state` helper) |
| `systems/CohortDemandSystem.ts` | 3 | `ctx.townId` (2) + home default (1) |
| `systems/CrowdRentSystem.ts` | 1 | `ctx.townId` |
| `systems/RetailDemandSystem.ts` | 3 | `ctx.townId` (hoisted `town`) |
| `systems/CohortSocialSystem.ts` | 1 | home default (bare-`state` helper) |
| `core/DistrictSlots.ts` | 1 | home default (shared helper) |
| `data/startingScenario.ts` | 1 | home default (init reader) |

After conversion, the only remaining flat `state.districts` in sim code are the
two **writers** (`startingScenario` creates the partition, `migrations` defaults
it) and the accessor's own single flat read inside `townOf`. The district
*helpers* (`districtAt`, `shoppingDistrictIds`) already take the districts record
as a parameter, so a converted site just passes `town.districts` in place of
`state.districts` — the helper bodies never changed.

### The family converted — cohorts (the district family's sibling)

Every **cohort reader** in the sim layer now routes through the accessor —
**46 reader references across 9 files** (the family's writers stay on the flat
path; the view is read-only by design):

| file | reader refs | town context |
| --- | --- | --- |
| `systems/CrowdRentSystem.ts` | 10 | `ctx.townId` (hoisted `town`) + home default (1, `anyCrowd`) |
| `systems/CohortSocialSystem.ts` | 9 | `ctx.townId` (hoisted `town`) + home default (`anyCrowd`, `runMigration`) |
| `systems/CohortLaborSystem.ts` | 7 | `ctx.townId` (hoisted `town`, presence loop) + home default (`anyCrowd`, `reconcileCrowdJobs`) |
| `systems/CohortDemandSystem.ts` | 7 | `ctx.townId` (hoisted `town`: `growBuckets`, `runSlice`) + home default (1, `anyCrowd`) |
| `systems/CastCuratorSystem.ts` | 4 | `ctx.townId` (hoisted `town` in `curate`) + home default (1, `anyCrowd`) |
| `systems/PayrollSystem.ts` | 3 | `ctx.townId` (hoisted `town`, `payCrowd`) + home default (1, `releaseCrowd`) |
| `systems/AIFounderSystem.ts` | 2 | home default (`townPopAndSat` bare-`state` helper) |
| `systems/RetailDemandSystem.ts` | 2 | home default (`anyCohortPopulation` bare-`state` helper) |
| `selectors/reportSelectors.ts` | 2 | home default (`challengeScore` bare-`state` helper) |

After conversion, the only remaining flat `state.cohorts` in sim code are the
**writers** (`startingScenario` creates the partition, `migrations` defaults it,
and the two tier-promotion CREATION sites — `CohortSocialSystem.moveTier` and
`CastCuratorSystem.retire` — that mint a new tier cohort), the accessor's own
single flat read inside `townOf`, the `GameState.cohorts` type definition, and
the **region-wide money primitive** in `GameState.ts`. That last group — the
account-resolution trio (`getAccountCash` / `accountExists` / `addAccountCash`
under `recordTransaction`) and the `totalMoneySupply` conservation sum — is a
money-scope subtlety the districts family never hit: money moves *between* towns,
so a cohort account is resolved by id across the WHOLE region, and the
conservation invariant sums every town's cohort cash. Routing those through the
home-default `townOf(state).cohorts` would misrepresent their scope, so they stay
flat by design (at the endgame they read the flat `state.cohorts` back-compat
getter that aggregates all towns), each marked with a comment saying so. As with
districts, the cohort *helpers* that already take a `Cohort` by parameter
(`rentAffordFactor`, `updateSatisfaction`, `runTierGates`) never changed — a
converted site just reads `town.cohorts[cid]` and hands the object in.

### The family converted — marketStats (the per-product town book)

Every **marketStats reader** in the sim layer now routes through the accessor —
**22 reader sites across 16 files** (the family's writers stay flat: the
`emptyMarketStat` partition in `startingScenario`, and the migration defaulter
in `migrations`, which also runs pre-context on raw loaded state):

| file | reader sites | town context |
| --- | --- | --- |
| `systems/MarketStatsSystem.ts` | 2 | `ctx.townId` (hoisted `town`) — the daily rebuild reads the existing book via the view and mutates each entry in place (reads-then-mutate, same object) |
| `systems/RetailDemandSystem.ts` | 2 | `ctx.townId` (`scoreStore`, `attemptPurchase`) |
| `systems/CohortDemandSystem.ts` | 2 | `ctx.townId` (`cohortStoreScore`, `attemptCohortPurchase`) |
| `systems/ai/OperatorBehavior.ts` | 2 | `ctx.townId` (hoisted `town`, `maybeBoostProduction`) |
| `systems/ai/expansion.ts` | 1 | `ctx.townId` (`maybeExpand`) |
| `systems/EventLogSystem.ts` | 1 | `ctx.townId` (hoisted `town`) |
| `systems/LogisticsSystem.ts` | 1 | home default (`transferValue` bare-`state` helper) |
| `systems/AIFounderSystem.ts` | 1 | home default (`smoothedFillRate` bare-`state` helper) |
| `selectors/marketSelectors.ts` | 3 | home default (`marketStat`, `marketRows`, `pricingInsight`) |
| `selectors/gazetteSelectors.ts` | 1 | home default (ticker) |
| `selectors/reportSelectors.ts` | 1 | home default (`quarterReport`) |
| `selectors/debugSelectors.ts` | 1 | home default (`macroIndicators`) |
| `selectors/advisorSelectors.ts` | 1 | home default (`morningBriefing`) |
| `selectors/citizenSelectors.ts` | 1 | home default (`spendingPower`) |
| `core/Wholesale.ts` | 1 | home default (`wholesaleUnitPrice` bare-`state` helper) |
| `data/missions.ts` | 1 | home default (`morning_rush` check callback) |

The daily `MarketStatsSystem` rebuild deserved a second look under step 3's
writer rule: it never REPLACES `state.marketStats` wholesale — it reads each
existing per-product entry through the view and mutates it in place (finalize
average price/quality/share, then reset the day's accumulators). That is a
reads-then-mutate on the same object reference the flat path held, so it routes
through `town.marketStats` like any reader; only the `emptyMarketStat` creation
(startingScenario, migrations) is a genuine writer and stays flat.

### The family converted — citizens (the cast side of the crowd)

Every **citizen reader** in the sim layer now routes through the accessor —
**70 reader sites across 28 files**:

| file | reader sites | town context |
| --- | --- | --- |
| `systems/LaborSystem.ts` | 9 | `ctx.townId` (hoisted `town`: `runLaborSystem`, `runJobMarket`) + home default (`trainCrew`, `hireCitizen`, `fireCitizen`, `findUnemployed`, `growSkills`) |
| `systems/ImmigrationSystem.ts` | 5 | `ctx.townId` (hoisted `town`, `runImmigrationSystem`) + home default (`runEmigration` pick loop) |
| `systems/RetailDemandSystem.ts` | 4 | `ctx.townId` (hoisted `town`: `runRetailDemandSystem`, `runRestockRevisitSystem`) |
| `systems/PayrollSystem.ts` | 4 | `ctx.townId` (hoisted `town`, `runPayrollSystem`) + `ctx.townId` (`quit`) |
| `systems/CastCuratorSystem.ts` | 3 | `ctx.townId` (hoisted `town`, `curate`) + home default (`pickRetiree`) |
| `systems/ai/OperatorBehavior.ts` | 3 | `ctx.townId` (hoisted `town`, `manageWages`) |
| `systems/AccountingSystem.ts` | 2 | `ctx.townId` (hoisted `town`) |
| `systems/CitizenScheduleSystem.ts` | 2 | `ctx.townId` (hoisted `town`) |
| `systems/CohortSocialSystem.ts` | 2 | home default (`runMigration`, reuses its hoisted `town`) |
| `systems/MovementSystem.ts` | 2 | `ctx.townId` (hoisted `town`) |
| `systems/SatisfactionSystem.ts` | 2 | `ctx.townId` (hoisted `town`) |
| `systems/TierSystem.ts` | 2 | `ctx.townId` (hoisted `town`) |
| `systems/TownStatsSystem.ts` | 2 | `ctx.townId` (hoisted `town`) |
| `systems/AIFounderSystem.ts` | 1 | home default (`townPopAndSat` bare-`state` helper) |
| `systems/CohortDemandSystem.ts` | 1 | `ctx.townId` (reuses the slice-2 hoisted `town`, `castPop`) |
| `systems/RentSystem.ts` | 1 | `ctx.townId` (hoisted `town`) |
| `core/Simulation.ts` | 4 | home default (command handlers: `fund_home`, `setWage`, `hire`) |
| `core/Acquisition.ts` | 1 | home default (crew transfer) |
| `core/FireSale.ts` | 1 | home default (crew transfer) |
| `data/achievements.ts` | 6 | home default (check callbacks) |
| `data/startingScenario.ts` | 2 | home default (`employ` init reader, cast id roster) |
| `selectors/citizenSelectors.ts` | 4 | home default (`getCitizen`, `allCitizens`, `laborMarketStats`, `employerBreakdown`) |
| `selectors/facilitySelectors.ts` | 2 | home default (`facilityEmployees`, `facilityProfitContribution`) |
| `selectors/marketSelectors.ts` | 1 | home default (`pricingInsight` WTP loop) |
| `selectors/reportSelectors.ts` | 1 | home default (`challengeScore`) |
| `selectors/debugSelectors.ts` | 1 | home default (`citizenCount`) |
| `selectors/companySelectors.ts` | 1 | home default (`firmEmployees`) |
| `selectors/satisfactionSelectors.ts` | 1 | home default (`satisfactionAnatomy`) |

After conversion, the only remaining flat `state.citizens` in sim code are the
**writers** (the `createCitizen` sinks in `factories` and `startingScenario`;
the `delete state.citizens[...]` in `LaborSystem.removeCitizen`, the one removal
path emigration and cast retirement share), the accessor's own flat read inside
`townOf`, the `GameState.citizens` type definition, `migrations` (which runs
pre-context on raw loaded state), and the **region-wide money primitive** in
`GameState.ts`. That last group — the account-resolution trio (`getAccountCash`
/ `accountExists` / `addAccountCash` under `recordTransaction`) and the
`totalMoneySupply` conservation sum — is the same money-scope subtlety the
cohorts family hit: money moves *between* towns, so a citizen account is
resolved by id across the WHOLE region, and conservation sums every town's
citizen cash. Routing those through the home-default `townOf(state).citizens`
would misrepresent their scope, so they stay flat by design (at the endgame they
read the flat `state.citizens` back-compat getter that aggregates all towns),
each marked with a comment saying so. Note `saveLoad`'s `raw.citizens` count is
over the parsed JSON, not `state`, so it is not a seam site at all.

### The conversion recipe (for the firms/facilities/citizens batches)

Grind each remaining family with the same four-move recipe:

1. **Add the getter to the `Town` view** — one line in `core/Town.ts`
   (`get firms() { return state.firms; }`) plus the field on the `Town`
   interface.
2. **Convert readers, family by family.** In a **ctx-scoped** system, hoist
   `const town = townOf(ctx.state, ctx.townId)` once at the function top and read
   `town.firms`; where the record is passed to a helper, pass `town.firms`
   instead of `state.firms`. In a **bare-`state` helper** mid-gradient, call
   `townOf(state).firms` (the home default is identity in a one-town region) and
   leave a comment that it gains a `townId` param at the endgame move. **Convert
   readers only** — leave writers (record creation) on the flat path until (c).
3. **Prove each batch identical.** The accessor returns the same object, so the
   whole pinned suite (village 11/4/7 `rngState`, city seed 11, full serialize)
   is the referee. Run it after each family; an honest measured NO-SHIP (a batch
   that *can't* stay identical) stops that batch, not the arc.
4. **Fails-on-revert check.** Break the accessor in a scratch edit (return `{}`
   or the wrong family's record) and confirm a pinned test goes red before
   committing the batch — proof the harness actually guards the conversion.

The endgame (c) then edits only `townOf`'s getters + one migration; every site
converted in steps 1–4 is already correct.

### Remaining families (estimated reader sites, measured `state.X` counts)

| family | `state.X` refs (all) | non-test sim readers (est.) | notes |
| --- | --- | --- | --- |
| **districts** | — | **DONE (14 sites, 8 files)** | step 3 first slice |
| **cohorts** | ~128 | **DONE (46 refs, 9 files)** | step 3 second slice; the money-scope reads (account primitive + `totalMoneySupply` conservation) stay flat by design — region-wide, they read all towns at the endgame |
| **firms** | ~500 | **DONE (230 refs, 49 files)** | step 3 fourth slice, harvested as two file partitions (systems/ 149 refs / 30 files; core+selectors+data 81 refs / 19 files); `ownerFirmId` cross-refs are reads and converted; writers flat: the four founder creation sites + two abandon deletes in `AIFounderSystem`, the acquisition delete, the `startingScenario` creation; the money-primitive reads in `GameState.ts` stay flat (region-wide) with their comments extended to name firms |
| **facilities** | ~400 | **DONE (226 refs, 55 files)** | step 3 fifth slice, harvested as two file partitions (systems/ 137 refs / 33 files; core+selectors+data 89 refs / 22 files); `facilityId` cross-refs are reads and converted; writers flat: `startingScenario`'s facility creation and `Demolition`'s delete (the only two in sim code — creation runs through the `createFacility` factory, whose sink is the scenario, and every other path mutates existing records through the view); zero facilities refs in the money primitive |
| **citizens** | ~240 | **DONE (70 sites, 28 files)** | step 3 third slice; the money-scope reads (account primitive + `totalMoneySupply` conservation) stay flat by design — region-wide, they read all towns at the endgame |
| **marketStats** | ~40 | **DONE (22 sites, 16 files)** | step 3 third slice; per-product town book |
| **map dims** | small | **DONE (11 sites, 10 files + 3 renderer reads)** | `mapWidth`/`mapHeight` getters on the Town view delegate to `state.config` today and become per-town fields at the endgame; town-scoped readers (placement, slot enumeration, movement bounds, renderer world size) convert; config-construction/serialization/migration/NewGame readers stay on `config`, classified |
| **UI reads** | — | **DONE (7 refs, 2 files)** | `PopulationDashboard` (4: districts, cohorts, districtAt) + `TownRenderer.drawAmbientCrowd` (3: cohorts, districtAt-free district lookup) route through `townOf(state)` (home default — the UI renders the home town, gains a town selector at the endgame); read-only projection, referential behaviour identical (accessor returns the same objects, so React memo/deps unchanged); e2e gauntlet green. UI batch 2 converted the remaining ~80 family reads (14 UI files + ~30 TownRenderer sites); residual flat family reads in src/ui + src/render are ZERO |

### The firms family (fourth slice, two harvest partitions)

The largest family so far converted in one batch, split into two parallel
file partitions (neither touching `Town.ts` — its `firms`/`facilities` getters
landed ahead of the batch precisely so partitions need no shared edit):
**230 reader refs across 49 files** — systems/ (incl. ai/) 149 refs / 30 files
(largest: `OperatorBehavior` 22, `AIFounderSystem` 14, `ai/finance` 13,
`ServiceBillingSystem` 13), core+selectors+data 81 refs / 19 files (largest:
`companySelectors` 18, `Simulation` 20 across its command handlers,
`Acquisition` 10). Ownership cross-refs (`state.firms[fac.ownerFirmId]` and
kin) are reads and converted. Writers stay flat, all classified: the four
founder **creation** sites and two abandon **deletes** in `AIFounderSystem`,
the acquisition `delete` in `Acquisition.ts`, and `startingScenario`'s firm
creation (its mutations of *existing* firms route through the view, matching
the citizens-slice precedent). The **region-wide money primitive** in
`GameState.ts` (account-resolution trio, `recordTransaction`'s firm-ledger
reads, `totalMoneySupply`) stays flat with its comments extended to name
firms — the same money-scope boundary every family with an account kind hits.

### The facilities family (fifth slice, two harvest partitions)

Same two-partition harvest as firms: **226 reader refs across 55 files** —
systems/ 137 refs / 33 files (largest: `OperatorBehavior` 24, `ai/expansion`
12, `LaborSystem` 11), core+selectors+data 89 refs / 22 files (largest:
`Simulation` 18 across its command handlers, `advisorSelectors` 9,
`facilitySelectors` 8, `missions` 8). `facilityId` cross-refs (contract
endpoints, workplace/home lookups, `mgr.facilityId`) are reads and converted.
Only two writers exist in all of sim code and both stay flat:
`startingScenario`'s facility creation (`b.state.facilities[id] = fac`) and
`Demolition`'s `delete` — every other path (labor resets, positioning,
ownership transfer in `FireSale`/`Acquisition`, resident/employee rosters)
mutates an EXISTING record obtained through the view, per the established
precedent. The family has zero refs inside `GameState.ts`'s money primitive,
so nothing needed the region-wide-flat treatment.

### Measured (Town seam, step 3 — districts + cohorts + citizens + marketStats + firms + facilities slices)

- **Accessor identity (test `townSeam.test.ts`):** `townOf(state,'home')
  .districts === state.districts`, `.cohorts === state.cohorts`, `.citizens ===
  state.citizens`, and `.marketStats === state.marketStats` — same reference,
  explicit id and default id alike; the view tracks the live record after 10 days
  of the economy rewriting district desirability.
- **The seam threads:** `makeContext(state).townId === HOME_TOWN_ID`.
- **Serialization byte-unchanged:** no `towns` key in a City save at day 0 or
  after a 20-day run; the flat `districts`/`cohorts` keys serialize exactly as
  before. `SAVE_VERSION` untouched, no migration added.
- **Converted families deterministic:** two City seed-11 runs agree bit-for-bit
  through the converted district systems (`rngState`, full serialized state, and
  every district's `desirability`/`landValue`) over 30 days; a second test proves
  the same for the cohort family — two City seed-11 runs agree on `rngState`, the
  full serialized state, and every cohort's `population`/`employed`/`cashPool`/
  `avgSatisfaction` over 30 days (with the crowd asserted live so the cohort
  readers actually run). A third test proves the same for the citizen AND
  marketStats families together — two City seed-11 runs agree on `rngState`, the
  full serialized state, every citizen's `cash`/`skill`/`satisfaction`/
  `employmentStatus`/`tier`, and every product's `averagePrice`/`unitsSold`/
  `totalInventory`/`history.length` over 30 days (cast asserted non-empty and the
  market book asserted to carry real sales history, so the readers actually run).
- **Mis-conversion is caught (fails-on-revert, demonstrated):** breaking the
  districts accessor in a scratch edit (`get districts() { return {}; }`) turns
  **8 tests red across 3 files** (`townSeam` 3, `districts`, `cohortDemand`).
  Breaking the cohorts accessor the same way (`get cohorts() { return {}; }` —
  the view drops the town's cohorts) turns **28 tests red across 14 files**
  (`townSeam` 2, `cohortRent` 4, `tierAcceptance` 4, `cohortDemand` 3,
  `cohortSocial` 3, `castCurator` 3, `grandJunction` 2, and one each in
  `cohortLabor`, `cityChallenge`, `realEstate`, `founders`, `playtestV8`,
  `retail`, `contractIndex`) — the accessor-identity assertions and the whole
  crowd economy flag it. Breaking the citizens accessor (`get citizens() {
  return {}; }` — the view drops the town's cast) turns **91 tests red across 52
  files**: the cast drives labor, payroll, satisfaction, tiers, immigration, and
  retail demand, so nearly every economy test flags it. Breaking the marketStats
  accessor (`get marketStats() { return {}; }`) turns **266 tests red across 90
  files** — the widest blast radius of any family: the per-product book is read
  with `!` non-null assertions (`town.marketStats[pid]!`) throughout pricing,
  demand, and the daily rebuild, so an empty view throws the moment any product
  is priced or sold. Breaking the firms accessor (`get firms() { return {}; }`)
  turns **151 tests red across 65 files** — payroll, pricing, founders,
  acquisitions, dividends, and every selector that resolves an owner all flag
  it. Breaking the facilities accessor (`get facilities() { return {}; }`)
  turns **160 tests red across 71 files** — production, logistics, labor,
  retail, and rent all read the building stock. Breaking the map-dims getters
  (`return 0`) turns the two accessor-identity assertions red — the
  determinism double-runs stay green because both runs read the same broken
  value, so for a scalar family the identity tests are the load-bearing
  guards. Restoring each getter returns
  the suite to green. The harness demonstrably guards the conversion.
- **Pinned baselines hold:** village seeds 11/4/7 reproduce `rngState`
  3274842624 / 2896139677 / 4253583594; city seed 11 reproduces its `rngState`
  2546912297 and money supply 316900000. Full suite green (**583** = 580 + 1
  citizen/marketStats-determinism seam test + 1 firms-determinism seam test + 1
  facilities-determinism seam test — the last two bit-comparing every firm's
  cash/debt/valuation and every facility's level/status/workers/dailyStats/
  inventories across 30-day City double-runs); `tsc` clean.

### The endgame, as landed (option (c) — the records genuinely MOVE)

With every reader routed through `townOf` (the six-family gradient above), the
endgame swap landed as designed: the record families now LIVE at
`state.towns[HOME_TOWN_ID]`, the flat paths survive as non-enumerable aliases,
and a save serializes only the `towns` key. No converted call site changed —
that was the whole point of landing the accessor first.

**The alias design.** `GameState.towns: Record<TownId, TownRecords>` holds the
six families (`districts`, `cohorts`, `citizens`, `marketStats`, `firms`,
`facilities`). `townOf(state, townId)`'s getters now read
`state.towns[townId] ?? state.towns[HOME_TOWN_ID]` (one-town region: every id
resolves home). The old flat fields (`state.firms`, `state.districts`, ...) are
reinstalled as **non-enumerable accessor properties** by `installTownAliases`
(`core/Town.ts`), each `get`/`set` aliasing `towns[HOME_TOWN_ID].X`:

- a straggler reader or an un-converted **writer** (`state.firms[id] = ...`,
  `delete state.facilities[x]`) mutates the live home-town record through the
  getter — every writer left flat by the gradient keeps working unchanged;
- a **wholesale-replacement** writer (`state.districts = {...}`, the migration
  defaulter's `state.cohorts = state.cohorts ?? {}`) replaces the record inside
  `towns.home` through the setter;
- because the aliases are **non-enumerable**, `JSON.stringify` skips them — a
  save carries `towns` and NOT the six flat keys, so there is **no doubling**.
  This is exactly what makes option (c) sound where the naive aliasing option
  (a) was rejected: the serializer needs no exclusion list; the property
  descriptor does the work. `installTownAliases` is called from every
  construction path — fresh game (`createInitialState`), deserialize, and
  migration — so the aliases are always present on a live state.

**`SAVE_VERSION` 3 + migration.** The version bumped 2 → 3. `migrations.ts`
gains a `v2 -> v3` step that wraps an old save's flat records into
`towns.home` and drops the flat keys; a v3-native save deserializes `towns`
directly. BOTH paths then `installTownAliases` before `normalize` runs (so
normalize's reads and wholesale-replacement writes route onto the home town).
An old save has no `towns` key; the step supplies it. Golden saves v1–v8 (flat,
`saveVersion` ≤ 2) are now ALSO the migration corpus: all load, run conserved,
and round-trip (`serialize(again) === serialize(state)`) through the wrap.

**The hazard audit (spread/clone/serialize sites that assumed the six families
are enumerable own-properties of `state`).** Swept the whole tree:

- `{...state}`, `structuredClone(state)`, `Object.keys/entries/values(state)`,
  `for..in state`, `JSON.parse(JSON.stringify(state))` in production: **none
  found** — nothing enumerates `state`'s own top-level keys, so the key-set
  change (six keys → one `towns` key) breaks no production path.
- `saveMeta` (`saveLoad.ts`) read `raw.firms`/`raw.citizens` off the parsed
  save JSON — updated to read `raw.towns?.home ?? raw`, so it reads new saves
  (under `towns.home`) and old ones (flat) with no migration.
- `serialize`/`deserialize`/`cloneState`, `normalizedSerialize`, autosave/save
  slots (`useGameStore`), the challenge-score selector and Hall-of-Records
  store: all either round-trip through `migrate` or never touch the six
  families' shape — identical behaviour.
- the `v1 -> v2` migration reads flat `raw.firms` — correct, it runs before the
  `v2 -> v3` wrap, while the save is still flat.
- **test literals / downgrade-simulation tests:** 15 test files build a
  simulated old save by serializing a live state and stripping a sub-field
  (`delete raw.firms[id].managers`, `delete raw.marketStats.clothes`, ...), then
  reloading to assert `normalize` backfills. The stripped field now lives under
  `raw.towns.home.X`; each was updated to that path (a faithful relocation to
  the new byte layout, not a weakening). Chosen strategy: **keep production code
  clean** — `townOf` reads `towns` directly and every construction path installs
  the aliases, so there is NO mid-gradient flat-fallback branch in production;
  the tests that manipulate raw JSON simply address the new location. No unit
  test builds a bare `{citizens: {...}}` GameState literal, so no test helper
  needed a compatibility shim.

**The invariant flip.** `townSeam.test.ts`'s old invariant — "no `towns` key in
a save, byte-unchanged, zero migration" — is SUPERSEDED. The rewritten test
asserts the NEW invariants: a save HAS the `towns` key and does NOT carry the
six flat keys; `SAVE_VERSION` is 3; the accessor identity chain
`townOf(state).firms === state.firms === state.towns.home.firms` holds; and an
OLD-shape save (built in-test by unwrapping `towns.home` to the top level and
stamping `saveVersion` 2) migrates into `towns.home`, reinstalls the aliases,
and round-trips. `firmArchetypes.test.ts`'s `SAVE_VERSION`/loaded-version
assertions moved 2 → 3 (the `v1 -> v2`-step unit assertion stays at 2).

**Measured.**

- **Save size:** the move adds a constant **+19 bytes** (the
  `"towns":{"home":…}}` wrapper) regardless of save size — VILLAGE day-40
  1,161,987 → 1,162,006 and CITY day-40 1,191,918 → 1,191,937 (both +19,
  ~0.0016%). Immaterial; no save-size probe exists to re-pin.
- **Pinned baselines hold bit-identically:** village seeds 11/4/7 reproduce
  `rngState` 3274842624 / 2896139677 / 4253583594 (each conserved to the cent
  across 300 days); city seed 11 reproduces `rngState` 2546912297 and money
  supply 316900000. The serialized BYTE LAYOUT changed (the designed part); the
  rng stream, economy, and money did not.
- **Full suite green (584** = the prior 583 + 1 new migration-round-trip test in
  `townSeam`); `tsc` clean; `npm run build` clean; the five e2e (smoke,
  deepsmoke, citysmoke, metrosmoke, fpsguard) all green — deepsmoke exercises
  the real in-game save + load round trip AND named save slots (save-as, load,
  delete), covering `serialize`/`deserialize`/`saveGame`/`saveMeta` end-to-end.

## What step 4 will take — a second simulated town (the design)

Step 3 landed the endgame shape: the six record families LIVE at
`state.towns[HOME_TOWN_ID]`, every reader routes through `townOf(state, townId)`,
`SAVE_VERSION` is 3, and golden v9 freezes the towns-shape corpus. The seam is
in the tree but the region is still **one town** — `makeContext` sets
`ctx.townId = HOME_TOWN_ID` and nothing ever varies it. Step 4 is the migration
path's rung 4: **a partner trade city (`port_rosa`) graduates from a price pool
to a real (small) simulated town, and the freight edge carries goods between two
LIVE economies.** This section is the plan — instantiation, dispatch, the seam's
money debt, the trade mapping, gating, the de-risking probe, and the slices —
each choice weighed against the same referee steps 1–3 answered to: bit-identity
of every pinned run, conservation to the cent, zero shared-rng drift flag-off.

### The finding up front (measured, before a line of implementation)

A runnable probe — `docs/design/probes/second-town-isolation.ts`, no sim-code
changes, reads/simulates only — attaches an INERT second town's records at
`state.towns['port_rosa']` (a real second City economy lifted from a second
`createInitialState`) and measures the three properties step 4 hinges on. Run
with `npx tsx docs/design/probes/second-town-isolation.ts`:

- **Isolation already holds.** With a partner town attached, a 30-day City home
  run (seed 11) reproduces its rngState (`1334085939`) and its serialized
  `towns.home` **byte-for-byte** against a control run with no partner; the
  partner's serialized records are **untouched** across the home-only tick loop.
  Home systems route through `townId = 'home'` (or the flat aliases, which also
  point at `towns.home`), so a second town key is invisible to them — **no read
  leak into rng or state, no write leak into the partner.** This is the property
  that lets step 4's partner be attached behind a flag with the pinned world
  provably undisturbed; the seam step 3 built already delivers it.
- **The money debt is real and exactly quantified.** `totalMoneySupply` and the
  account-resolution trio read the FLAT `state.firms`/`.citizens`/`.cohorts`
  aliases (= `towns.home` only). With the partner attached, the flat primitive
  reports **320,900,000 cents** while a region-aware sum reports **543,264,897** —
  it silently omits **222,364,897 cents**, equal to the penny to the partner
  town's holder cash. The instant `towns.length > 1`, conservation breaks unless
  the primitive goes region-wide (design in § "The seam's debts" below).
- **The id-collision hazard (a correction to this doc's own earlier claim).**
  region.md's step-3 exploration said "entity ids are region-unique already
  (`nextId` off shared counters)." That is true only WITHIN one
  `createInitialState` pass. A partner minted from a SEPARATE `createInitialState`
  gets its OWN `idCounters` from zero, so its `firm_3` collides with home's
  `firm_3` (both `Global Importers`, in the probe) — and the flat account
  primitive would then resolve a partner id to the WRONG (home) holder: a silent
  money-corruption path. Re-id'ing the partner region-uniquely makes the flat
  primitive correctly fail to resolve it (the account-resolution debt). **The
  concrete constraint on step 4's town factory: it must mint the partner off the
  region's SHARED `idCounters`, never a fresh counter set.**

Everything below is designed around those three measured facts.

### 1. INSTANTIATION — what creates `towns['port_rosa']`

The tempting shortcut is the one step 3 already condemned for the `Town` struct:
call the world-builder twice. The probe shows precisely why it is wrong.

| option | what it is | verdict |
| --- | --- | --- |
| **(a) `createInitialState` ×2, staple `towns.home`** | build a whole second City game, lift its `towns.home` into `towns.port_rosa` | **Rejected.** Fresh `idCounters` ⇒ id collisions (probe finding); a second `worldCash`/`config`/ledger it drags along are world-scoped and must NOT double; it wires a full 150-cast city where a partner needs a fraction of that. It is the "stubs, not reusable towns" trap one level up. |
| **(b) carve a `seedTown(region, townId, spec)` factory from `startingScenario`** | one function that mints ONLY the six town-scoped families into `region.towns[townId]`, off the region's SHARED `idCounters` and rng, driven by a small `PartnerTownSpec` | **Chosen.** It threads the shared counters (kills the collision), touches no world-scoped field, and takes a size `spec` so a light partner is genuinely small. It is the `Town`-struct extraction step 3 named ("everything town-scoped becomes a `Town`; everything world-scoped stays on `GameState`") finally cashed in for a second town. |
| **(c) hand-build a minimal partner literal** | write the partner records inline | Rejected as the shipping shape (unmaintainable, drifts from the catalog), but it IS the shape of the first slice's smoke fixture. |

**Town-scoped vs world-scoped, decided by the split step 3 already drew.** The
factory writes the six `TownRecords` families and the town's map dims; it must
NOT touch anything on `GameState` that the whole region shares. Measured
inventory of the world-scoped state that stays singular:

- **One clock, one rng, one money supply.** `rngState`, `tick`, `config` (the
  region's, though map dims become per-town — see below), and critically
  `worldCash` — the probe confirms `worldCash` is already a single region-wide
  account, so a freight settlement is one `recordTransaction` and conservation
  generalizes for free (region.md's founding promise).
- **World-scoped ledgers and graphs:** `transactions`, `events`, `worldEvents`,
  `achievements`, `missions`, `contracts`, `serviceContracts`, `vehicles`,
  `tradeCities` (the freight graph itself), `rushOrder`, `tradeAnnouncement`,
  `sharePriceShift`, and every `*Days`/`last*EntryDay` founder-signal counter.
  These are NOT duplicated per town.
- **Town-scoped, minted by the factory:** the six families
  (`districts`, `cohorts`, `citizens`, `marketStats`, `firms`, `facilities`) and
  the town's `mapWidth`/`mapHeight` (today a `config` delegate on the `Town`
  view; step 4 is where they become genuine per-town fields, since two towns need
  two maps — the `Town` interface already carries the getters precisely so this
  move touches no reader).

**A MINIMAL viable partner town.** The partner is a *place with an economy*, not
a second full city. The spec that makes it cheap:

- **Crowd-only, no cast (first cut).** `port_rosa` needs `cohorts` (a handful of
  district×tier cohorts holding cash) and `districts` to key them, its own
  `marketStats` book, and a few `firms`+`facilities` that PRODUCE what the freight
  edge trades. It does NOT need a simulated `citizens` cast — the cast is the
  most expensive family (70 reader sites, the labor/movement/schedule machinery)
  and the partner's consumption can run entirely on cohorts (the crowd path A3
  built), which is exactly what today's pool already approximates. An empty
  `citizens` record is legal (the readers iterate `{}`), so the light partner
  skips the whole cast subsystem.
- **A handful of firms.** Enough producers that the port has real goods to ship
  and real shortfalls to import — the `productionByProduct` profiles the step-2
  pool already encodes (Port Rosa food-rich, Ironvale industrial) become the
  partner's actual firm mix, so its specialization is now emergent, not a table.
- **Which systems must run for it** (the light subset — see § Dispatch):
  the crowd economy (`CohortDemandSystem`, `CohortLaborSystem`,
  `CohortSocialSystem`, `CrowdRentSystem`), `MarketStatsSystem`,
  `ProductionSystem`+`LogisticsSystem` for its firms, `DistrictSystem`,
  `SatisfactionSystem`/`TierSystem` for the cohorts, and `AccountingSystem`/
  `PayrollSystem`. It SKIPS the cast-only systems (`CitizenScheduleSystem`,
  `MovementSystem`, `LaborSystem`, `ImmigrationSystem`, `CastCuratorSystem`),
  the player-facing UI/alert systems, and the founder/rush/fire-sale systems
  (the player doesn't operate there yet). That subset is the partner-town size
  budget's lever.

### 2. DISPATCH — how systems run per town

Today `tick()` builds one context and runs `SYSTEMS` once. Three ways to run
systems for N towns, weighed on determinism (iteration order over towns), perf,
and the fact every converted reader already honors `ctx.townId`:

| option | shape | determinism | perf | verdict |
| --- | --- | --- | --- | --- |
| **(a) outer town loop in `tick`** | `for (const townId of sortedTownIds) { const ctx = makeContext(state, townId); for (const sys of SYSTEMS) sys(ctx); }` | Sorted town id order is the ONE new iteration axis — trivially deterministic, and home-first (`'home' < 'port_rosa'`) keeps home's rng draws in exactly today's position when the partner draws none. | Re-runs the whole 40-system list per town; wasteful when the partner runs a 12-system subset. | Simplest, but runs cast systems on a cast-less town. |
| **(b) each system internally loops towns** | every `run*System` does `for (const townId of sortedTownIds)` | Same order guarantee, but now enforced in ~40 places — 40 chances to forget the sort, and the day-boundary/rng-draw ordering interleaves across towns per-system, which is a HARDER bit-identity story to hold. | No wasted passes, but the refactor touches every system. | Rejected: diffuses the determinism contract across 40 files. |
| **(c) `TownScheduler` with per-town system lists** | a table `{ home: SYSTEMS, port_rosa: PARTNER_SYSTEMS }`; the scheduler runs each town's list in sorted town order | Sorted town order + an explicit per-town list — the light partner runs its 12-system subset, home runs the full 40, and the ORDER is data, auditable in one place. | Runs exactly the systems each town needs — the size budget is the list. | **Chosen.** It is (a)'s clean outer-loop determinism plus the ability to make the partner genuinely light, with the schedule as one reviewable table. |

One determinism fact the scheduler makes explicit rather than implicit: BOTH
towns draw from the single shared region rng stream (`state.rngState` is
world-scoped, per the inventory above) — the scheduler's sorted town order IS
the draw order, which is why it must live in one auditable place and why a
flag-off game (no partner in the schedule) is byte-identical by construction.

**Why (c) over (a).** The partner-town budget (§5) is enforced by its system
list: a cast-less port simply has no cast systems in its schedule, so "minimal
partner" is a data decision, not a pile of `if (townId === 'home')` guards
smuggled into 40 systems. The rng-draw discipline the house rules demand
("flag-gated code draws nothing from the shared rng when off") extends cleanly:
with the region flag off there is one town and one schedule (`home`), so the loop
runs exactly once with exactly today's draws — bit-identity is structural, and
the probe's isolation result is the standing proof.

**The context change is one field, already present.** `makeContext(state)`
gains a `townId` argument (defaulting to `HOME_TOWN_ID`, so every existing caller
is unchanged); the scheduler passes each town's id. `SimContext.townId` already
exists and every converted reader already routes through it — dispatch is the
first caller that ever passes a value other than `'home'`.

### 3. THE SEAM'S DEBTS — what going multi-town forces open

Step 3 deliberately left three things pointing at home, each marked in-code as a
debt to pay "at multi-town." Step 4 is when `towns.length > 1`, so it pays them.

**(a) The region-wide money primitive (the load-bearing one).** The
account-resolution trio (`getAccountCash`/`accountExists`/`addAccountCash` under
`recordTransaction`) and `totalMoneySupply` in `GameState.ts` read the flat
aliases (= `towns.home`). The probe measures the exact failure: a partner town's
222,364,897 cents are invisible to `totalMoneySupply`, and (once ids are
region-unique) a partner account does not resolve, so a freight settlement paying
a `port_rosa` firm would throw on an unresolved account in dev. **The change:**
resolution and the conservation sum iterate EVERY town's firms/cohorts/citizens,
not `towns.home`. Because ids are region-unique (the factory shares
`idCounters`), a firm-id lookup becomes "find the town whose `firms` holds this
id" — either a linear scan over the (small) town set, or, to keep resolution
O(1), a lazily-maintained `state.firmTownIndex: Record<FirmId, TownId>` rebuilt
on entity create/delete (the `ContractIndex` precedent already in `SimContext`).
The design keeps the shape minimal: money still moves via the single
`recordTransaction` primitive, so conservation stays a one-line invariant — it
just sums the region. The probe's `regionMoneySupply` is the reference
implementation; a step-4 test pins it against a home-only baseline (must equal
today's `totalMoneySupply` when only `home` exists) and across an inter-town
freight settlement (Δ = 0).

**(b) The bare-`state` helpers on the home default.** Measured: **246
home-default `townOf(state)` / `townOf(s)` / `townOf(this.state)` call sites
across 64 files** (vs 110 already threaded through `ctx.townId`). Not all 246
gain a `townId` param — they split three ways, and the split is the actual work
list:

- **Player-command handlers** (`Simulation.ts` `dispatch` + private handlers —
  build/price/hire/export/loan/acquire, ~40 sites) operate on the town the
  player is ACTING in. Step 4's player still operates only in `home`, so these
  keep the home default until the multi-town-player UI (out of scope); they are
  correct today and become "the selected town's id" at step 5.
- **Selectors** (`selectors/*.ts`, the marketStats/citizens/cohorts reader rows
  in the step-3 tables) render the town the UI is VIEWING. They gain a
  `townId`/`selectedTownId` param when the town switcher lands (step 5's hooks,
  below) — until then, home default renders the home town, unchanged.
- **Genuinely region-wide** — the money primitive above, which stays flat-by-
  design but flat now MEANS "aggregate all towns" (the back-compat getter reads
  every town). That is a handful of sites in `GameState.ts`, already commented as
  such.

So the honest count for step 4 itself: the money primitive (a) is the only group
that MUST change to go multi-town; the command handlers and selectors keep the
home default correctly until the player and UI can address a second town.

**(c) UI town-selector state hooks (deferred to step 5, but the state seam now).**
The switcher is step 5, but step 4 must not paint it into a corner. The minimal
hook: a `selectedTownId` on the view store (defaulting to `HOME_TOWN_ID`), and
the selectors above reading it instead of hard-defaulting. Step 4 adds the FIELD
and the default; the picker that changes it is step 5. This mirrors how step 3
added `SimContext.townId` (defaulted to home) long before dispatch ever varied it.

### 4. TRADE — mapping the pool economies onto the new town records

The step-1/2 pools already ARE a proto-town: a per-city population, a per-product
inventory, a consumption drain, and a `productionByProduct` supply side. The
question is whether the pool BECOMES the town or the town lives BEHIND the pool.

| option | shape | verdict |
| --- | --- | --- |
| **pool BECOMES the town's marketStats/cohort demand** | delete `TradeCityPool`; the partner's `cohorts` consume and its `firms` produce, and the freight quote reads the partner's real `marketStats` book | The honest endgame — the port's price is now its own supply/demand, not a walk × cover-mult. But a big-bang swap breaks every pinned pool measurement at once. |
| **pools remain the freight-facing INTERFACE, the town sits behind them** | the partner town simulates; a thin adapter derives the `pool.inventory`/cover the existing `cityPrice`/`feedPool`/desk/advisor already read from the town's real book | **Chosen for the FIRST slice.** The freight edge, the Gazette trade desk, and the advisor keep reading the pool interface unchanged; only the pool's NUMBERS now come from a live economy instead of a table. It is the gradient's discipline: swap the source, keep the interface, retire the interface last. |

**The mapping.** `poolConsumptionPerDay` → the partner cohorts' actual demand;
`poolLocalProductionPerDay` → the partner firms' actual output;
`pool.inventory[pid]` → the partner's real stock of `pid` (warehoused units).
`cityPrice` still layers cover on the walk, but "cover" is now days of the
partner's real inventory. `feedPool(+qty)` on an export becomes "the goods land
in the partner's warehouse" — a real stock delta the partner's consumption works
off, which is what the pool already SIMULATED; now it is literal.

**Freight edges with lead times vs today's instant settle.** Today
`performExport`/`performCityPurchase` settle in one tick — goods leave, cash
arrives, `feedPool` moves the larder, all instantly. With two live economies the
edge should carry a **lead time**: goods dispatched from home arrive at
`port_rosa` `leadDays` later, and only then hit its larder and pay out. The
precedent is already in the tree — `ForwardSystem` settles on a `deliveryDay`
`daysOut` in the future, with the paper/settlement split the step-1 doc unified.
The design: a freight edge is `{ from, to, freightFee, leadDays }` on the trade
graph, and an in-flight shipment is a dated record settled by a
`FreightSystem` on its arrival day — the `ForwardSystem` shape reused for
physical goods. **Out of scope for step 4's FIRST slice** (instant settle is kept
so the trade mapping lands in isolation); the edge/lead-time record is slice 4.

### 5. SCALE & GATING — pinned games stay byte-identical

**The flag.** A new `regionEnabled` config flag (default OFF at every preset,
the `tradeDemandPoolsEnabled` precedent). OFF ⇒ the scheduler has one town
(`home`), `makeContext` passes `'home'`, no second town key is minted, the money
primitive sums one town — the game is byte-identical to step 3, which the probe's
isolation + flag-off-anchor results already prove (village 11 reproduces
`3274842624`). `worldScaleConfig`'s City stack opts in (as it did for pools);
Village NEVER runs it (double-gated on `sizePreset !== 'village'`, since a Village
is definitionally one town). The pinned City seed-11 baseline
(`rngState 2546912297`, money `316900000`) is re-pinned HONESTLY if the live
partner perturbs it — a live second economy trading with home WILL move City's
trajectory (that is the feature), so its band is re-measured, never widened to
hide a break; a Village game is untouched by construction.

**Partner-town size budget (perf grid target).** The `PartnerTownSpec` sizes the
partner far below a full city: target a crowd of ~2–4 cohorts (hundreds of
cohort-population, not a 150-cast), ~4–8 firms, no simulated cast. The perf lever
is the schedule (§2): a cast-less partner skips the per-tick movement/schedule/
labor systems entirely, so the second town costs roughly its cohort-demand +
production + accounting passes — a small fraction of home's per-tick cost. The
grid target: `home (City) + port_rosa (light)` stays under the existing per-tick
budget the `perfGuard` test pins (median per-tick, contention-robust), measured
by extending that guard to a two-town City.

**Save-size projection.** Step 3 measured the `towns` wrapper at +19 bytes flat.
A second town adds one more `towns` entry: its six families serialized. A light
partner (no cast — the cast is the bulk of a save) is dominated by its
`marketStats` book (~one entry per traded product) and its firms/facilities
(single digits) and a few cohorts — on the order of tens of KB against the City
baseline's ~1.19 MB, i.e. low single-digit percent. Projected, not pinned; a
step-4 save-size check re-measures against the day-40 City figure
(`1,191,937` bytes) once the factory exists.

### 6. DE-RISKING PROBE PLAN

The shadow-parity spike gated A3; `second-town-isolation.ts` is step 4's
equivalent, and it is SHIPPED and green (all checks pass,
`npx tsx docs/design/probes/second-town-isolation.ts`). What it measures BEFORE
any slice lands, and what a follow-up probe must add once dispatch exists:

- **Shipped (this probe), pre-implementation:** (0) the flag-off anchor —
  Village seed 11 still reproduces `3274842624`; (1) ISOLATION — home rngState +
  serialized `towns.home` byte-identical with/without a partner attached, and the
  partner untouched by the home-only loop (defines leakage as any home
  read/write that crosses the town boundary, and detects it by control-vs-
  treatment diff); (2) the MONEY DEBT — flat `totalMoneySupply` omits the
  partner's cash to the penny, a region sum recovers it; (3) the ID-COLLISION
  hazard — independent counters collide, region-unique ids don't, so the factory
  must share `idCounters`.
- **Follow-up probe (after the dispatch slice, before the live-partner slice):**
  once `TownScheduler` can TICK the partner, a `two-town-conservation` probe must
  assert (a) conservation across an inter-town freight settlement with the
  region-wide money primitive (Δ = 0 — the debt fixed); (b) home-town bit-
  identity STILL holds with the partner now live-but-flagged-off (the flag, not
  just an unticked record, is the gate); (c) home-town ISOLATION with the flag ON
  — a shock in the partner (drain its larder) must change ONLY the freight quote
  home reads, never home's cohorts/firms/rng except through the goods/price edge
  (leakage on = any home state delta not attributable to a freight transaction).
  That "isolation when on" is the harder property and needs the live partner to
  test, so it is deliberately the follow-up probe, not this one.

### 7. SLICING — each slice shippable and gated

Mirroring the step-3 gradient's discipline (bit-identity the referee, one
concern per slice, an honest measured NO-SHIP is a complete result):

1. **The town factory + the flag (no dispatch yet).** `seedTown(region, townId,
   spec)` carved from `startingScenario`, minting only the six families off the
   SHARED `idCounters`; `regionEnabled` flag (default off); per-town `mapWidth`/
   `mapHeight` fields. Acceptance: flag off ⇒ pinned village 11 / city 11
   byte-identical (no second town, no per-town map delta); flag on ⇒ a partner
   town materializes in state but is INERT (unticked) and the isolation probe's
   properties hold; `tsc` + full suite green. *SHIPPED — see "What ships now —
   the town factory + the flag (step 4, slice 1)" below.*
2. **The region-wide money primitive. — SHIPPED.** Account resolution
   (`getAccountCash`/`accountExists`/`addAccountCash` under `recordTransaction`) +
   `totalMoneySupply` iterate `state.towns` in sorted town order (then each town's
   records, preserving the per-town `for..in`), via the `sortedTownIds(state)`
   helper in `core/Town.ts`. Landed as a proven IDENTITY refactor (towns holds
   only `home`): pins byte-identical — village 11/4/7 rngState
   3274842624/2896139677/4253583594, plain city 11 rngState 2546912297 money
   316900000. The optional `firmTownIndex` was NOT needed — measured, not assumed:
   the one-town outer loop is noise (full-flag City seed 11, warmed 250d then 50d
   timed, 5 samples: baseline min 0.9174 / median 0.9809 ms/tick vs after min
   0.9341 / median 0.9763 ms/tick — statistically indistinguishable). The shipped
   probe's `regionMoneySupply` is the test oracle (`tests/regionMoney.test.ts`):
   `totalMoneySupply` equals it on a live City state, and resolves/sums across a
   hand-attached second town while conservation holds through an inter-town
   settlement. Conservation re-proven across the golden corpus (goldenSave green,
   unmodified). `tsc` clean; full suite 589 green (587 + 2 new).
   Acceptance: `totalMoneySupply` equals today's value when only `home` exists
   (the one-town identity); the shipped probe's region sum becomes the test
   oracle; conservation invariant re-proven across the golden corpus.
3. **The `TownScheduler` + light partner systems.** The outer scheduler running
   each town's system list in sorted town order; the partner's 12-system cast-less
   subset. Acceptance: flag off ⇒ one town, one schedule, exactly today's rng
   draws, byte-identical pins; flag on ⇒ the partner simulates (its cohorts
   consume, its firms produce, its book updates) and the follow-up conservation
   probe is green; `perfGuard` extended to two-town City stays under budget.
4. **The freight edge with a lead time.** `FreightSystem` settling dated
   inter-town shipments (the `ForwardSystem` shape for physical goods); the pool
   interface's numbers now sourced from the live partner. Acceptance: an export
   dispatched from home arrives at `port_rosa` `leadDays` later, lands in its real
   larder, and pays out then — money conserved across the delayed settlement;
   City baseline re-pinned honestly with the measured cause documented.
5. **Retire the pool table (optional, gradient's end).** Once the freight quote
   reads the partner's real `marketStats`/cohort demand directly, the
   `TradeCityPool` interface is deleted. Acceptance: the desk/advisor read the
   town's real book; NO-SHIP-honest if the live economy can't reproduce a sane
   quote — that stops this slice, not the arc.

### What ships now — the town factory + the flag (step 4, slice 1)

Slice 1 lands the two seams the rest of step 4 builds on, with the pinned world
provably untouched:

- **`seedTown(region, townId, spec)`** (`src/sim/data/seedTown.ts`) — carved from
  `startingScenario`, it mints ONLY the six town-scoped families (a `TownRecords`)
  plus the town's map dims, and writes them at `region.towns[townId]`. It subsumes
  the isolation probe's hand-rolled `buildPartnerRecords` (the probe now calls the
  real factory). A `PartnerTownSpec` sizes a LIGHT partner: crowd-only (empty cast),
  a handful of producer firms drawn from the trade city's `productionByProduct`
  specialty order, its own district partition + market book. The shipped spec is
  `PORT_ROSA_SPEC` (city preset, 300-strong crowd, 6 producer firms).
  - **Shared counters, town-namespaced ids.** The factory mints off the region's
    SHARED `idCounters` (honoring the probe's `firm_3`-collision finding) under
    town-namespaced keys (`port_rosa:firm_1`, ...). This makes the partner's ids
    region-unique (they collide with nothing in home) AND leaves home's own
    `firm`/`fac` counters unadvanced — so home's runtime id stream never shifts,
    which is what makes a flag-on home byte-identical to flag-off.
  - **Local rng, no shared draw.** Any layout randomness comes from a LOCAL `Rng`
    seeded from `region.seed` + a hash of the town id, so a flag-off game's rng
    stream is untouched and two flag-on runs of a seed agree bit-for-bit.
  - **World-scoped state untouched.** The factory writes no `rngState`, `worldCash`,
    ledger, or trade-graph field; the partner's holder cash is direct-assigned
    initial supply (the `seedCrowd` idiom), not drawn from `worldCash`.
- **`regionEnabled` flag** (default OFF at every preset; no preset turns it on
  yet). When on at construction, `createInitialState` seeds one inert `port_rosa`
  partner alongside home. Double-gated on `sizePreset !== 'village'` (a Village is
  definitionally one town).
- **Per-town map dims.** `TownRecords` gains `mapWidth`/`mapHeight`; `townOf`'s
  map getters read the town's OWN fields now. Home's are set = `config.mapWidth`/
  `.mapHeight` at construction (after the size-preset block) AND defaulted from
  config on load/migration, so the getter swap is a provable value-identity for
  home — every existing game reads exactly `config.mapWidth`. **SAVE_VERSION stays
  3** (normalize-only default, no new migration): the fields are derivable from
  config, so an old save (v1–v8 flat, or a v3 minted before this slice) gets them
  defaulted in `normalize`, and golden v9 still round-trips —
  `serialize(deserialize(serialize(state))) === serialize(state)` holds because
  the two dims are added deterministically on the loaded state (the round-trip the
  golden test actually pins is of the LOADED state, not fixture-byte identity; the
  immutable v9 fixture keeps its six-key `towns.home` and its raw-shape assertion
  reads the fixture directly, so it is unaffected).

**Measured (slice 1).**

- **Pinned baselines (flag off) hold byte-identical:** village seed 11 reproduces
  `rngState 3274842624` (300 days); city seed 11 reproduces `rngState 2546912297`
  and money supply `316900000` (300 days). The only serialized deltas anywhere are
  the new `regionEnabled: false` config line and the two `mapWidth`/`mapHeight`
  fields on `towns.home` (value-identical to `config`).
- **Flag-on isolation (City, seed 11, 30 days):** home's `rngState` (`1334085939`),
  its serialized `towns.home`, and its flat money supply (`320900000`) are
  IDENTICAL to a flag-off run; the partner's records are byte-unchanged across the
  home-only tick loop (INERT). Two flag-on runs agree bit-for-bit.
- **The money debt, quantified (slice-2 oracle):** the flat `totalMoneySupply`
  omits the partner's holder cash to the cent — `region (340,400,000) − flat
  (320,900,000) = 19,500,000`, exactly `port_rosa`'s cohort + firm cash. The
  region-aware sum recovers it (the reference implementation slice 2 pins).
- **Id-uniqueness:** the factory's partner firm ids (`port_rosa:firm_*`) resolve in
  the partner town and correctly do NOT resolve through the flat account primitive
  — the constraint that forces resolution region-wide in slice 2.
- **Verification:** `tsc` clean; full `npx vitest run` green (**598** = 587 + 11
  new `regionSeed.test.ts` assertions across the flag/factory/isolation/money-debt
  properties); the updated probe `second-town-isolation.ts` passes all checks
  (exit 0).

### What stays OUT of step 4 (and why)

- **Citizen migration between towns.** The freight graph moves GOODS first (the
  export game we have). People moving towns (regional labor markets) need a
  cross-town emigration/immigration path and a shared labor market — its own arc,
  and it needs two live casts, whereas the light partner is deliberately cast-
  less. Out.
- **Multi-town PLAYER firms / the town-switcher UI.** The player still operates
  only in `home` in step 4; the command handlers keep the home default (§3b).
  Owning firms across towns and the UI to switch/act between them is step 5 —
  step 4 adds only the `selectedTownId` state field so step 5 has a seam, not the
  picker.
- **A full-cast partner town.** The partner is crowd-only by budget: the cast is
  the most expensive family (70 reader sites, the whole movement/schedule/labor
  machinery) and the port's economics run on cohorts. A simulated partner cast is
  a later refinement, not the first "second town."
- **More than two towns / a general region map.** Step 4 proves the SECOND town;
  the scheduler and money primitive are written N-town-general, but the shipped
  config wires exactly `home` + one partner. A dial-up to a full region graph is
  gated behind step 4 landing clean.
- **Cross-town capital / ownership.** Firms owning stakes or facilities in
  another town needs the region-wide account primitive (this arc) AND a
  cross-town ownership model — the former ships here, the latter is deferred with
  people-migration.

### Verification (docs-only change — proven anyway)

This step changed no sim code (a new doc section and one read-only probe). Proven
regardless: `tsc --noEmit` clean; full `npx vitest run` green (**587** tests,
116 files); the shipped probe `second-town-isolation.ts` passes all checks
(exit 0) — flag-off anchor `3274842624`, isolation byte-identity, the
222,364,897-cent money debt quantified, and the id-collision hazard demonstrated.
