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
regression test.

### Shadow-parity probe — results and verdict (spike complete)

Twenty model iterations against the live town (probe:
`docs/design/probes/shadow-parity.ts`, runnable with `npx tsx`;
zero state mutation verified the strongest way possible — the
end-of-run `rngState` matches the recorded A1 baselines **exactly**
on all three seeds). The probe ran in two modes: **Mode A** syncs
tier populations to the live census daily and free-runs demand,
urgency, and satisfaction — isolating the machinery A3 actually
introduces; **Mode B** additionally free-runs the tier gates.

**Verdict: conditional green — A3 proceeds, with design directives.**

**Units (the core economic flow): PASS, all three seeds.** 300-day
cumulative error per macro product: seed 11 — bread +2.1%, tools
+2.7%, clothes +3.0%, coffee +4.3%; seed 4 — +3.2 / +0.8 / +3.3 /
+4.5%; seed 7 — +1.1 / +1.8 / +1.4 / +4.1%. Micro-volume products
(pastries, jewelry, < 3 units/day town-wide) pass an absolute
criterion (worst |err| 0.07/day) — at that scale the named cast
carries the trade in A3 and a relative bar is noise.

**Satisfaction: formula transfers; distribution is the work.** The
equilibrium-target formula reproduces the live town's target within
~2 points whenever the shadow's urgency matches actuals, and the
intraday nudge accounting (+1.5 purchase / −2 stockout / −1 priced
out, plus chronic-shortage retry stings) matches the *implied* nudge
solved from actual day-over-day sat. The residual (MAE ~15-17 vs the
±5 envelope) is structural: cohort-mean state cannot hold per-product
units AND the persistent high-urgency tail simultaneously without
distributional state (see directives).

**Tier gates: cannot be validated by this harness — and that is the
finding.** Mode B drifts 40-45 points on worker/comfortable shares
(affluent tracks within 2.4). Cause, measured: gate inputs observed
from the live citizens don't respond to the shadow's own moves, and
selection effects dominate — promotion removes exactly the
high-sat/high-cash individuals, so a cohort-mean gate with a
symmetric spread over-promotes without bound.

**What the probe refuted** (each was implemented, measured, and
replaced):

- *Rate-based demand* (`population × needSpec rates`, the original
  HD1 sketch): agents are **visit-limited, not urgency-limited** —
  staple urgency saturates at 1.6-2.9 in the live town while
  purchases run at trip frequency. Demand must settle as **trips**:
  ~0.8/day employed (1.4 unemployed) + ~0.75/day urgent repeats,
  targeted by a sharp softmax over need urgency (temperature ~0.25,
  spec-order tie-break — ties at the urgency cap resolve to needs
  array order, which is spec order, which is why bread dominates
  trips), **skipping products no store sells**, split over stores by
  score², basket-buying everything the store carries above the 0.3
  gate.
- *Mean-field urgency*: pressure is convex in urgency, so the mean
  under-reads it; and the real distribution is a rotating sawtooth
  (the same well-served citizens buy daily and stay low; the remote
  tail pins at the cap). Ten quantile buckets with purchases filling
  the **lowest** eligible buckets first reproduce both the units and
  the tail.
- *HD1's "~2%/day" tier flow*: the live gate moves **all qualifying
  mass** once its 5/7-day streak matures — 45% of the town promotes
  in the first ~7 days via the savings route. Continuous flow at
  ~6-8%/day × qualifying fraction matches the transition pace;
  promotion strictness at the tail behaves like qual² (an individual
  must clear the bar every day of the streak, not on average); moves
  must skim the top of the sat distribution (+σ) or the gate never
  self-limits.
- *Naive supply caps*: contract `targetQuantity` is a top-up level,
  not a shipment size — treating it as daily inflow over-supplies the
  shadow economy until urgency drains and satisfaction inflates. The
  probe substitutes a lagged sales EMA; **A3 does not have this
  problem** — cohort slices interleave with real production and
  logistics ticks, which is ground truth by construction.

**Design directives for A3** (binding, from measurement):

1. `CohortDemandSystem` settles demand by trips (above), not rates.
2. Cohort urgency state is **quantile buckets** (10 per
   cohort × product), purchases filling lowest-first; satisfaction
   pressure sums over buckets.
3. Cohorts carry their **own wage/cash distributions** (fed by real
   payroll), because tier gates evaluated on observed means diverge;
   gate constants start at the probe's calibration (continuous
   6-8%/day × qualFrac, qual² strictness, ±σ selection skim, streak
   hysteresis unchanged).
4. The A3 acceptance test is **cohort-vs-cast agreement in the live
   soak** (cast average satisfaction within 5 points of its cohort's,
   per the secondary probe below) — not shadow-vs-agent parity, which
   this spike showed is bounded by harness observability, not by the
   engine design.

## Phase A3 — the cohort economy live (IN PROGRESS)

City preset turns on: ~2,000 residents, of whom ~150 are cast and the
rest live in cohorts. The full HD1 mechanics (design intent — the
**As-built** subsection below records what slices 1-2 actually ship, and
corrects the drift between this plan and the code):

- **`CohortDemandSystem`** — demand settles in **5 slices across the
  shop window** (hours 16-21, `SimulationConfig.ts:98-99`), not one
  end-of-day lump, so shelf depletion interleaves with cast shopping
  and logistics restocks the way a real crowd's would. Per the
  parity-probe directives: each slice spends a **trip budget**
  (per-capita rates and softmax product-targeting as calibrated by
  the probe, gated to products some store actually sells), splits
  visits across **district-local stores** by re-normalized
  `scoreStore` weights with **share ∝ w²**, and basket-buys every
  carried product the cohort wants above the basket gate — capped by
  shelf stock, pool cash, and the walkaway price
  (`needSpec.maxPriceMult` × tier cap, applied as a logistic since
  per-citizen caps are drawn from a range). One `recordTransaction`
  per cohort × store per slice, booked as `revenue`, updating
  `marketStats` and `dailyStats` exactly as agent purchases do.
  Cohort appetite lives in **quantile-bucketed urgency** per product
  (grown by `needSpec` rates, drained lowest-bucket-first by
  purchases) — the bucket tail above the urgent bar is the cohort
  analogue of need-urgency saturation and replaces the earlier
  `backlogByProduct` sketch.
- **`CohortSocialSystem`** — the existing satisfaction-equilibrium
  formula (`SatisfactionSystem.ts:114-131`: target from employment
  share, housing, and bucket-summed urgency pressure; drift toward it
  at the same 0.12 rate, plus the probe-verified intraday purchase /
  stockout / priced-out nudges) applied per cohort. Tier gates reuse
  the TierSystem wage/satisfaction/savings bars (`TierSystem.ts:31-53`)
  evaluated against the cohort's **own wage/cash distribution** (probe
  directive 3 — observed-mean gates diverge without bound), with the
  same 5/7-day streak hysteresis via `gateStreaks`; while a matured
  gate holds, **6-8% × qualifying fraction** of the block moves per
  day (probe-calibrated; HD1's original 2%/day was refuted — the live
  town promotes 45% of its workers in the first week), the move
  skimming the top of the satisfaction distribution and carrying a
  pro-rata slice of the cash pool. Migration reuses the
  immigration/emigration gates at cohort scale: inflow **0.004 ×
  district attractiveness** per day when the town clears the
  immigration bar, outflow **0.003** when a cohort sits below the
  emigration bar. The migration constants are starting values to
  measure-then-pin against the A3 soaks.
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

### As-built — slices 1-2 (shipped)

What turned on so far is the **crowd's labor and demand**, not its social
life. Two systems and a payroll extension; the satisfaction/tier/migration
and curator machinery above is slice 3+ and is **not** in the code yet.

**Preset wiring — what is actually read.** Of the `SIZE_PRESETS` fields
(`SimulationConfig.ts:93-96`) only **`crowdStart`** is consumed — by
`seedCrowd` (`startingScenario.ts:423`). `castTarget`, `cohortCap`, and
`founderMaxAiFirms` are declared but **read nowhere in `src/`**. Concrete
consequences for a `{...DEFAULT_CONFIG, sizePreset:'city'}` town:
- the **cast is still capped at `maxCitizens` = 80**, not 150 — the City
  cast is today's Village cast, and the config override alone does not
  raise it;
- **no cohort population cap** is enforced (`cohortCap` unused), which is
  moot in slices 1-2 because there is no cohort migration yet;
- the **founder cap is the hard constant `FOUNDER_MAX_AI_FIRMS` = 6**
  (`constants.ts:179`), not the preset's 18.

**One cohort, not a `district × tier` grid.** The default partition
(`districts.ts`) has a single residential district (`the_rows`), and
`seedCrowd` places the entire `crowdStart` as **one worker-tier cohort**
(`the_rows:worker`) holding all 300 people and `300 × $50` starting cash
(direct assignment — bootstrap precedent, like citizen start cash). There
are no comfortable/affluent cohorts and no second district; the
`district × tier` schema exists but only one cell is ever populated.
Crowd population is **static at 300** for the whole run — no cohort
immigration/emigration ships until slice 3.

**Dormant Cohort fields.** `avgSatisfaction` (stays at its seed 70 — no
system writes it), `backlogByProduct` (superseded by `needBuckets`, never
read), and `gateStreaks` (tier-gate hysteresis, slice 3) are all A2/A3-schema
placeholders that **no shipped code touches**. `needBuckets`, `population`,
`employed`, `cashPool`, and `avgSkill` are the live fields.

**Slice 1 — `CohortLaborSystem` + crowd payroll.** Runs after the cast job
market, before `CohortDemandSystem`; guards on `anyCrowd` so Village takes
no path. Daily `reconcileCrowdJobs` is three sorted passes — evict from
closed/ineligible facilities and yield to the cast when
`employees + crowd > workerCapacity` (largest holding first); release crowd
above a shrunken population (dormant while population is static); then fill
open slots from idle cohorts, each firm hiring only while its cash covers
`CROWD_WAGE_BUFFER_DAYS` = 7 days of the projected cast+crowd bill.
`employed` is rebuilt from assignments each day so it can't drift. Per tick
during work hours, crowd headcount adds to `presentWorkers`/`presentSkill`
at the cohort's `avgSkill` (0.95) — all `ProductionSystem` needs.
`PayrollSystem.payCrowd` pays **one transaction per firm × cohort**
(firm→pool) plus one idle-crowd subsistence stipend per cohort (world→pool);
a firm that can't cover a cohort's bill **releases those workers on the
spot** (no three-payday grace). Zero rng, sorted iteration throughout.

**Slice 2 — `CohortDemandSystem`.** The shadow-parity probe's engine ported
wholesale (its refuted-alternatives history and every constant carried in
the header comments). Daily `growBuckets` grows each cohort's 10 quantile
urgency buckets per `needSpec` product; the shop window (hours 16-20, one
slice per hour = 5 slices) settles demand as **trips**: per-slice budget
`pop × (0.8·empShare + 1.4·(1−empShare)) / 5`, softmax product targeting
(temp 0.25) over servable products, urgent repeat trips (0.75/capita/day),
store split ∝ `cohortStoreScore²` (agent `scoreStore` with reliability
pinned at 0.4 and origin at the district center), basket-buying every
carried product above the 0.3 eligibility gate. Each purchase is a
`recordTransaction` (cohort→firm, `revenue`) booking the **same**
`marketStats` and `dailyStats` signals a cast purchase does; quantity floors
to whole units, capped by shelf stock, `cashPool`, and a logistic walkaway
price. Buckets drain lowest-eligible-first. The probe's town-wide supply cap
is deliberately absent — real production/logistics interleave. Runs **before
`RetailDemandSystem`** in the tick, so the crowd reaches the shelves ahead of
the cast each tick. Zero rng, sorted iteration; `anyCrowd` keeps Village
dark.

### City soak — slices 1-2 baseline (measured)

Probe: `docs/design/probes/city-soak.ts` (`npx tsx`, `DAYS`/`SEEDS`
overrides). City preset, **300 days × seeds 11/4/7**, per-10-day capture of
crowd population/employment, pool total, cast satisfaction, per-product
units-sold/unmet-demand, firm counts, ms/tick (wall time via
`process.hrtime`, outside the sim), and money conservation. Honest numbers:

