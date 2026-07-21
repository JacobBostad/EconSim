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
3. **The `Town` struct.** The single-town `GameState` becomes
   `state.towns = { home: Town }` — a **one-town region** that must reproduce
   today's pinned runs to the byte (the migration is "wrap the existing records
   in a `home` town, thread the context, change nothing else"). This is the big
   mechanical step, landed as a pure refactor and measured as one.
4. **A second simulated town.** With the struct in place, a partner trade city
   graduates from pool to a real (small) simulated town. The freight edge
   carries goods between two live economies.
5. **The region UI.** A town switcher; the Gazette and trade desk report
   per-town and cross-town. (This arc adds the smallest seed of that: the trade
   desk now reports a partner city's *cover*.)

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
   prevent). Known modeling divergence: forward contracts keep their sign/close
   hedge impacts on the walk and their SETTLEMENT does not feed the larder — a
   forward delivery of a consumer good creates no cover overhang a spot export
   would. Anti-arbitrage holds (forwards carry their own impact); unifying
   settlement with `feedPool` is a follow-up if forwards on pool cities matter.
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
each row now also shows the better port's **cover in days** when a pool is live
(`🔥` thin / `🧊` glutted), so the supply/demand read is visible, not just
implied by the price. No new panel; the classic pure-walk desk (flag off) is
unchanged.

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
- **Conservation:** money invariant across a pooled export (Δ = 0).
- **Determinism:** two seed-7 pooled runs agree bit-for-bit (inventory, rngState,
  full serialized state).
- **Pinned baselines (flag off):** village seeds 1/11/777 reproduce their exact
  300-day `rngState`; city seed 11 reproduces its `rngState` and money supply;
  the full suite is green. The only serialized delta anywhere is the new
  `tradeDemandPoolsEnabled: false` config line.