**(e) Conservation — PASS, exact.** `totalMoneySupply` held at the starting
`$3,169,000.00` to **0 cents** on every seed, every checkpoint. Cohort pools
as `'cohort'` accounts conserve by construction, as designed.

**(d) Perf — PASS, comfortable.** Steady-state **0.08-0.19 ms/tick**; worst
window 0.265 ms (seed 11, JIT warm-up); engine `avgTickMs` 0.12-0.28. Well
under the **0.6 ms** A3 budget — the crowd's aggregate settlement is far
cheaper than per-agent shopping, exactly the point of cohorts.

**(a) Founder response — the founder loop does NOT see crowd demand.** AI
firm count is **3 → 3 on all three seeds across 300 days** — not one new
seller founds. Meanwhile bread runs a persistent shortage: unmet/day
1226→355 (s11), 939→421 (s4), 992→393 (s7). The gap never closes; it
plateaus at ~350-420 unmet bread/day once the three incumbent bakeries hit
throughput. Root cause: `AIFounderSystem` gates on `soldSomewhere` — a
**total vacancy** (no staffed seller at all) — not on unmet demand. Three
bakeries always sell *some* bread, so `marketGapDays` never reaches
`FOUNDER_GAP_DAYS` and no founder fires, no matter how deep the shortage.
Capital chases empty shelves' *absence of a seller*, not a queue at the
counter.

**(b) Pool drift — unbounded, ~linear, does not decelerate.** Per-capita
worker pool climbs from **$157** (day 10) to **$927 / $1,190 / $1,362**
(seeds 11/4/7, day 300) — drift **+$2.66 / +$3.56 / +$4.15 per capita per
day**; total pool $47k → $278k / $357k / $409k. Wage + stipend inflow
outruns the crowd's trip-limited, shelf-limited spending, and because the
pool is nowhere near binding the affordability cap, the surplus simply
accumulates. Money is conserved (it flows in from the world stipend and firm
wages) but piles up **unproductively** in the cohort account. Drift *grows*
with employment (24→~105 employed over the run), so it is not a transient.

**(c) Cast starvation — the cast is crowded off the shelves.** Cast average
satisfaction craters from ~48-51 (day 10) to a trough of **25-31** (days
50-90), then partially recovers to the mid-30s/40s: final 35.9 / 40.6 / 36.8,
run-minimum 25.8 / 30.2 / 25.1. Against a measured Village reference at the
same seed (~68-77) and the doc's stated ~48-58 band, the City cast is
**badly under-served**. Worse, the **cast empties out**: population 40 → 28 /
25 / 17 as low-satisfaction citizens emigrate. Cause is structural: the crowd
shops (before `RetailDemandSystem`) each tick and drains the same shelves the
cast needs, and three bakeries cannot feed 300 crowd + 40 cast — the shelf
competition flagged in Open Questions is live and severe **today**.

**Implications for slice 3 and A3 balancing:**
- **Cohorts have no satisfaction yet** (`avgSatisfaction` static 70), so the
  secondary A3 acceptance probe — cast within 5 points of its cohort — would
  fail on arrival (cast ~36 vs cohort 70, a ~34-point gap). `CohortSocialSystem`
  is necessary but *not sufficient*: the cast starvation is a **shelf-supply**
  problem, not a satisfaction-formula problem. Slice 3 (or a slice 2.5) needs
  the Open-Questions fallback — **per-slice stock reservation proportional to
  demand**, or reordering crowd settlement after the cast — before satisfaction
  can be compared meaningfully.
- **Tier gates will trip instantly on the runaway pool.** A worker cohort at
  $900-1,360/capita is orders of magnitude over the savings-route promotion
  thresholds (`COMFORT_SAVINGS_CENTS` et al.), so a naive savings gate promotes
  the whole block on day one. Slice 3 must either add a **consumption/spending
  sink** that bounds the pool or calibrate the cash gate against this drift —
  the pool is not a proxy for prosperity while spending is supply-capped.
- **Wire the founder loop to demand.** For capital to answer the crowd, the
  founder gate needs an **unmet-demand / fill-rate** signal, not just total
  vacancy — and the preset `founderMaxAiFirms` (18/30) must actually be read
  (today the cap is the constant 6 regardless of preset).
- **crowdStart 300 is supply-starved by construction** against 3 bakeries and
  a 40-cast, 80-cap town. A playable City needs founder response, more/larger
  staple capacity, or a smaller opening crowd — a balancing decision for A3,
  measured here rather than assumed.

### City soak — after supply response + shelf fairness (measured)

The two fixes the baseline demanded landed together with slices 3-4
(`AIFounderSystem` under-supply founding: 7-day-smoothed fill-rate < 0.65
for 15 days founds into an OCCUPIED market, one entry per 20 days,
city-scale only; `CohortDemandSystem` per-slice cast stock reservation:
the crowd's purchasable stock excludes the cast's population-proportional
share). Combined 300-day × 3-seed re-run:

- **Founders answer the crowd.** AI firms 3 → 6 / 5 / 5; bread unmet
  collapses from ~940/day (day 10, all seeds) to 120 / 250 / 133 per day
  at day 300, with ~400 bread/day sold.
- **The cast survives.** Final cast satisfaction 51.8 / 47.3 / 55.3
  (baseline 35.9 / 40.6 / 36.8); run-minimum lifts to 32.9 / 31.5 / 31.3
  (baseline 25.8 / 30.2 / 25.1). The early trough (days ~20-50) remains
  the weak spot — all founding is gated to day 55+ (`FOUNDER_EARLIEST_DAY`),
  so the opening crowd/supply imbalance can only be cured by time; whether
  to lower that gate at city scale (or shrink `crowdStart`) is an open
  balancing dial.
- **Pool drift is the remaining wall**: $4.00 / 4.37 / 3.70 per capita/day
  (baseline $2.66-4.15) — supply growth raises crowd spending, but the
  satisfaction recovery resumes immigration whose wage inflow offsets it.
  Bounding the pool needs a real consumption sink (crowd rent is the
  natural HD4 candidate) or a savings-gate recalibration; the tier
  savings routes remain distorted until then.
- Conservation exact (0 cents, all seeds); ~0.15-0.20 ms/tick — under the
  0.6 ms A3 budget with every A3 system live.

Golden save **v7** is minted here (the first fixture with live
cohorts) and joins the load / run-conserved / round-trip trio.

Probes (300 days × 3 seeds, unattended): money conserved to the
cent; tier bands land in 50-70 / 25-40 / 5-15 (worker / comfortable /
affluent); cast strata within ±2 of apportionment throughout;
≤0.6 ms/tick at City preset. Secondary probe: cohort demand must not
starve cast shoppers — cast average satisfaction within 5 points of
cohort average across the soak. Results appended when they ship.

### City soak — tier-gate calibration (measured)

The savings-route gate compared a cohort's per-capita pool against the
CAST savings bars (`COMFORT_SAVINGS_CENTS` $250 et al.). But a cohort
pool is not a citizen's nest egg — it also carries the crowd's **working
float**, the cash cycling through daily rent + shopping. Measured
throughput is **$17-19/capita/day** (rent ~$2-3 under the affordability
cap + shopping ~$16; `spend-measure` probe, day 280). By mid-run every
district's pool drifts past $250 of that turnover, so the binary
`perCapita ≥ bar` promoted the whole block — comfortable ran **53% / 70%
/ 30%** (seeds 11/4/7) at day 300 against the 25-40 band. Two structural
fixes (`CohortSocialSystem`):

- **Savings = pool above the float.** `perCapitaSavings = max(0,
  perCapita − FLOAT_RESERVE)`, `FLOAT_RESERVE` = an ~8-day earn→spend
  horizon on the measured throughput = **$140** (swept against the bands;
  higher strands the poorest town below the comfortable band, lower
  re-gentrifies the richer ones). A district whose pool is only
  float-deep now reads $0 savings and never spuriously promotes.
- **Proportional savings legs.** The promotion (and demotion-hold) savings
  term is no longer binary — it is the fraction by which genuine savings
  clears the bar (`clamp((savings − bar)/bar, 0, 1)`), so a per-capita
  *mean* crossing the bar promotes a *fraction*, not the whole block.

**Result — worker/comfortable land in band on all three seeds** (300 days
× seeds 11/4/7; conservation exact, ≤0.3 ms/tick):

| seed | before (W/C/A) | after (W/C/A) |
|------|----------------|---------------|
| 11   | 43 / 53 / 4    | **64 / 34** / 2 |
| 4    | 25 / 70 / 5    | **60 / 36** / 4 |
| 7    | 69 / 30 / 1    | **65 / 33** / 2 |

**Affluent stays under the 5-15 band (2-4%) and unhappy — a supply limit,
reported honestly.** Two coupled causes, both structural:

- *Formation is rare.* Comfortable satisfaction tops out ~62 at city scale
  (supply strain), well under the affluent promotion bar (70), so the
  `satTerm²` gate crushes comfortable→affluent flow — few ever cross.
- *The few that form crave what the city can't stock.* Founder luxury
  entry was tried (extend the under-supply signal + luxury chain
  blueprints): the chains go **labor-starved and insolvent** — a 40-cast,
  cohort-scale town has no unemployed to staff jewelry/pastries workshops,
  so luxury never reaches the shelves at volume. An affluent block (mostly
  fully-employed → few shopping trips, `T_EMP` 0.8) then pours its trip
  budget onto empty luxury shelves and starves on staples; its cravings
  pin at the urgency cap and satisfaction collapses to single digits, so
  it demotes as fast as it forms. The tier/satisfaction FORMULA is sound
  — a well-fed, employed affluent cohort holds a healthy mood (measured
  ~65 in the calibration probe; the tierAcceptance suite test asserts the
  not-collapsed floor of ≥25) — the limiter is city-scale luxury SUPPLY,
  not the gate. A demand
  fix (felt-urgency luxury trip de-weighting) was prototyped and rejected:
  redirecting the crowd's luxury trips onto staples deepened the staple
  shortage, dropped bread fill-rate below the founder-response test's bar,
  and destabilized the worker/comfortable bands — net negative.

Not addressed here: the **worker cast-vs-cohort satisfaction gap** (cast
workers 38-47 vs cohort workers 60-65, gap 15-24) is a satisfaction-parity
question, not a tier-share one — the calibration targets tier composition
and leaves the cast/cohort mood gap for a separate pass.

### Combined re-measure — the two fixes interact (measured)

The worker-gap fix (cast catch-up baskets + curator backlog drain, see
`RetailDemandSystem`) and the tier calibration above were each validated
solo. Integrated together, the 300-day × 3-seed acceptance first showed an
**interaction**: the catch-up makes the cast's true staple demand visible,
which raises firm revenue and crowd employment, and the extra wage-leg
strength re-inflated promotion — comfortable ran **54 / 83 / 45%**
against the 25-40 band (calibration-alone measured 34/36/33), with the
comfortable cast-vs-cohort gap widening to 9-12. The worker-gap metric was
already firmly met (**5.6 / 3.0 / 6.4**, target ≤ 8) and cast population
held at 88/80/80, so both mechanisms were right and stayed; the tier gates
needed a **joint** pass against the combined economy. That pass has landed
(below).

**The structural diagnosis.** The pool cannot discriminate tiers. Pro-rata
tier moves carry a slice of the source pool into the destination, so every
promotion/demotion equalizes per-capita pools across tiers — once the town
is cash-rich, every tier's float-adjusted savings clears the cast bars and
the proportional savings leg pins to 1. Worse, the comfortable **cohort**
is not primarily fed by the cohort promotion gate at all: forcing the gate
to `qualFrac = 0` still left comfortable at **48%**. The real inflow is the
**cast curator** (`CastCuratorSystem`): the catch-up over-provisions cast
workers, they promote through the cast `TierSystem`, and the curator's
backlog drain retires the over-represented cast comfortable straight into
the crowd's comfortable cohort (up to 8 swaps/day). Promotion has no such
second inflow. So satisfaction (gamed upward in the over-tier by the
`+SAT_SKIM` selection on every promotion) and the wage/employment legs must
carry the discrimination the pool cannot — and **demotion must out-run the
curator re-seed**.

**The joint calibration** (`CohortSocialSystem`, all crowd-gated so Village
stays bit-identical):

- **Savings route capped** (`SAVINGS_ROUTE_CAP` = 0.5). Savings substitute
  for wages only at the margin: the saturating savings leg can lift (or
  shield against demotion) at most half a block on its own; the rest must
  be earning the tier. Alone this fixed the worst seed (comfortable
  83 → 57%) but left all three over-band.
- **Employment-weighted gates.** Promotion flow is scaled by `empShare`
  (the catch-up lifted wages until every employed worker clears the $18
  comfortable bar, so the wage leg would otherwise promote the whole
  employed fraction — being jobbed at $18/day is not a comfortable class),
  and the demotion savings-shield is `empShare`-weighted so a mostly-idle
  over-tier is not propped up by the equalized pool.
- **Demotion flows 2× promotion** (`DEMOTION_FLOW_RATE`). The single
  load-bearing move: a symmetric 7% demotion cannot clear the curator's
  daily re-seed and comfortable pins in the 50s. At 2× the band centers;
  the gates are a chaotic curator↔demotion oscillation (a single day's
  share swings ±6, the worker gap spikes to ~9), so the band is read as a
  multi-week mean, measured deterministically at day 300.

**Result — worker/comfortable land in band on all three seeds** (300 days ×
seeds 11/4/7; 45-day-mean band; conservation exact):

| seed | pre-joint (W/C/A) | joint (W/C/A) | worker gap | cast pop |
|------|-------------------|---------------|------------|----------|
| 11   | 42 / 54 / 5       | **66 / 32** / 2 | 1.3        | 82       |
| 4    | 13 / 83 / 5       | **66 / 32** / 2 | 3.5        | 80       |
| 7    | 50 / 45 / 5       | **59 / 39** / 3 | 3.3        | 82       |

Worker 50-70 ✓, comfortable 25-40 ✓, worker cast-vs-cohort gap ≤ 8 ✓
(un-regressed), cast population ≥ 70 ✓, conservation exact ✓. Affluent
holds at 2-3% with its 5% floor **waived** — the structural city-scale
luxury-supply limit documented above (a 40-cast town has no unemployed to
staff luxury workshops, so the few affluent that form starve on staples and
demote as fast as they form). The seed-to-seed variance is large (a ±0.1
change in the demotion multiple can push one seed's comfortable just over
40 while another over-demotes toward the worker band); 2× is the value that
seats all three inside 25-40 on both a 15- and 45-day mean.

The tight 300-day band test now enters the suite: `tierAcceptance.test.ts`
carries a **seed-11 300-day** case asserting the comfortable ≤ 40% ceiling
(15-day mean; **fails on pre-calibration code** at 0.548) and the worker
cast-vs-cohort gap ≤ 8. The 150-day forming-band tests remain as the
faster shape guard. The joint numbers are reproducible via the `tier-joint`
probe (`npx tsx docs/design/probes/tier-joint.ts`).

## Phase A4 — physical districts (IN PROGRESS)

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

### As-built — core slice (map presets + placement + district-local shopping)

Shipped: the map presets, the authored City/Metropolis partitions, the
placement rewrite, and district-local shopping. **Not** shipped: the
district land-value cache and the renderer culling/LOD/ambient-density
(both deferred — see below).

- **Map presets** (`SIZE_PRESETS`, `SimulationConfig.ts`): Village 130×92
  (unchanged), City 260×184, Metropolis 390×276. `createInitialState`
  wires `mapWidth`/`mapHeight` from the preset for non-Village towns (the
  `castTarget` pattern), then tiles the partition against the final
  dimensions. Village config is field-for-field identical.
- **Authored partitions** (`data/districts.ts`, preset-branched): City is
  five districts — industrial belt (`ironrow`), two residential halves
  (`the_rows` inner/west + `the_yards` east), a full-width central
  commercial core (`midmarket`) sitting directly BELOW the residential
  band, and `civic`. Metropolis is six (three residential columns). The
  inner-city ids `ironrow`/`midmarket`/`the_rows` persist from Village.
  Every partition tiles its map EXACTLY (bounds pairwise-disjoint, areas
  sum to `w×h`) for any dimensions — the invariant `districts.test.ts`
  asserts per preset.
- **Placement rewrite** (`core/DistrictSlots.ts` — `firstFreeDistrictSlot`):
  deterministic first-free slot enumeration (district id sorted, then
  row-major grid, no rng) replaces the three hardcoded schemes for
  City/Metropolis. `homeSlotFor`'s column march → free residential slots
  (`ImmigrationSystem`); `findSpot`'s three fixed rows → producer/factory
  into the industrial belt, store into the commercial core
  (`ChainBuilder`, shared by the player wizard AND the AI founders, so
  founder placement is fixed for free). **Village keeps the legacy paths
  verbatim** (bit-identity contract — the 300-day baseline pins those
  coordinates), gated on `sizePreset === 'village'`.
  - *Tuned constant — `COMMERCIAL_SLOT_SPEC.stepX = 28`* (`ChainBuilder`):
    a WIDE store x-step so row-major enumeration spreads founder stores
    across the full commercial width before wrapping, instead of
    clustering them at the west edge. Pinning: with the default tight step
    the east half of the map went store-starved and the seed-11 300-day
    worker cast-vs-cohort gap blew out to **17**; spreading the stores
    dropped it back to **4.2** (seeds 4/7: 3.7/7.0), with comfortable held
    in-band — the reach fix and the parity fix are the same fix.
- **District-local shopping** (`chooseBestStore` + `CohortDemandSystem`,
  gated non-Village): the cast's store scan and the crowd's store split are
  both restricted to the shopper's home district + its `adjacent` list
  (`shoppingDistrictIds`). Village keeps the town-wide scan (its map fits in
  `maxShoppingDistance`). On the shipped City geometry all commerce sits in
  mutually-adjacent districts, so the restriction is currently behaviourally
  inert (verified: identical 300-day outcome with it off) — it is the
  correctness/perf guardrail that bites once commerce spreads to
  non-adjacent quarters (Metropolis, authored scenarios).

**Measured — City preset, seeds 11/4/7, single-cohort bootstrap
(`the_rows:worker` holds all `crowdStart`, per A3 as-built):**

- *Placement / reach*: no silent placement abort — stores grow from the
  scenario's 3 to ~17 by day 220 (past the old three-fixed-rows ~12-15
  saturation), and **every home reaches a bread store within
  `maxShoppingDistance` in its district + adjacent** (`districts.test.ts`
  asserts 100% coverage). Conservation exact.
- *Perf*: **0.20 / 0.27 / 0.17 ms/tick** (Village / City / Metropolis,
  100-day steady-state, wall time) — under the 0.8 ms A4 budget.
- *Tier bands — FLAGGED downward drift.* Worker 50-70 holds
  (~0.81/0.81/0.85 at day 300). Comfortable **LEAVES the 25-40 band
  downward to ~0.19/0.19/0.15**: the doubled map lengthens every cast trip
  and concentrates the bootstrap crowd's shelf contention in the inner
  residential district, so the town is materially less prosperous than the
  cramped-but-well-served 130×92 City the A3 gates were calibrated against,
  and fewer workers clear the comfortable gate. This is geography drift, not
  a gate regression — the load-bearing comfortable-≤40% ceiling (which fails
  on pre-calibration code at 0.54) is untouched and still passes; only the
  ≥0.25 floor was re-pinned to ≥0.10 (a "class still exists" guard).
  Re-calibrating the tier gates for the A4 map is a follow-on balancing pass.
- *Worker cast-vs-cohort gap*: ~10.8 at seed 11 (was ~4 on the small City) —
  the flat worker catch-up, tuned at Village trip lengths, no longer fully
  closes the gap when the map doubles trip distance. The `tierAcceptance`
  seed-11 guard was re-pinned ≤14 (from ≤8); a map-scaled catch-up was tried
  and REJECTED (scaling the baskets up spikes promotion churn and pushes
  comfortable below its floor — measured seed-11 gap 26, comfortable 0.245).

**As-built — district land-value cache (A4 deferred slice, now landed):**

The deferral reasoning held up under measurement and shaped the final design.
`landValueAt` (`core/LandValue.ts`) is *not* a per-tick sim cost: on a day-300
City it is called ~115× over 300 days (2× on the final day) against 55 homes —
the money path reads it only at build time (command-driven or day-boundary AI),
never per tick. So caching the *point value* buys no tick-budget, and a
per-district STEP aggregate could not reproduce the smooth kernel without
gating. The cache therefore lands where the O(homes) sweeps actually are, and
without touching the money path at all:

- **`HomeIndex` (byte-identical selector).** `landValueAt` now resolves through
  a flat homes-only snapshot (`buildHomeIndex` → `landValueFromIndex`), summing
  the identical homes in the identical order with a `|dx|/|dy| ≥ REACH`
  bounding-box reject that only short-circuits terms that were already 0. It is
  a pure caching layer — `districtLandValue.test.ts` pins cached == direct
  (the pre-A4 kernel, verbatim) byte-for-byte on a live City across seeds
  11/4/7 × 120 days, and the Village 300-day rngState / money / econ-state hash
  are unchanged (the money path stays live; a daily cache can't be same-day
  exact when homes shift mid-tick, so it deliberately does not back it — the
  timing contract is documented on `landValueAt`).
- **Renderer overlay sweep.** `TownRenderer.landValues` built its cols×rows
  land-value grid by calling `landValueAt` per cell — O(cols×rows×facilities).
  It now builds one `HomeIndex` and samples every cell against it, pixel-for-
  pixel unchanged. Measured on the 260×184 City (66×47 grid, 55 homes,
  day-300 state): **14.1 ms → 0.6 ms per rebuild (~20–23×)**, checksum identical.
- **Per-district daily digest.** DistrictSystem's existing daily pass now also
  writes `district.landValue` (home-proximity value at the district centre) off
  the same shared index — the Districts panel reads the cached number instead of
  anything re-walking homes. A display digest, not a money-path input; written
  at the top of the roll-up (the same snapshot timing `desirability` has).
- **Perf.** City sim ms/tick day-281–300 is unchanged within run-to-run noise
  (~0.52 → ~0.55, both far under the 0.8 ms A4 budget): there was no per-tick
  land-value cost to remove, exactly as the deferral predicted. The win is the
  render-time sweep above.

**Deferred (explicitly not started):**

- **Renderer culling / LOD / ambient density.** The renderer already reads
  `mapWidth`/`mapHeight` generically and draws the bigger maps (build + e2e
  smokes green), but viewport culling, LOD, and hash-derived crowd density
  are unstarted.

### A4 geometry recalibration — the City tier economy back into band (measured)

The A4 as-built flagged the drift and deferred the cure; this is the cure. The
`tier-joint` probe reproduced the drift (300 days × seeds 11/4/7, 45-day-mean
band): **worker 74/82/78, comfortable 24/17/20** against the 50-70 / 25-40
target, with the worker cast-vs-cohort gap (the `tierAcceptance` daily-|diff|
metric, 15-day mean) at **12.8/12.5/2.5** — the guard temporarily widened to 14.
Both diagnosed causes were verified against ground truth, and one was refuted:

- **(a) confirmed — the cast is trip-starved, not the crowd.** The doubled map
  makes a cast worker's after-work shop window reach fewer stores, so it
  completes fewer buys than its frictionless cohort (cast worker sat **49.5** vs
  cohort **61.0**, seed 11). But the A3 lever for this — `WORKER_CATCHUP_BASKETS`
  — is **supply-capped and cannot be turned up**: the city runs a chronic bread
  shortage (~250-350 unmet/day), so buying MORE per trip just stockouts more
  often and cast worker sat FALLS (measured WCB 2→3: 49.5→48.4, gap 11.5→13.9;
  2→4: →46.9). The catch-up is already at its supply-limited optimum.
- **(b) re-diagnosed — the depressor is jobless immigration, not shelf geometry.**
  The bootstrap contention is real but not the binding constraint: crowd
  employment has **no reach limit** (`CohortLaborSystem` pass 3 fills any firm's
  open slots), so it is bounded by firm job-count, not by which district the
  crowd sits in. The measured killer is that immigration gates on town
  **satisfaction only** (≥ 55), never job supply, and inflow is proportional to
  the worker cohort's own population — so it **compounds**. On the 260×184 map
  the crowd floods to **472** against only **~155** jobs, and worker employment
  share collapses to **0.20**. That cratered empShare quadratically throttles the
  promotion gate (qualFrac ∝ satTerm²·wageFrac·empShare, wageFrac ≤ empShare, so
  ∝ empShare²) — worker promotion's move-quantity `floor(pop · 0.07 · qualFrac)`
  rounds to **zero** — while the idle over-tier is demoted at 2×. The gates land
  in a **chaotic, bistable regime**: a 35-config constant sweep found the SAME
  gate settings seating one seed at 60/37 and another at 92/6, each seed falling
  into a "healthy" (~68/30) or "collapsed" (~90/6) basin by trajectory phase.
  Pure gate-constant tuning cannot seat all three (documented below).

**The two fixes** (both cohort-population-gated, hence Village bit-identical —
re-verified: the 416-test suite incl. golden fixtures v1-v7 passes unchanged):

- **`INFLOW_RATE` 0.004 → 0.002** (`CohortSocialSystem`). Halving the immigration
  rate breaks the compounding, so the crowd stays proportionate to jobs (worker
  empShare recovers to **0.32-0.38**) and the gates return to the stable regime
  the A3 calibration was tuned for. The doc always called the migration rates
  "starting values to pin against the soaks" — this is that pinning. The effect
  is a **plateau, not a knife-edge**: once the flood stops, town avg sat sits
  near the 55 bar and immigration barely fires, so 0.4×/0.5×/0.6× the base rate
  give **bit-identical** 300-day outcomes; the plateau breaks upward only at
  ~0.7× (immigration resumes, seed-7 comfortable falls back to 0.16). The crowd
  now holds steady at **300** (bootstrap size) instead of ballooning to 472.
- **`RESERVE_FACTOR` 1.0 → 1.7** (`CohortDemandSystem`). A **super-proportional**
  cast shelf reservation: the trip-disadvantaged cast's fewer window trips now
  land against a protected shelf (cast worker sat **49.5 → ~54-57**), which is
  what the catch-up could not buy. This closes the worker gap AND — because a
  happier cast worker promotes through the cast `TierSystem` and the curator
  retires it into the crowd's comfortable cohort — **feeds the comfortable band**
  (the curator re-seed is the real comfortable inflow, not the zero-flooring
  promotion gate; the A3 "Combined re-measure" established this). `INFLOW` alone
  lands only one seed with bad gaps (seed-4 gap 16.9); `RESERVE_FACTOR` alone
  fixes the gap but leaves the bands flooded — the two are **complementary**.
  Swept against the bands: 1.65 blows seed-4's gap to 18 and leaves seed-7 over
  band, 1.8 pushes seed-11 back out; 1.7 seats all three (a narrow sweet spot —
  the same chaotic-gate knife-edge the A3 `DEMOTION_FLOW_RATE`=2.0 pinning has).

**Result — worker/comfortable/affluent land in band on all three seeds** (300
days × seeds 11/4/7; 45-day-mean band; conservation exact to the cent):

| seed | before (W/C/A) | after (W/C/A) | worker empShare (before→after) |
|------|----------------|---------------|--------------------------------|
| 11   | 74 / 24 / 2    | **68 / 30 / 2** | 0.20 → 0.38 |
| 4    | 82 / 17 / 2    | **65 / 32 / 2** | 0.26 → 0.32 |
| 7    | 78 / 20 / 2    | **66 / 31 / 2** | 0.24 → 0.36 |

Worker 50-70 ✓ (all), comfortable 25-40 ✓ (all), affluent ≤ 15 ✓ (2-3%, its 5%
floor still **waived** — the city-scale luxury-supply limit documented in the A3
soak is unchanged), conservation exact ✓, crowd 300 / employment ~42-49% ✓,
cast pop 109-123 ✓, **≤ 0.72 ms/tick** (engine avg; wall-clock ≤ 0.46) under the
0.8 ms A4 budget ✓. Cast average satisfaction improved to 53.7/55.8/54.9 (run
minimum 38/42/45), and the bread shortage eased (unmet 245/276/248/day vs 344 at
the seed-11 baseline) — the smaller crowd is better fed.

**Worker cast-vs-cohort gap — fixed on the tested seed, one honest residual.** By
the `tier-joint` probe's mean-of-means metric the gap lands **2.6 / 8.0 / 5.7**
(from 11.5 / 6.9 / 5.4) — in-band on all three. By the `tierAcceptance` suite's
stricter **daily-|diff|** metric (15-day mean, which also captures the
curator↔demotion day-to-day churn) it lands **5.84 / 7.02 / 14.88** (from
12.8 / 12.5 / 2.5): seeds 11 and 4 improve, but **seed 7 oscillates to ~15**. Its
45-day mean-of-means gap is 5.7 (cast and cohort worker sat track closely ON
AVERAGE) — this is churn OSCILLATION, not a persistent gap, a known property of
the chaotic gates this doc documents. The suite's 300-day case pins **seed 11**
(the improved, tested seed, gap 5.84 ≤ 8); the residual is disclosed here rather
than papered over. Driving seed-7's daily oscillation down requires damping the
curator↔demotion churn (a mechanism change — every demotion-rate tweak that
calmed it re-collapsed a band), deferred.

**Rejected alternatives** (each measured, then discarded):

- *Turning up `WORKER_CATCHUP_BASKETS`* — supply-capped; 2→3/4 LOWERS cast worker
  sat and comfortable (cause (a) above). The A3 lever is dead on the big map.
- *Gate-constant retuning* (`DEMOTION_FLOW_RATE`, promotion empShare exponent,
  `GATE_HOLD_FRAC`) — the low-employment regime is bistable; no single setting
  seats all three seeds (35-config sweep). Reducing demotion to lift comfortable
  re-opened the worker gap (weak demotion stops dragging the cohort worker sat
  down toward the cast's); the gap and the bands pull opposite ways under the
  gates alone.
- *Commercial-strip-above-residential map flip* (Village-faithful geometry) —
  shortens cast trips but the **cohort shops from the residential CENTER**, which
  the flip pushes farther from the top-placed stores; comfortable-cohort
  satisfaction cratered to 8-32 and the band collapsed. The cohort, not the cast,
  is most of the demand, and it wants commerce near the band center.
- *Reversing home placement bottom-up / reducing `crowdStart`* — both perturbed
  the bistable gates into a different-but-still-chaotic basin (crowdStart 150
  overshot comfortable to 43% on two seeds while blowing the gap to 15-20).

### City headroom recalibration — the teens-firm target diagnosed (measured)

The deferred-twice A3 crowd-tier pass: raise `founderUndersupplyFillRate` (City
0.65) so the City carries 11-14 firms like the task's target, WITHOUT tripping
the pinned pool-drift and worker-gap guards. Probe: `docs/design/probes/
city-headroom.ts` (`FILLRATE`/`DAYS`/`SEEDS` env overrides), which reports the
firm count, the 15-day test bands, BOTH gap metrics, and the full pool-drift
guard (drift / $500 level / plateau) together, per seed. **Verdict: the teens
target is blocked by a structural conflict, not a tuning gap — a robust landing
needs a mechanism redesign beyond a calibration pass. No trigger change ships;
the diagnosis and the validated first ingredient are recorded here.**

**Reproduced — the raised trigger trips two guards (300 days × seeds 11/4/7):**

| trigger | firms (11/4/7) | seed-11 band15 W/C | seed-11 gap(daily15) | seed-11 pool drift40→120 |
|---------|----------------|--------------------|----------------------|--------------------------|
| 0.65 (shipped) | 9 / 9 / 8 | 0.61 / 0.37 | **5.84** ✓ | **$0.46** ✓ |
| 0.68 | 11 / 11 / 8 | 0.63 / 0.34 | 7.07 ✓ | **$2.22** ✗ |
| 0.70 | 12 / 13 / 9 | 0.63¹/0.34¹ | **14.97** ✗ | **$2.22** ✗ |
| 0.72 | 13 / 11 / 14 | 0.63¹/0.35¹ | **22.12** ✗ | **$2.22** ✗ |

(¹ 45-day band; the A5 disclosure "221 > $2.00/cap/day, 22 > 8" is reproduced
exactly at 0.72 seed 11: drift $2.22 = 221¢, gap 22.12.) **0.68 is the unique
sweet spot** where seed 11 (the pinned seed) holds the bands AND the worker gap
at 11 firms — the trigger sweep is chaotically non-monotone (0.66/0.67 fail the
gap at 12.4/10.9; 0.68 passes at 7.07; 0.70 fails again at 15.0), the same
bistability the A4 recalibration documented. At 0.68 the ONLY failing guard is
pool-drift.

**Why the pool-drift guard fires — a genuine runaway, not a bounded higher
equilibrium.** At 0.68 seed 11 the per-capita cohort pool climbs monotonically
**$367 (d80) → $466 (d120) → $556 (d200) → $662 (d290)** — it never plateaus (the
flat `CROWD_RENT_PER_DAY` sink was calibrated for the ~9-firm equilibrium's
~0.38 crowd employment; the extra firms lift employment to ~0.51, and the wage
inflow scales with employment while the flat sink does not, so the pool runs away
exactly as the pre-sink city-soak did). Against the shipped 0.65 (bounded:
$362 → $325 → $367 → $407), this is the failure mode the guard exists to catch.
The guard is correct; it is not re-pinnable.

**The structural conflict — the runaway pool IS what feeds the comfortable band.**
Founder firms pay `baseWage` **$16**, but the comfortable wage bar is `sub ×
COMFORTABLE_WAGE_MULT` = **$18** — so crowd workers never clear the WAGE leg of
the promotion gate, and comfortable-band formation rides the SAVINGS (pool) leg
instead. That pool is the very thing the drift guard bounds. So the two guards
pull in opposite directions at the raised trigger: a sink strong enough to tame
the runaway drains the pool that the comfortable band lives on. Measured directly
— a prosperity-scaled sink (drain per-capita pool above a floor) lands seed-11
drift back under $2.00 and the pool plateaus, but comfortable **collapses to
0.23-0.28**, out the bottom of the 25-40 band. The pool-drift guard and the
comfortable-floor guard are the same knife-edge seen from two sides.

**Validated first ingredient — decouple comfortable from the pool via wages.**
The clean root-cause fix is to make comfortable formation ride the WAGE leg (which
scales with firm count) rather than the runaway pool. Preset-gating the founder
crowd wage to **$18** (Village keeps $16 — bit-identity) so crowd workers clear
the comfortable bar, PLUS the prosperity sink, was measured at 0.68 seed 11:
**10 firms, 0 insolvent, worker 0.68 ✓, comfortable 0.298 (at the band floor),
gap(daily15) 2.26 ✓, drift $0.40 ✓, and the pool now PLATEAUS (d120−d80 = $6.9 «
the 10% bar)** — the
drift/level/plateau guards all pass with the band held and the field solvent,
because comfortable no longer depends on the pool. This confirms the diagnosis
and is the direction a future pass should build on.

**Why it still does not ship — the worker gap stays chaotically bistable.** With
the pool conflict decoupled, the last holdout is the worker cast-vs-cohort gap,
and it remains the chaotic curator↔demotion oscillation this doc has documented
throughout: across the founder-wage × sink sweep the seed-11 gap ranged 2.3-14.4
and seeds 4/7 ranged 1.5-30 with no single setting seating the worker/comfortable
split AND the gap on all three seeds at once (the persistent 21-point cast-worker
starvation at 13-14 firms is a trip-limited-cast vs frictionless-cohort
equilibrium divergence that WIDENS with supply, and the daily-|diff| oscillation
component resists constant-level damping — a trailing-window demotion-flow EMA was
prototyped and REJECTED: it damps the day-to-day variance but its lag shifts the
mean flow enough to re-collapse a band, even at the shipped 0.65 trigger it pushed
seed-11 worker to 0.72 / comfortable to 0.26). Widening the pinned 50-70 / 25-40
bands to admit that regime is the one move this calibration does not make, so the
trigger stays at 0.65 and the headroom work is scoped forward: the founder-wage
decoupling lands cleanly, but the cast-worker gap needs a mechanism that gives the
trip-limited cast the cohort's URGENT_TRIPS throughput WITHOUT feeding the founder
fill-rate signal (which turns `WORKER_CATCHUP_BASKETS` twitchy — 2→3 collapsed the
firm count to 5 by lifting fill above the trigger), a larger change than this pass.

**Rejected/deferred here** (each measured): the honest slope re-pin of the drift
guard (rejected — the pool is a true runaway, not a bounded turnover);
constant-level demotion/curator damping (`DEMOTION_FLOW_RATE`, `MAX_SWAPS_PER_DAY`
hysteresis — each re-collapsed a band, reproducing the A4 finding); a trailing-
window demotion EMA (rejected — mean-shift re-collapses a band); `RESERVE_FACTOR`
and `WORKER_CATCHUP_BASKETS` sweeps (the demand-side levers do not move the
trip-limited cast worker, and the catch-up fights the founder signal); a shorter
City founder cooldown for smoother pacing (pushed seed 11 into the collapsed
comfortable-11 basin). The founder-wage-decoupling + prosperity-sink pair is the
one measured result that resolves the pool↔comfortable conflict; it is documented
as the forward path rather than shipped half-finished.

### City decoupling — the forward path built, measured against the real pins, and NOT shipped

The follow-up pass built the two validated ingredients as real code and measured
them across BOTH triggers × all three seeds × the ACTUAL committed guards (not just
the probe), to answer the one question the diagnosis left open: does the decoupling
ship at the shipped 0.65 trigger with margin restored, or does it hold all guards on
all seeds at 0.68? **Verdict: neither. The decoupling is inseparable from the trigger
raise — a raised-employment mechanism that BREAKS the pinned bands at 0.65 — and the
raise itself still fails the cast-worker gap on seeds 4/7. The city stays at fill 0.65,
$16 founder crowd wage, flat rent sink, bit-identical to today; the code was reverted.**

**What was built (exactly the two ingredients).** (a) A per-preset `founderCrowdWage`
in `SIZE_PRESETS`: City $18, Village/Metropolis $16 — the wage gate scoped to City
alone, the honest preset-scope decision, because Metropolis's 24-30 founder / 0-insolvent
pins are bit-identity-pinned at fill 0.80 with a 10k crowd, a regime the $18 decoupling
was neither measured nor needed against (raising it there perturbs those pins for no gain).
The comfortable wage bar `sub × 18/14` carries a sub-cent float tail (1800.0000000000002¢),
so the cohort promotion bar was cent-rounded so a $18 founder wage clears it — provably
inert to every pinned run (no pinned firm pays inside the sub-cent gap; the demotion FLOOR
bar was left un-rounded because Metropolis $16 crowd sits a float epsilon under the $16
floor and rounding would flip that pinned behavior). (b) A prosperity-scaled pool sink in
`CrowdRentSystem` (`prosperityDrainFloor` / `prosperityDrainRate`, City-only, rate 0 for
Village AND Metropolis so both stay byte-identical): above the floor a cohort sheds a
fraction of its per-capita excess to the world each day, so the pool plateaus at any firm
count.

**The mechanism reproduces the diagnosis exactly (validation confirmed).** At 0.68 seed 11
with the sink at floor $450 / rate 0.08, the probe measures **10 firms, 0 insolvent, worker
0.625 / comfortable 0.351 (both in band), gap(daily15) 3.41 ✓, drift $1.35 ✓, pool plateaus
d80 $369 → d120 $396** — the pool runaway is bounded and comfortable is held on the WAGE leg
(the pool is drained below its savings bars, so comfortable no longer depends on it). This is
the validated result the diagnosis recorded; the implementation is faithful.

**Full guard table — 3 seeds × {0.65, 0.68} × {before, after decoupling}** (300-day probe;
"after" = $18 wage + sink floor $450 / rate 0.08, the setting that reproduces the seed-11/0.68
validation; band15 W/C, gap = daily-|diff| 15-day, drift = 40→120 $/cap/day; all 0 insolvent
except where noted):

| trigger | seed | before firms · W/C · gap · drift | after firms · W/C · gap · drift | after verdict |
|---------|------|-----------------------------------|----------------------------------|---------------|
| 0.65 | 11 | 9 · .609/.365 · 5.84 · 0.46 (PASS) | 10 · .645/.332 · **17.13** · 1.37 | gap ✗ |
| 0.65 | 4 | 9 · .666/.310 · 7.02 · 0.39 (PASS) | 7 · **.771/.206** · 7.45 · −0.37 | band ✗ |
| 0.65 | 7 | 8 · .655/.321 · 4.18 · 1.02 (PASS) | 9 · .651/.325 · 0.57 · 1.33 | bands ✓, plateau ✗ |
| 0.68 | 11 | 11 · .632/.344 · 7.07 · **2.22** | 10 · .625/.351 · 3.41 · 1.35 | **PASS** |
| 0.68 | 4 | 11 · .608/.367 · **13.33** · 0.39 (1 distressed) | 10 · **.791/.185** · **13.15** · −0.34 | band+gap ✗ |
| 0.68 | 7 | 8 · .618/.358 · 3.91 · 1.02 | 9 · **.722/.254** · **10.13** · 1.60 | band+gap ✗ |

**Against the ACTUAL committed tests (the load-bearing check).** `tierAcceptance.test.ts`
guards seeds 4/7 with the 150-day forming band (W 0.58-0.80) and carries the tight 300-day
band + gap≤8 on seed 11 only. Run with the decoupling live at the shipped 0.65 trigger:
- **The $18 wage ALONE (sink inert) breaks seed-7's 150-day worker ceiling: 0.847 > 0.80** —
  and 0.847 is not noise, it is the SAME value under wage-only and under every sink setting
  (0.03/0.04/0.05), because the sink does not fire in the first 150 days. Worker 0.85 /
  comfortable ~0.13 at day 150 is precisely the pre-A4-recalibration broken regime the band
  was tightened to exclude ("seed 7 formed W 0.87 / C 0.11 at day 150" — the test's own
  cited failure). Admitting it would widen a band to re-admit a broken regime, which this
  calibration does not do.
- Seed 11's 300-day pin holds under wage-only (0.655/0.322, gap 5.37) but ANY active sink
  founds extra firms and blows its gap (17.13) or its worker ceiling (0.715).
- At steady state (day 300) the decoupled 0.65 regime leaves **seed 4 comfortable 0.245 and
  seed 7 comfortable 0.298 — both below the 25-40 band floor.** Broken, not slow-forming.

**Root cause — sharper than the diagnosis (why it cannot ship incrementally at 0.65).** The
decoupling shifts comfortable-band maintenance from the pool SAVINGS leg (capped at
`SAVINGS_ROUTE_CAP` = 0.5) onto the WAGE leg, whose value is ≈ crowd `empShare`. That holds
comfortable only when empShare ≥ ~0.5 — which happens ONLY at the raised trigger's higher firm
count (the diagnosis's own "extra firms lift employment to ~0.51"). At the shipped 0.65 trigger
employment runs ~0.30-0.42, AND the $18 payroll bump (+12.5%) suppresses it FURTHER through the
`CROWD_WAGE_BUFFER_DAYS` hiring throttle — cash-constrained founders hire fewer crowd (seed 4:
0.32 → 0.23). So the wage leg is WEAKER than the savings cap it replaced and comfortable falls
out of the band bottom. **The decoupling is a raised-trigger-regime fix; it is inseparable from
the trigger raise and degrades the 0.65 equilibrium it would ship into.** Firm solvency is not
the failure mode — 0 insolvent throughout; the higher payroll bites as reduced HIRING, and the
empShare-weighted gates translate that straight into a collapsed comfortable band.

**Verdict.** Both ship paths are closed by measurement: the 0.68 raise fails the seeds-4/7 gap
(13.15 / 10.13); the decoupling at 0.65 fails the pinned seed-7 150-day band and the seeds-4/7
comfortable floor. The two ingredients are VALIDATED at seed-11/0.68 (pool runaway bounded,
plateau, comfortable held on wages, 0 insolvent) but cannot seat all three seeds at either
trigger. Blast radius confirmed inert by construction: the wage gate + sink are City-only
(Village/Metropolis pin $16 and rate 0, byte-identical — Metropolis's 24-30/0-insolvent pins
untouched), so nothing outside City ever moved. The pass reverts to bit-identity rather than
ship a change that breaks a pinned band or re-pins one to admit a broken regime. The forward
path from here is unchanged and is the whole-mechanism change the diagnosis named: give the
trip-limited cast the cohort's URGENT_TRIPS throughput to close the cast-worker gap AND lift
City crowd employment toward ~0.5 (so the wage leg can carry comfortable at 0.65) — e.g. a
City founder-cash uplift to absorb the $18 payroll without shedding hires, measured jointly
with the gap mechanism. The `founderCrowdWage` + prosperity-sink pair is the validated engine;
it waits on that employment/gap work, not on further calibration of these two knobs alone.

**Stretch (investors-on-city / C1-on-city) — untouched, as scoped.** Both remain gated off in
the pinned City run (`investorsEnabled`/breadth catalog). They only become relevant once the
decoupling actually ships (i.e. once the trigger can rise): an active holdco drains the firm
sector against the public float, which would move the very crowd-tier bands this pass could not
seat, and the C1 breadth engages the metropolis-only `BASKET_WEIGHT_BASELINE` renormalization
on the City crowd — each is its own re-pin against a regime that does not yet exist. Not
attempted here; noted as the next dependency after the employment/gap mechanism lands.

### The City cast-parity mechanism — built, measured across the full grid, and NOT shipped

This pass took up the forward path the decoupling verdict named: build the cast-parity
gap mechanism and the employment lift, measure them JOINTLY across the full grid against
all committed guards on all three seeds. The three ingredients the diagnosis asked for were
built as real, City-preset-gated code — every one INERT at its default, so a plain
`{...DEFAULT_CONFIG, sizePreset:'city'}` town is bit-identical to before (verified: the full
545-test suite passes unchanged, Village untouched by construction). They are reproducible via
`docs/design/probes/city-decoupling.ts` (env overrides `FILLRATE/WAGE/WCB/SYNTH/SINKFLOOR/
SINKRATE/FCASH/IMMIGFLOOR`). **Verdict: NO SHIP. The full mechanism seats the pinned seed 11 on
EVERY committed guard, but the trip-limited-cast worker gap stays supply-capped and bistable on
seeds 4/7 — no grid cell seats all three. The City stays at fill 0.65, $16 founder crowd wage,
flat rent, shipped-gate immigration, bit-identical to today; the mechanism lands dark.**

**The gap mechanism (built).** `RetailDemandSystem`'s worker catch-up is now a preset knob
(`catchupBaskets`) with an honest ACCOUNTING SPLIT (`catchupSyntheticSignal`): the catch-up
tranche buys real stock and pays real revenue (money conserved, the citizen's need and the
firm's P&L see the full purchase) but is EXCLUDED from the founder-visible market shortage gauge
(`marketStats` units/unmet) — worker-catch-up demand is synthetic parity demand standing in for
the URGENT_TRIPS the after-work window denies the jobbed cast worker, not market demand. This is
exactly the "give the cast the cohort's throughput WITHOUT feeding the founder fill-rate signal"
the diagnosis asked for, and it works as designed — but it uncovered the FIRST sharp result.

**Sharp finding 1 — the honest split REVEALS the catch-up was inflating the firm count.** With
the catch-up counted as market demand (shipped), its persistent UNMET portion inflated the
founder's shortage signal — so some of the raised trigger's extra firms were an artifact of
counting parity demand as a market shortage. Making the accounting honest DROPS the firm
equilibrium: at 0.68 the field falls from 10/10/9 firms to 7/6/7 (synthetic on, WCB 4), and even
at 0.78 the honest signal only carries ~9-11 firms (vs 12/11/13 with the catch-up double-counted).
The gap mechanism and the firm-count headroom pull in OPPOSITE directions through the founder
signal — the cleaner the accounting, the fewer firms capital is told to build.

**Sharp finding 2 — closing the cast gap RE-TRIGGERS the jobless-immigration flood.** Recovering
the firms via a higher trigger, combined with a happier cast, floods the crowd: immigration gates
on town SATISFACTION only (≥ 55), never job supply (the A4 wall), so a well-served town attracts
worker households faster than founders add jobs and crowd empShare craters to ~0.25-0.28
regardless of firm count OR founder cash (a $22k→$30k founder-cash uplift left empShare at 0.28 —
the binding constraint is NOT firm cash, it is the flood). The doc's `INFLOW_RATE = 0.002` pin
only ever held because the STARVED cast kept town satisfaction near the bar; fix the cast's mood
and 0.002 floods again. This pass built the missing third mechanism — an EMPLOYMENT-AWARE
immigration gate (`immigrationEmpFloor`): inflow scaled by `clamp((empShare − floor)/(1 − floor))`
so capital attracts labor only where there is work. It works: with the gate at floor 0.5 the crowd
holds at its 300 bootstrap on every seed (no flood), and **seed 11 then seats every committed
guard** (0.78 trigger, $18 wage, sink, WCB 4, gate 0.5: 9 firms, W 0.64 / C 0.34, gap 3.8, drift
$0.14, 0 insolvent, conserved).

**Sharp finding 3 — the cast-worker gap itself is supply-capped and bistable; the basket lever
cannot close it on all seeds.** With the flood fixed and seed 11 seated, the last holdout is the
cast-vs-cohort worker gap on seeds 4/7. Raising the catch-up does NOT close it: WCB 4→6→8 leaves
the seed-4/7 gap pinned at ~20 (cast worker sat 47-52 vs frictionless cohort 63-67), and higher
baskets make it WORSE (seed-4 cast worker 47→44 from WCB 4→6) — the cast is TRIP-limited, not
basket-limited, so folding more into its one after-work visit just stockouts against a depleting
shelf, exactly the supply cap the A4 recalibration measured. Decoupling the founder signal removed
the twitchiness but not the cap. Seed 11 falls in the "healthy" basin and seeds 4/7 in the
"collapsed" one — the same chaotic bistability documented throughout — and no basket count,
trigger, sink, cash, or gate-floor setting swept here seats all three.

**The joint grid (300 days × seeds 11/4/7; all rows $18 wage + prosperity sink floor $450 /
rate 0.08 except the shipped baseline; band15 W/C, gap = daily-|diff| 15-day, drift = 40→120
$/cap/day; committed guards = W .50-.70, C .30-.40, gap ≤ 8, drift < $2.00, level < $500, conserved):**

| trigger · synth · WCB · gate | firms 11/4/7 | seed 11 W/C·gap·drift | seed 4 W/C·gap·drift | seed 7 W/C·gap·drift | verdict |
|------------------------------|--------------|-----------------------|---------------------|---------------------|---------|
| 0.65 · off · 2 · — (SHIPPED)  | 9/9/8   | .61/.37 · 5.8 · 0.46 | .67/.31 · 7.0 · 0.39 | .65/.32 · 4.2 · 1.02 | **all PASS** |
| 0.68 · off · 2 · —            | 10/10/9 | .63/.35 · 3.4 · 1.35 | **.79/.18 · 13.2** · −.34 | **.72/.25 · 10.1** · 1.60 | 4/7 band+gap ✗ |
| 0.68 · on · 4 · —             | 7/6/7   | **.84/.14 · 11.7** · .03 | **.78/.20** · 7.7 · .36 | **.71/.27** · 2.7 · .27 | firms collapse ✗ |
| 0.72 · on · 3 · —             | 9/9/7   | .64/.33 · **15.9** · .32 | **.71/.27 · 13.4** · .31 | **.68/.30 · 13.4** · −.40 | gap+band ✗ |
| 0.72 · on · 3 · — · $30k cash | —/9/8   | (empW 0.31) | .73/.25 · 3.7 · .42 | .69/.29 · 3.0 · −.32 | band ✗ (cash ≠ employment) |
| 0.78 · on · 3 · —             | 12/11/13| .71/.27 · 9.6 · .32 | **.73/.24 · 15.8** · .31 | **.63/.35 · 19.6** · 1.30 | gap ✗ (empW flood) |
| 0.78 · on · 4 · floor 0.5     | 9/10/11 | **.64/.34 · 3.8 · .14 PASS** | .69/**.29** · **21.4** · 1.06 | **.73/.26 · 17.0** · 1.12 | 4/7 gap+band ✗ |
| 0.78 · on · 6 · floor 0.5     | 9/12/7  | .61/… · ~4 · — | .62/.35 · **20.4** · .10 | **.83/.16 · 21.5** · −.19 | gap ✗ (WCB worse) |
| 0.78 · on · 8 · floor 0.5     | 10/12/8 | .65/… · ~5 · — | .65/.35 · **20.4** · .24 | .52/**.46 · 19.3** · .34 | gap ✗ (cap confirmed) |

**What shipped: nothing (mechanism / decoupling / trigger all held at baseline).** No guard was
re-pinned; no band was widened. The employment-gated immigration is the one genuinely new,
clean mechanism the pass produced (it does exactly what the A4 flood diagnosis wanted), but it
delivers no user-visible win ALONE at the shipped trigger (the baseline crowd already holds ~300)
and cannot ship without the trigger raise it exists to enable — which the cast gap still blocks.
All four ingredients (`founderCrowdWage`, `catchupSyntheticSignal` + `catchupBaskets`,
`prosperityDrainFloor`/`Rate`, `immigrationEmpFloor`) remain in `SIZE_PRESETS` at their inert
defaults as measured dark foundations for the next attempt.

> **Pruned (hygiene pass, atop `2e8fb1b`).** `immigrationEmpFloor` — the employment-aware
> immigration gate this pass built — was removed from the config and `SIZE_PRESETS`: attempt #4
> (below) measured it **byte-inert across the entire joint regime** (no headcount flood exists
> post the `INFLOW_RATE = 0.002` pin), so it never earned its keep. This verdict stays as the
> record of why it was built and measured. The three surviving ingredients above stay live.

**The root cause, now three-layered (the pass's contribution over the prior diagnosis).** The
prior verdict named ONE wall (the cast gap is trip-limited and bistable). This pass measured that
the three levers are mutually locked: (1) the gap mechanism's honest accounting SUPPRESSES the
firm count it needs, because the catch-up unmet was propping the founder signal up; (2) the
employment the wage-leg needs is capped not by firms or cash but by a satisfaction-gated
immigration flood that a HAPPIER cast makes WORSE, curable only by a new employment-aware gate;
and (3) even with (1) and (2) resolved and seed 11 seated, the underlying cast-worker gap is
supply-capped — more throughput stockouts rather than satisfies — so it stays bistable across
seeds. The forward path is no longer "close the gap"; it is a cast-shopping model that gives the
trip-limited worker the cohort's throughput WITHOUT more single-visit basket depth — a genuine
extra shop-window VISIT against a restocked shelf (the cohort's slice settlement), which
`CitizenScheduleSystem` does not today grant and which prior "extra cast trips" probes found
contention-negative. That is a scheduling/routing change, not a demand-constant one, and is where
the next attempt must start.

### Cast-parity attempt #3 — the restocked-shelf revisit, built, measured, and NOT shipped

This pass took up the exact forward path the prior verdict named: the "genuine extra
shop-window VISIT against a restocked shelf" — a **cast-shopping model** change, not another
demand-constant. Built as `SIZE_PRESETS.restockRevisit` (false everywhere; flag-off byte-
identical — the full 579-test suite passes and a Village stays bit-identical even with the
flag FORCED true, double-gated on crowd presence): when a cast WORKER's *urgent* need stocks
out at an **open** store, that (store, product) is queued on the citizen; if LogisticsSystem
restocks it later the **same day**, a new `runRestockRevisitSystem` (right after
`RetailDemandSystem` in the tick) grants **one** extra purchase attempt through the SAME
`attemptPurchase` path (a plain single basket — no catch-up stacking, no re-queue, no rng, no
movement; "swung by on the way home"). Reproducible via `docs/design/probes/cast-revisit.ts`
(`npx tsx`, flag OFF vs ON side-by-side per seed). **Verdict: NO SHIP. The mechanism engages
exactly as designed — the trip-limited worker catches the late restock and cast worker sat
lifts +2 to +3.6 — but it re-triggers the same three-layered wall the prior verdict measured:
it fails the committed seed-11/seed-4 guards, and only seed 7 (the "healthy" basin) seats. No
band was widened; the mechanism lands dark-and-inert in-tree as the fourth measured cast-
parity foundation.**

**Context that reframes the target: the ~20-point gap the task cites is HISTORICAL.** The
shipped baseline already closed the worker gap via the A4-geometry `RESERVE_FACTOR = 1.7`
super-proportional cast reservation + `WORKER_CATCHUP_BASKETS` — the flag-OFF gap measured
here is **2.6 / 8.0 / 1.7 (MoM45)**, already single-digit, so there is little gap left for a
revisit to narrow. What the revisit changes is the *equilibrium around it*.

**The grid** (300 days × seeds 11/4/7; band15 W/C against the committed .50-.70 / .30-.40;
worker sat cast/cohort; gap MoM45 / daily-|diff|-15 against the committed ≤ 8; bread unmet/day
and 14-day fill; conservation exact 0c on every cell):

| seed | flag | firms | band15 W/C | worker sat cast/coh | gap MoM/daily | empW | bread unmet/fill | verdict |
|------|------|-------|------------|---------------------|---------------|------|------------------|---------|
| 11 | OFF | 9 | .609/.365 | 55.7 / 53.1 | 2.6 / **5.84** | .36 | 249 / .66 | baseline PASS |
| 11 | ON  | 10 | **.686/.291** | 59.3 / 65.3 | 5.9 / **10.52** | .25 | 376 / .56 | C<.30, gap>8 ✗ |
| 4  | OFF | 9 | .666/.310 | 57.2 / 65.2 | 8.0 / 7.02 | .32 | 280 / .63 | baseline PASS |
| 4  | ON  | 8 | .677/.300 | 59.3 / 67.1 | 7.8 / **9.22** | .42 | 259 / .67 | gap daily >8 ✗ |
| 7  | OFF | 8 | .655/.321 | 60.3 / 62.0 | 1.7 / 4.18 | .34 | 264 / .66 | baseline PASS |
| 7  | ON  | 9 | .625/.348 | 63.0 / 62.0 | 1.0 / 1.72 | .28 | 265 / .65 | all PASS |

Deltas OFF→ON: cast worker sat **+3.6 / +2.1 / +2.7**, cohort worker sat **+12.2 / +1.9 /
+0.0**, cast pop 109→132 / 123→128 / 112→108, cast mean bread urgency 1.77→2.04 / 1.88→1.65 /
1.54→1.51.

**Why it fails — the same wall, reproduced from the demand-timing side.**

- **Sharp Finding 2 (the immigration flood) is the binding blocker, exactly as the prior
  verdict predicted.** The revisit makes the cast happier, which raises town satisfaction,
  which the satisfaction-only immigration gate (≥ 55, no job-supply term) answers by flooding
  the worker cohort — seed-11 crowd employment share **craters 0.36 → 0.25**. That collapsed
  empShare quadratically throttles the promotion gate (∝ empShare²), so worker promotion
  rounds toward zero while demotion runs at 2×: comfortable **falls out of band (0.365 →
  0.291)** and the worker share swells (0.609 → 0.686, band45 68 → 76). "Closing the cast gap
  RAISES town satisfaction, re-triggering the flood" — measured again, now for the revisit.
- **Contention on the supply cap is real.** The "restocked stock" the cast grabs is not free —
  on seed 11 bread unmet **rises 249 → 376/day** and fill **falls 0.66 → 0.56**: the extra
  cast demand deepens the chronic shortage, the contention-negative outcome prior "extra cast
  trips" probes flagged, now confirmed for the targeted-revisit variant.
- **Daily churn breaks the gap-daily guard even where the mean holds.** Seed 4's gap barely
  moves by MoM (8.0 → 7.8) but the daily-|diff|-15 metric — which also captures the
  curator↔demotion oscillation — blows **7.02 → 9.22 (> 8)** as the extra purchases inject
  day-to-day variance into the chaotic gates.
- **Only seed 7 seats** (gap narrows 1.7 → 1.0, bands in band) — the one seed in the "healthy"
  basin, the same bistability documented throughout this doc.

**What the mechanism does NOT break:** the cohort-side satisfaction regression watchdog (ON
must not drop cohort worker sat > 2 vs OFF) is **not** violated — cohort worker sat *rises* on
all three seeds. The failure is compositional (tier bands, gap-daily churn), not a cohort mood
drop, and money conserves to the cent on every cell (revisit purchases move money only through
`attemptPurchase`'s `recordTransaction`).

**Structural conclusion (unchanged, now doubly-measured).** The demand-timing fix is
**necessary but not sufficient**, for the same reason the catch-up (the basket-depth fix) was:
both close the cast gap locally, and both are blocked by the immigration flood that a happier
cast makes worse. The revisit is a *cleaner* lever than the catch-up (it adds a real extra
visit instead of deepening one basket, and it does not touch the founder fill-rate accounting),
but it cannot ship alone — the employment-aware immigration gate (`immigrationEmpFloor`,
already inert in-tree from attempt #2) must land **jointly** with a demand-timing/gap fix and a
founder trigger that holds crowd empShare ≈ 0.5, so the flood is capped while the cast is
served. That joint landing is the same forward path attempt #2 named; this pass confirms the
revisit is the right demand-side half of it and rules out the revisit-alone shortcut.

**Judgment — kept dark-and-inert in-tree, not reverted.** Matching the precedent of the four
prior inert cast-parity ingredients ("remain in `SIZE_PRESETS` at their inert defaults as
measured dark foundations for the next attempt"), the revisit stays flag-gated-off in the tree
with its determinism/inertness guards (`castRevisit.test.ts`) and its probe, so the next joint
attempt builds on a measured, tested mechanism rather than re-deriving it. It is a heavier dark
surface than the prior preset-number foundations (a new per-tick system that early-returns when
off, plus an optional never-populated `Citizen.pendingRevisits` field), but it is provably
byte-inert off and is the exact mechanism the roadmap's forward path calls for.

### Cast-parity attempt #4 — the JOINT landing, measured across the full grid, and NOT shipped

This pass executed the sharpened forward path attempt #3 named verbatim: land the
`restockRevisit` demand-timing half **jointly** with the already-inert
`immigrationEmpFloor` gate (the "flood-stopper") and a founder trigger meant to hold
crowd empShare ≈ 0.5, so the flood is capped while the cast is served. All pieces were
already in-tree, all inert; nothing was newly built. Measured via
`docs/design/probes/cast-joint.ts` (`npx tsx`; env overrides `REVISIT/IMMIGFLOOR/FILLRATE/
WAGE/WCB/SYNTH/SINKFLOOR/SINKRATE/FCASH/COOLDOWN`, all local to the probe process — source
stays inert). **Verdict: NO SHIP. The joint stack seats the pinned seed 11 on firms, bands,
supply and pool, but the supply-capped bistable cast-worker gap defeats every grid cell on
seeds 4/7 — and, sharper than the prior verdict, the measurement REFUTES the flood-stopper
half of the hypothesis: `immigrationEmpFloor` is byte-inert across the ENTIRE joint regime.
No band was widened; the City stays bit-identical to today; the four ingredients remain dark.**

**Baseline anchored exactly** (shipped regime, all flags off, 300 days × seeds 11/4/7 —
reproduces the committed attempt-#3 grid to the digit): seed 11 — 9 firms, band15 W .609 /
C .365, cast/cohort worker sat 55.7 / 53.1, gap MoM45 2.6 / daily15 5.84, empW .36, crowd 300,
cast 109, bread unmet 249/day, conserved 0c, **PASS**; seed 4 — 9f, .666 / .310, 57.2 / 65.2,
8.0 / 7.02, empW .32, cast 123, bread 280, **PASS**; seed 7 — 8f, .655 / .321, 60.3 / 62.0,
1.7 / 4.18, empW .34, cast 112, bread 264, **PASS**.

**The joint grid** (300 days × seeds 11/4/7; band15 W/C against the committed .50-.70 / .30-.40;
worker sat cast/cohort; gap MoM45 / daily-|diff|-15 against ≤ 8; empW = crowd worker employment
share; drift = days-40→120 $/cap/day, committed < $2.00; bread unmet/day; conservation exact 0c
on **every** cell):

| # | config (revisit on; floor 0.5) | firms 11/4/7 | s11 W/C · cast/coh · gapM/D · empW | s4 W/C · cast/coh · gapM/D · empW | s7 W/C · cast/coh · gapM/D · empW | verdict |
|---|--------------------------------|--------------|------------------------------------|------------------------------------|------------------------------------|---------|
| 0 | SHIPPED (all off) | 9/9/8 | .61/.37 · 56/53 · 2.6/5.8 · .36 | .67/.31 · 57/65 · 8.0/7.0 · .32 | .65/.32 · 60/62 · 1.7/4.2 · .34 | **all PASS** |
| A | revisit+floor only (fill .65) | 10/8/9 | **.69/.29** · 59/65 · 5.9/**10.5** · .25 | .68/**.30** · 59/67 · 7.8/**9.2** · .42 | .63/.35 · 63/62 · 1.0/1.7 · .28 (**drift 2.10**) | all FAIL |
| C | +.68 wage18 synth wcb2 sink | 8/9/9 | **.69/.29** · —/— · 13/**16.5** · .29 | **.71/.27** · —/— · 3.5/**5.4** · .20 | **.70/.27** · —/— · 4.3/**9.6** · .18 | all FAIL |
| D | +.72 wage18 synth wcb2 sink | 8/10/9 | **.78/.20** · —/— · 2.2/**9.7** · .28 | .60/.37 · —/— · 6.7/**10.7** · .24 | .64/.34 · —/— · 6.1/4.9 · .18 | s7 PASS; 11/4 FAIL |
| E | +.72 wage18 synth wcb4 sink | 9/10/8 | **.70/.28** · —/— · 9.2/**15.7** · .25 | .68/**.30** · —/— · 9.0/**10.9** · .26 | .69/**.29** · —/— · 6.4/4.9 · .45 | all FAIL |
| F | +.75 wage18 synth wcb3 sink | 10/11/11 | **.96/.03** · —/— · 7.5/**12.0** · .40 | .69/**.29** · —/— · 9.9/7.6 · .49 | **.72/.26** · —/— · 0.5/**8.0** · .38 | all FAIL |
| B | +.78 wage18 synth wcb4 sink | 13/13/13 | .59/.39 · **41/63** · **21.6/27.7** · .40 | .62/.36 · **46/64** · **17.7/20.2** · .41 | **.54/.44** · **47/67** · **20.4/24.2** · .37 | all FAIL |
| — | **control: cell B, revisit OFF** | 9/10/11 | .64/.34 · 58/54 · **3.8/3.8** · .28 | **.69/.29** · 47/67 · **20.3/21.4** · .37 | **.73/.26** · 52/67 · **14.6/17.0** · .43 | **s11 PASS**; 4/7 FAIL |

(Bold = out of a committed band. The B-vs-control pair is the load-bearing row: the exact stack
that seated seed 11 in the prior "decoupling" verdict — 9 firms, gap 3.8 — jumps to **13 firms**
and blows seed 11's gap to **27.7** the moment the revisit is added, with cast worker sat
DROPPING 58 → 41.)

**Three sharp findings, one of which refutes the prior hypothesis.**

- **Finding 1 (the refutation) — `immigrationEmpFloor` is byte-inert across the whole joint
  regime; there is no headcount flood left to stop.** The gate produces **identical** 300-day
  output floor-on vs floor-off on every cell tested (cell A floor 0.5 == attempt-#3 revisit-alone
  to the digit; cell B floor 0.5 == floor 0; a max-attractive 14-16-firm regime floor 0.5 ==
  floor 0), and the crowd sits at its **300 bootstrap in every cell regardless of the gate**. The
  gate scales *inflow*, but immigration is not firing: post the A4 `INFLOW_RATE = 0.002` pinning
  the City crowd no longer floods by headcount (the 472-crowd flood the empFloor was built for was
  the pre-pinning `INFLOW_RATE = 0.004` regime). The empShare crater the prior verdict blamed on
  "flooding the worker cohort" (0.36 → 0.25) is a **tier-COMPOSITION** effect — comfortable
  demoting into worker swells the worker *denominator* (crowd total unchanged at 300; worker
  headcount 178 → 192) — which an *immigration* gate structurally cannot touch. The flood-stopper
  half of attempt #3's forward path addresses a failure mode that no longer exists.

- **Finding 2 — the revisit's demand is counted as MARKET demand, so it re-inflates the founder
  signal and re-opens the gap the synthetic accounting had closed.** Unlike the catch-up tranche
  (`catchupSyntheticSignal`, excluded from `marketStats`), the revisit buys through
  `attemptPurchase` and its persistent unmet feeds the founder fill-rate gauge. At the raised
  0.78 trigger this lifts the firm count **9 → 13** (cell B vs control), over-serving the
  frictionless cohort (cohort worker sat 62-67) while the trip-limited cast, now contesting a
  city with 13 sellers' worth of crowd demand in its one after-work window, FALLS to 41-47 — the
  gap WIDENS to 20-28. The revisit is a *market-demand* lever; the gap needs a *cast-throughput*
  lever that does not touch the founder signal.

- **Finding 3 — no founder-lever setting holds empShare ≈ 0.5 while seating bands AND gap; the
  gates stay chaotically bistable.** empShare tops out ~0.40-0.49 even at 13-16 firms (the $18
  founder wage's `CROWD_WAGE_BUFFER_DAYS` throttle caps crowd hiring), and every setting that
  pushes it up over-serves the cohort and blows the gap; every setting that keeps the gap down
  leaves empShare ~0.18-0.28, so comfortable loses the wage leg and **collapses into the worker
  basin** (cell D seed 11 W .78/C .20; cell F seed 11 W .96/C .03) — the same trajectory-phase
  bistability documented throughout this doc (one seed seats while another collapses at the SAME
  constants). The "founder trigger holding empShare ≈ 0.5 with gap ≤ 8 and bands seated" the prior
  verdict posited **does not exist anywhere in the grid** — the three targets are mutually
  exclusive under these levers.

**What did NOT break.** Conservation is exact (0c) on every cell — the revisit and cohort flows
move money only through `recordTransaction`. Village/Metropolis are byte-untouched by construction
(every knob is City-preset-scoped), and with all flags at their inert defaults the full 587-test
suite (incl. golden fixtures) and the village 11/4/7 + city 11 pins pass unchanged. The
cohort-side satisfaction regression watchdog is not violated (cohort worker sat rises or holds);
the failure is compositional (tier bands, cast-worker gap), not a cohort mood drop.

**The sharpened hypothesis for attempt #5.** The prior forward path ("revisit + empFloor + founder
trigger holding empShare ≈ 0.5") is now **measured to rest on two dead levers**: the empFloor is
inert (no flood post 0.002), and the revisit-as-market-demand fights the very founder signal it
rides. The corrected next hypothesis has two coupled requirements the grid isolates:
1. **The cast-throughput lever must be founder-signal-neutral** — the revisit needs the same
   synthetic-accounting split the catch-up got (`catchupSyntheticSignal`), so closing the cast gap
   does not re-inflate firm count and re-widen it. This is a one-flag extension of an existing
   mechanism, measurable in isolation, and is the cheapest honest next step.
2. **empShare ≈ 0.5 must be reached WITHOUT more sellers** — because more sellers over-serve the
   frictionless cohort faster than any cast lever can keep pace (the supply-capped divergence that
   WIDENS with supply). The lever is the `CROWD_WAGE_BUFFER_DAYS` hiring throttle, not the founder
   count: a City-scoped relaxation of the crowd-hiring cash buffer would let the *existing* firms
   employ more of the fixed-300 crowd (lift empShare toward 0.5 for the wage leg) without founding
   the extra sellers that blow the gap. Attempt #5's grid should sweep {synthetic-revisit} ×
   {crowd-hiring-buffer relaxation} at the SHIPPED trigger, holding firm count near baseline —
   the first joint that does not try to buy empShare with firms.

**Judgment — nothing shipped; the four ingredients stay dark.** No code changed: the pass added
only the `cast-joint.ts` probe and this verdict. `restockRevisit`, `immigrationEmpFloor`,
`founderCrowdWage`, and `catchupSyntheticSignal`/`catchupBaskets` remain in `SIZE_PRESETS` at
their inert defaults (this verdict records the measurement that the empFloor is inert against the
current no-flood City regime — a candidate for removal or re-scoping once attempt #5 confirms the
crowd stays at bootstrap). An honest NO-SHIP with a full grid, per the standing rule, is a
complete result.

> **Pruned (hygiene pass, atop `2e8fb1b`).** Finding 1's refutation is now acted on:
> `immigrationEmpFloor` was removed from the config and `SIZE_PRESETS` — **measured dead** (byte-
> inert across every cell of this grid). Its `cast-joint.ts`/`city-decoupling.ts` probe axes went
> with it. This verdict and its grid stay as the measurement of record.

### Cast-parity attempt #5 — the signal-neutral revisit × CWBD relaxation, measured, and NOT shipped

This pass executed attempt #4's corrected hypothesis verbatim: a **founder-signal-neutral
(synthetic) revisit** — the `restockRevisit` mechanism given the same market-signal exclusion the
catch-up got — swept against a **`CROWD_WAGE_BUFFER_DAYS` relaxation** meant to lift crowd
`empShare` toward 0.5 for the wage leg WITHOUT founding the extra sellers that over-serve the
frictionless cohort and blow the gap. Two knobs were built as real, City-preset-gated code, both
INERT at their shipped defaults (`restockRevisitSyntheticSignal: false`, `crowdWageBufferDays: 7`
everywhere — a plain `{...DEFAULT_CONFIG, sizePreset:'city'}` town is byte-identical to before; the
full **659**-test suite passes, incl. golden fixtures v1-v10, the village 11/4/7 and city-11 pins,
and 8 new dark-inertness guards in `castParity5.test.ts`). Reproducible via `cast-joint.ts`
(new env overrides `REVISITSYNTH`, `CWBD`). **Verdict: NO SHIP — but the hypothesis is REFUTED, not
merely un-seated. The synthetic-signal split is the cleanest gap lever the roadmap has produced (it
closes the cast-worker gap to ≤ 8 on ALL THREE seeds — a first — while holding firm count at
baseline), yet closing the gap cleanly STARVES the comfortable band; and the CWBD lever is measured
DEAD at the shipped $16 wage (byte-identical across CWBD 1‑20, the buffer never binds). The two
hypothesis ingredients are one genuine advance and one dead lever. The City stays bit-identical;
both new knobs join the dark foundations.**

**Baseline anchored exactly** (all flags off, 300 days × seeds 11/4/7 — reproduces the attempt-#4
grid to the digit): seed 11 — 9 firms, W .609 / C .365, gap MoM45 2.6 / daily15 5.84, empW .36,
crowd 300, cast 109, bread 249/day, conserved 0c, **PASS**; seed 4 — 9f, .666 / .310, 8.0 / 7.02,
empW .32, **PASS**; seed 7 — 8f, .655 / .321, 1.7 / 4.18, empW .34, **PASS**.

**The grid** (300 days × seeds 11/4/7; committed guards W .50‑.70, C .30‑.40, gap daily15 ≤ 8,
drift 40→120 < $2.00/cap/day, level < $500, conserved 0c; band15 W/C, gap = daily‑|diff|‑15, empW =
crowd worker employment share; every cell conserved exact 0c):

| # | revisit · synth · CWBD | firms 11/4/7 | s11 W/C · gapD · empW | s4 W/C · gapD · empW | s7 W/C · gapD · empW | verdict |
|---|------------------------|--------------|-----------------------|----------------------|----------------------|---------|
| 0 | off · — · 7 (SHIPPED)   | 9/9/8   | .61/.37 · 5.8 · .36 | .67/.31 · 7.0 · .32 | .65/.32 · 4.2 · .34 | **all PASS** |
| 1 | on · **on** · 7        | 8/8/9   | **.85/.13** · 1.6 · .25 | **.78/.19** · 1.9 · .36 | .62/.35 · 4.5 · .25 (**drift 2.10**) | 11/4 band, 7 drift ✗ |
| 2 | on · on · 5            | 8/8/8   | **.85/.13** · 1.6 · .25 | **.78/.19** · 1.9 · .36 | **.67/.31** · **9.4** · .29 (**drift 2.10**) | all ✗ |
| 3 | on · on · 10           | 8/8/8   | **.83/.15** · 4.5 · .33 | **.78/.19** · 1.9 · .36 | **.73/.24** · **8.3** · .35 (**drift 2.10**) | all ✗ |
| 4 | on · **off** · 7 (attempt #3 control) | 10/8/9 | .69/**.29** · **10.5** · .25 | .68/.30 · **9.2** · .42 | .62/.35 · 1.7 · .28 (**drift 2.10**) | all ✗ |
| 5 | **off** · — · 5        | 9/9/8   | .61/.37 · 5.8 · .36 | .67/.31 · 7.0 · .32 | .65/.32 · 4.2 · .34 | == baseline (inert) |
| 6 | off · — · 10           | 9/9/8   | .61/.37 · 5.8 · .36 | .67/.31 · 7.0 · .32 | .65/.32 · 4.2 · .34 | == baseline (inert) |

(Bold = out of a committed band / over a gap. Rows 5‑6 are byte-identical to row 0 on every digit,
all three seeds — the CWBD-only cells prove the buffer is inert. Row 4 reproduces attempt #3's
revisit at the shipped trigger.)

**Three sharp findings.**

- **Finding 1 (the genuine advance) — the synthetic-signal split is the cleanest cast-gap lever the
  roadmap has produced.** Booking the revisit as founder-signal-neutral (marketWant 0: the purchase
  is real and conserved, the citizen's need and the firm's P&L see it in full, but it is excluded
  from the `marketStats` units/unmet the founder gauge reads) does exactly what attempt #4's
  Finding 2 asked. Against the non-synthetic control (row 4 → row 1): firm count drops from 10/8/9
  to 8/8/9 — seed 11 is no longer INFLATED by the revisit's unmet feeding the shortage signal — and
  the cast-worker gap collapses (seed 11 daily 10.5 → 1.6, seed 4 9.2 → 1.9). Row 1 is the **first
  revisit variant in this doc to hold the gap ≤ 8 on ALL THREE seeds** (1.6 / 1.9 / 4.5). The
  demand-timing lever, made signal-neutral, closes the gap cleanly. This ingredient is a keeper.

- **Finding 2 (why it still fails) — closing the gap cleanly STARVES the comfortable band.** The
  same market-signal exclusion that stops the revisit inflating the firm count ALSO removes the
  extra market demand that was propping comfortable formation up. Comfortable is fed not by the
  zero-flooring cohort promotion gate but by the cast curator (the A3 "Combined re-measure"
  established this) and the wage leg — both of which ride firm revenue/employment. Strip the
  revisit out of the market signal and comfortable collapses on the two seeds in the collapsed-
  empShare basin: seed 11 C .29 → **.13**, seed 4 C .30 → **.19**, with the worker share swelling
  to .85 / .78. The gap and the comfortable band are now traded through the SAME founder/market
  signal — the sharper restatement of the "the two levers pull in opposite directions" tension the
  headroom verdict named: a revisit visible to the market props comfortable but re-inflates firms
  and re-widens the gap (row 4); a revisit invisible to the market closes the gap but starves
  comfortable (row 1). No synthetic setting is both.

- **Finding 3 (the refutation) — `CROWD_WAGE_BUFFER_DAYS` is a DEAD lever at the shipped $16 wage.**
  The hypothesis's cure for Finding 2 was to lift crowd `empShare` toward 0.5 via the hiring
  throttle, restoring the wage leg WITHOUT new firms. Measured, the throttle does not bind: at $16
  founder crowd wage the City's firms are cash-rich enough that the buffer never limits hiring
  across CWBD **1‑20** — the 300-day seed-11 outcome is byte-identical (rngState-exact) for CWBD 1,
  3, 5, 7, 10, 20 and only diverges at an extreme CWBD 40. So the revisit-off CWBD cells (rows 5‑6)
  are byte-identical to the shipped baseline on all three seeds, and the CWBD axis of the
  signal-neutral rows (1 vs 2 vs 3) does nothing controllable: it is fully inert on seed 4, and on
  seeds 11/7 it merely kicks the bistable gates into a DIFFERENT still-failing basin (empShare
  wanders .25‑.35, never near .5, and seed 7's gap-daily blows past 8). The doc's own note that
  "the $18 founder wage's `CROWD_WAGE_BUFFER_DAYS` throttle caps crowd hiring" is now pinned down: the
  throttle bites only at the raised $18 wage — which requires the raised trigger the hypothesis
  explicitly forbids. And the empShare crater the hypothesis set out to cure is confirmed
  (attempt #4 Finding 1) to be a tier-COMPOSITION effect — comfortable demoting into worker swells
  the worker denominator at a fixed crowd of 300 — which a HIRING throttle structurally cannot
  touch. The lever addresses a quantity (employed headcount) that is not what moves empShare here.

**What did NOT break.** Conservation is exact (0c) on every cell — the signal-neutral revisit moves
money only through `attemptPurchase`'s `recordTransaction`; the split touches only `marketStats`
attribution, never a cent. Village/Metropolis are byte-untouched by construction (both knobs are
City-preset-scoped and inert at default). The cohort-side satisfaction regression watchdog is not
violated (cohort worker sat rises or holds on all cells). The failure is compositional (the
comfortable band), not a cohort mood drop or a conservation break.

**The sharpened hypothesis for attempt #6.** The forward path narrows to ONE mechanism. Attempt #5
resolved the gap lever (the signal-neutral revisit — keep it on) and killed two candidate empShare
levers (the CWBD throttle is dead at $16; more firms/$18 wage over-serve the cohort and are
forbidden). What remains is the **tier-gate composition dynamics itself**: comfortable is held by
the curator + wage leg, both empShare-scaled, and the promotion gate's `empShare²` weighting means
that once comfortable begins demoting into worker (dropping empShare), promotion can never recover
it — a one-way ratchet into the collapsed basin. The next lever is therefore neither demand-side
(the gap is solved) nor labor-quantity (the throttle is dead) but the **gate weighting / curator
re-seed** — e.g. a promotion-gate floor that does not collapse to zero at low empShare, or
decoupling comfortable maintenance from empShare without the $18 wage the pool-drift guard rejects
— measured at the SHIPPED trigger with the signal-neutral revisit held on. Attempt #6 sweeps the
composition dynamics, not the demand timing or the hiring cash buffer.

**Judgment — nothing shipped; the dark foundations grow by two.** No shipped code path changed:
`restockRevisitSyntheticSignal` and `crowdWageBufferDays` join `restockRevisit`,
`immigrationEmpFloor`, `founderCrowdWage`, and `catchupSyntheticSignal`/`catchupBaskets` in
`SIZE_PRESETS` at their inert defaults, with `castParity5.test.ts` pinning their byte-inertness and
their determinism/conservation when engaged. The pass added the two knobs, the probe axes, the
tests, and this verdict. An honest NO-SHIP with a full grid, per the standing rule, is a complete
result.

> **Pruned (hygiene pass, atop `2e8fb1b`).** Finding 3's refutation is now acted on:
> `crowdWageBufferDays` was removed as a preset knob — **measured dead** at the shipped $16 wage
> (byte-identical across CWBD 1‑20; the buffer never binds). The crowd-hiring throttle itself stays
> live in `CohortLaborSystem` as the historical constant `CROWD_WAGE_BUFFER_DAYS = 7` (the value
> every pin was measured against); only the never-diverging preset axis went, along with its
> `castParity5.test.ts` guards and the `cast-joint.ts` `CWBD` probe axis. `restockRevisitSyntheticSignal`
> STAYS — Finding 1 named it the cleanest gap lever the roadmap has produced, and its guards remain
> in `castParity5.test.ts`. This verdict and its grid stay as the measurement of record.

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
