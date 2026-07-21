# B2B services channel — Arc C2 design (HD3)

## The hole this fills

Every firm-to-firm cost in EconSim today either buys a physical good
(wholesale / imports, which circulate) or leaks straight to the world
account (maintenance, rent-to-world, R&D, marketing, variable cost). There
was **no recurring firm-to-firm *service* expense** — no money a firm pays
another firm, month after month, for something that isn't a shippable unit.
That is the missing half of a real B2B economy: the services layer where
one firm's cost is another firm's revenue and the cash keeps recirculating
instead of draining out.

Arc C2 builds that channel end-to-end with **one** service — datacenter
compute — authored so a second (logistics-as-a-service, managed ads, …) is
a data entry plus a facility def, not an engine change.

## Shape

- **`ServiceContract`** (entities/ServiceContract.ts) — a standing
  subscription between two *different* firms: provider, subscriber,
  `serviceId`, `seats`, `pricePerSeatDay`. Stored in
  `state.serviceContracts` (additive field; old/Village saves load with
  `{}`), sorted-key iteration everywhere. Deliberately **not** the logistics
  `Contract` (which moves goods between facilities of one firm).
- **Datacenter** (facility type `datacenter`) — sells
  `DATACENTER_SEATS_PER_LEVEL (40) × level` compute seats. No physical
  inventory, no recipe. Buildable by player + AI, **city-scale only**: it is
  absent from the Village build menu (`buildableDefs()` appends it only for
  non-Village + services on), the `BUILD_FACILITY` handler rejects it in
  Village, and no founder path builds it.
- **Seat demand** — a firm wants `ceil(employees / 4) + facilityCount`
  seats. Coverage pays PROPORTIONALLY: the boost is
  `1 + (SERVICE_BOOST_MULT − 1) × min(1, held/demand)` via the same
  `efficiency` multiplier chain as facility upgrades / seasons / world
  events (ProductionSystem), so full coverage grants exactly
  `× SERVICE_BOOST_MULT` and a truncated allocation (an oversubscribed
  provider clamps to remaining capacity) grants the matching fraction —
  every billed seat maps to a benefit. Review finding that forced this:
  all-or-nothing coverage let a truncated subscriber pay daily for seats
  conferring nothing, forever, because the seat-scale-invariant ROI gates
  never fired; both gates now price the firm's full demand for the same
  reason.
- **`ServiceBillingSystem`** (daily, in SYSTEMS order **between Rent and
  Accounting**, so its seat bill lands in the same `today` accumulators the
  Accounting snapshot then closes). Every step is a deterministic read —
  sorted iteration, **no rng** — so the shared stream is never perturbed.
  Each day it: prunes dead contracts → walks each provider's listed price by
  utilization → runs AI cancel/resize/subscribe → bills one
  `recordTransaction` per contract → stamps each firm's `serviceBoost`.
- **Money movement** — one `recordTransaction` per contract, subscriber →
  provider, new ledger category **`serviceExpense`** with
  `counterparty: {provider, 'revenue'}`. The money **circulates
  firm-to-firm**; nothing leaks to the world account. Conserved to the cent.

## Decisions

- **Preset-gated behind `servicesEnabled` (default false), not on for every
  city.** The Village bit-identity baseline is absolute, but the *plain*
  city/metropolis founder + soak baselines are also pinned to their exact rng
  trajectories, and the AI strategy loop short-circuits several `rng.chance`
  draws on cash thresholds — so a firm-to-firm cash flow that changes balances
  would reshuffle those trajectories and bounce the founder tests. The flag
  keeps the channel **inert** in every pinned run (Village always, and plain
  city/metropolis with the flag off) and lets a City *game* (`useGameStore`
  turns it on) and the probes/tests opt in. This is the house rule —
  "preset-gate it" — applied one level up because city has baselines too.
- **Provider prices by utilization walk** (the wholesale-walk idiom): listed
  price starts at $2.00/seat/day, creeps +3% when >85% subscribed, eases −3%
  when <50%, bounded [$0.50, $6.00]. Contracts reprice to the listed price
  daily, so the walk is live for everyone, not just fresh signings.
- **AI subscribe/cancel with hysteresis.** Subscribe when the weekly value of
  the boost (`gross7d × (boost − 1)`) exceeds the weekly seat bill by
  `SERVICE_SUBSCRIBE_RATIO` (1.3×); count a failing day when that value drops
  under the bill; cancel after `SERVICE_CANCEL_DAYS` (5) running failures. The
  gap between the 1.3× buy line and the 1.0× fail line plus the 5-day delay is
  the band that stops a firm at break-even from subscribing and cancelling day
  after day (measured churn ≤0.083/day — see verdicts).
- **A seeded provider** ("Cirrus Compute", a pure-service AI firm with one
  datacenter) stands up the market on day one so subscribers have something to
  buy. Kept separate from the chain firms so it never trips the founder
  invariant that every *chain* firm carries a full producer→factory→store.
  AI firms can also **build** datacenters when very flush and town-wide
  utilization is tight (`maybeBuildDatacenter`, deterministic, city+flag only).
- **The boost is on `efficiency`, and the one-batch-per-tick cap means it
  helps throughput-bound facilities, not ones already saturated with labor.**
  That is the same regime in which a facility upgrade's "+15% speed" helps, and
  it reads as economically honest: compute accelerates you when you are
  throughput-limited, not when you are already maxing a single batch per tick.

## Constants (each pinned by the probe)

| constant | value | pinning |
| --- | --- | --- |
| `DATACENTER_SEATS_PER_LEVEL` | 40 | one L1 datacenter serves ~5 chain firms (5 seats each) |
| `SERVICE_BOOST_MULT` | 1.06 | adoption 25-38% of eligible AI at this value; subscribers out-produce non-subscribers 8.7-30.4%/fac; small enough that a lapse is a setback, not fatal |
| `SERVICE_BASE_PRICE_PER_SEAT_DAY` | $2.00 | a typical subscriber's weekly seat bill sits well under the weekly value of a 6% lift, leaving the ROI gate a real margin |
| `SERVICE_PRICE_MIN / MAX` | $0.50 / $6.00 | walk band |
| `SERVICE_PRICE_STEP` | 3%/day | the wholesale-walk cadence |
| `SERVICE_SUBSCRIBE_RATIO` | 1.3× | buy threshold (top of the hysteresis band) |
| `SERVICE_CANCEL_DAYS` | 5 | failing-ROI days before cancel (bottom of the band) |

## Probe verdicts

`docs/design/probes/b2b-services.ts` — 300-day City preset, services ON,
seeds 11 / 4 / 7. Day-300 readings:

| metric | seed 11 | seed 4 | seed 7 |
| --- | --- | --- | --- |
| contracts / seats covered | 5 / 40 | 4 / 40 | 3 / 40 |
| provider lifetime revenue | $35,246 | $68,606 | $71,295 |
| provider cash / insolvent | $14,276 / 0 | $22,965 / 0 | $33,099 / 0 |
| AI adoption | 38% | 36% | 25% |
| sub vs non output / producing fac | 41.1 vs 36.9 (**+11.4%**) | 36.4 vs 33.5 (**+8.7%**) | 39.2 vs 30.1 (**+30.4%**) |
| subscribe/cancel churn per day | 0.083 | 0.080 | 0.067 |
| ms/tick @ day 300 (window) | 0.29 | 0.43 | 0.38 |
| money conserved to the cent | yes | yes | yes |

Reading: the seeded provider is **solvent every seed** and fully subscribed
(40/40 seats, with demand exceeding supply — a healthy tight market);
**subscribers measurably out-produce non-subscribers** on every seed; churn
is well under 0.1 switches/day so the **hysteresis holds** (no flapping); and
**money is conserved to the cent** with the channel actively circulating cash
firm-to-firm. Perf is far under the arc's 0.6 ms/tick budget.

## Tests

`src/sim/tests/b2bServices.test.ts` (12): datacenter seeding + Village/flag
gates; the datacenter build rejection in Village / acceptance in city; the AI
build-under-tight-demand path; billing conservation over 120 days and the
single-day debit=credit invariant; the coverage boost measurably lifting a
throughput-bound facility's output; subscribe + cancel gates and the
no-flapping band; save round-trip of contracts / listed prices / boosts; and
the `ceil(employees/4)+facilities` seat-demand rule.

---

# B2B services — Arc D4 as-built (service archetype + a second service)

## The hole D4 fills

C2 shipped the channel with ONE service (compute) and provisioning glued into
the operator loop (`maybeBuildDatacenter` in `expansion.ts`, run in the
shopkeeper's cadence). Arc D1 promised the archetype frame would eventually own
that seam; D4 delivers it and, in the same stroke, proves the channel is a
CHANNEL — not a compute special case — by standing up a **second, differently-
wired service** (office consulting) on exactly the same C2 machinery. Nothing
about the billing engine "knows" it is billing compute versus advisory.

Two things move: **provisioning becomes an archetype**, and **billing becomes
catalog-driven**.

## The `service` archetype (the provider loop)

`ai/ServiceBehavior.ts` fills the D1 dispatcher's `service` row. A service firm's
whole business is selling seats, so its daily loop is a PROVIDER loop, not a
shopkeeper's. It reads no `rng` — every gate is a cash / utilization / count
condition — so it never perturbs the shared stream, and it only ever runs on a
firm whose `archetype === 'service'`, which no services-off baseline founds.

- **Enter** a service the firm doesn't yet provide when the town's utilization
  for it is tight (≥ `SERVICE_ENTRY_TIGHT_UTIL` = 0.9) and the market isn't
  already crowded (< `SERVICE_ENTRY_MAX_PROVIDERS` = 4). This is the lifted C2
  datacenter-entry gate, generalized across the catalog. A town with *zero*
  capacity for a service reads as maximally tight (util treated as 1), which is
  why the seeded compute provider (Cirrus) **opens an office on day one** the
  moment consulting exists with no provider — the cleanest possible proof the
  entry path is service-agnostic.
- **Expand** a service it already provides once its OWN seats have run full
  (own-util ≥ `SERVICE_EXPAND_UTIL` = 0.85) for `SERVICE_EXPAND_DAYS` = 12
  consecutive days: prefer a level upgrade (cheaper per seat), else add a second
  site.
- **Hold a cash buffer** sized to maintenance — `SERVICE_BUFFER_DAYS` = 120 days
  of its facilities' operating cost (floored at $8,000) — before ANY capital
  spend, so a subscription lull can't bankrupt it. The probe pins every founded
  provider solvent at day 300.

At most one capital action per firm per day (expand a provided service, else
enter a tight one), walked in catalog id order, so the market grows steadily
rather than in bursts. **Operators are untouched:** they keep their C2
subscribe-side behavior (in `ServiceBillingSystem`) and never enter the compute
market — `maybeBuildDatacenter` is gone from the operator path entirely.

## The second service — CONSULTING (a distinct, margin-side benefit)

Consultants sell advisory seats from an **office** (a new city-scale facility
type, cheaper and lighter than a datacenter — a bit like a small retail build).
A covered firm gets a benefit **deliberately distinct from the compute boost**:
advisory coverage makes its advertising build brand faster per ad dollar — the
"reduced ad spend for the same brand effect" wire. It multiplies
MarketingSystem's ad→brand gain by `advisoryBoost` and touches **nothing in
production**. This was chosen because it drops into an *existing daily
multiplier* (the `AD_BRAND_GAIN_PER_DOLLAR` conversion in one line of
`MarketingSystem`) with a one-symbol edit and a clean valuation: the ROI gate
values consulting off trailing **ad spend** (the extra brand the same budget now
buys), exactly as compute is valued off trailing **gross revenue** (the extra
output the same throughput now runs). Same idiom, different base — which is the
whole point of D4.

`CONSULTING_BRAND_MULT` is pinned one notch above the compute boost (1.10 vs
1.06) because ad budgets are far smaller than gross revenue, so a thinner lift
would never clear even the cheaper advisory seat bill.

## Catalog-driven billing (the C2 → D4 refactor)

`data/services.ts` became a **2-entry catalog** (`compute`, `consulting`), each
entry carrying its facility type/def, seats-per-level, price-walk band, ROI
hysteresis, and which daily multiplier its coverage feeds (`production` →
`serviceBoost`, `brand` → `advisoryBoost`). `ServiceBillingSystem` was refactored
from compute-specific to catalog-driven: it walks `SERVICE_IDS` (sorted:
`compute` < `consulting`) and, per service, prunes → price-walks → runs
cancel/resize/subscribe. Then **once across all services** it bills and stamps
boosts. Billing order is deterministic: **(service id, then contract id)** — the
key guarantee that a second service can't reshuffle the first's ledger. The old
compute-named exports (`computeCapacity`, `listedComputePrice`,
`computeSeatDemand`) survive as thin wrappers so the C2 probe, the player
subscribe path, and existing tests didn't move.

Coverage stays **proportional** (a truncated allocation grants the matching
fraction of the lift) and per-service: compute coverage never moves brand,
consulting coverage never moves production. A `service` archetype firm is a
provider, not a consumer — it is skipped in the subscribe pass, so providers
don't churn against each other.

## The founder row (a service provider moves in)

`AIFounderSystem` grew a `service` row (appended after the operator row in
`FOUNDER_ARCHETYPES`). Its signal is **aggregate uncovered seat demand** (every
consumer's desired seats minus every provider's capacity) staying above
`SERVICE_FOUNDER_SEAT_BAR` = 15 for `SERVICE_FOUNDER_DAYS` = 20 consecutive days,
rate-limited town-wide by `SERVICE_FOUNDER_COOLDOWN` = 25 days and braked by the
same >12%-of-field-distressed solvency guard the operator under-supply row uses.
It founds the most under-provisioned service (streak length, tie-broken by the
fixed `SERVICE_IDS` order), stands up a pure-margin (unstaffed, like Cirrus)
provider with founding capital from the world account, and builds its first
facility through the same `foundServiceFacility` path the daily loop uses.

**This row is doubly gated on `servicesEnabled` AND non-Village**, and
`servicesEnabled` defaults **off** for plain presets — so the pinned Village /
plain-city / metropolis soak baselines **cannot reach it**. `serviceTrackSignals`
returns before touching `state.serviceUncoveredDays` when the flag is off, so the
counter map is never even created, and `serviceTryFound` returns `false`
immediately — the founder system's rng trajectory (it draws zero from the shared
stream anyway) and every pinned baseline are byte-identical to pre-D4. Proven the
same way D2's landlord inertness is: the plain-city inertness test asserts no
office/datacenter facility appears, `serviceUncoveredDays` stays `{}`,
`lastServiceEntryDay` stays 0, and no firm is ever a `service` archetype over a
120-day run.

## Constants added (Arc D4, each pinned by the D4 probe)

| constant | value | pinning |
| --- | --- | --- |
| `OFFICE_SEATS_PER_LEVEL` | 24 | one L1 office serves ~5 chain firms' advisory needs; fewer seats than a datacenter — the office is the cheaper, lighter facility |
| `CONSULTING_BRAND_MULT` | 1.10 | full advisory coverage multiplies ad→brand conversion ×1.10; a clear minority of advertisers adopt (17-30% by day 300), providers stay solvent, one notch above compute because ad budgets are smaller than gross |
| `CONSULTING_BASE_PRICE_PER_SEAT_DAY` | $1.20 | cheaper than compute's $2.00 — the seat bill must sit under the ad-dollar value of a 10% brand lift on a (smaller) ad budget |
| `CONSULTING_PRICE_MIN / MAX` | $0.40 / $3.50 | the consulting walk band (same ±3%/day, 85%/50% thresholds as compute) |
| `SERVICE_BUFFER_DAYS` | 120 | maintenance runway a provider keeps after any capital spend — carries it through a subscription lull; every founded provider pins solvent |
| `SERVICE_ENTRY_TIGHT_UTIL` / `SERVICE_ENTRY_MAX_PROVIDERS` | 0.9 / 4 | the archetype's entry gate (town util tight, market not crowded) |
| `SERVICE_EXPAND_UTIL` / `SERVICE_EXPAND_DAYS` | 0.85 / 12 | own-capacity full persistence before expanding |
| `SERVICE_FOUNDER_SEAT_BAR` / `_DAYS` / `_COOLDOWN` | 15 / 20 / 25 | the founder row's uncovered-demand signal, persistence, and town-wide pace |

## D4 probe verdicts

`docs/design/probes/b2b-services-d4.ts` — 300-day City preset, services ON,
seeds 11 / 4 / 7. Day-300 readings (per service: contracts / seats covered /
providers / provider lifetime revenue / provider cash / insolvent):

| metric | seed 11 | seed 4 | seed 7 |
| --- | --- | --- | --- |
| compute: contracts / seats / providers | 9 / 64 / 2 | 6 / 58 / 1 | 11 / 66 / 1 |
| compute: provider rev / cash / insolvent | $7,860 / $20,637 / 0 | $12,348 / $92 / 0 | $11,152 / $5 / 0 |
| compute adoption | 47% | 46% | 46% |
| **consulting: contracts / seats / providers** | **2 / 16 / 1** | **3 / 25 / 1** | **4 / 24 / 3** |
| **consulting: provider rev / cash / insolvent** | **$7,900 / $1,918 / 0** | **$12,348 / $92 / 0** | **$11,788 / $21,138 / 0** |
| **consulting adoption** | **17%** | **30%** | **24%** |
| first consulting provider / contract (day) | 1 / 61 | 1 / 56 | 1 / 64 |
| service-archetype firms at day 300 | 3 | 1 | 3 |
| cross-service billing bleed | 0 | 0 | 0 |
| compute churn / consulting churn (per day) | 0.073 / 0.040 | 0.027 / 0.023 | 0.060 / 0.033 |
| consulting benefit: subscriber vs non-sub avg brand | 67.3 vs 23.4 | 57.0 vs 27.3 | 48.5 vs 17.4 |
| ms/tick @ day 300 (window) | 0.37 | 0.30 | 0.26 |
| money conserved to the cent | yes | yes | yes |

Reading: **both services are adopted every seed** — compute at ~46-47% and
consulting at 17-30% of eligible AI, the second service riding the identical C2
machinery. Providers are **solvent on every seed** (0 insolvent), the seeded
Cirrus diversifies into an office on day 1 (proving the entry path is generic),
and on seed 7 the founder row stands up two *additional* consulting providers.
**No cross-service billing bleed** (every contract's provider runs the matching
facility), per-service **churn stays well under 0.1/day** so each service's
hysteresis holds independently, and **money is conserved to the cent**.

On the consulting benefit: the *mechanical* lift is a clean ×1.10 on ad→brand
conversion — pinned to exactly `CONSULTING_BRAND_MULT` by a unit test (from
brand 0, identical budgets, the covered firm's gain is `boost×` the uncovered
firm's). The much larger *aggregate* brand gap in the table (subscribers carry
2-3× the brand of non-subscribers) is mostly **selection**, not the multiplier:
the firms that clear the ROI gate and subscribe are the heavier advertisers to
begin with. The honest claim is the per-dollar mechanical one; the aggregate gap
just confirms the benefit lands on the firms that value it. Perf stays under the
arc's 0.6 ms/tick window budget on every seed.

## Tests (Arc D4 additions)

`src/sim/tests/b2bServices.test.ts` grew from 12 to 21. New: the plain-city
inertness test now also pins no office facility, an untouched
`serviceUncoveredDays` map, and no `service`-archetype firm (the founder-row
inertness proof); the service archetype builds a datacenter under tight demand
while an operator never does; **the seeded provider diversifies into an office
and consulting contracts form with no cross-service bleed**; **advisory coverage
lifts ad→brand conversion by exactly `CONSULTING_BRAND_MULT`** while compute
coverage leaves brand untouched and consulting coverage leaves production
untouched (cross-benefit isolation); **generic billing iterates in
(serviceId, contractId) order across both services**; the service founder signal
accrues only under city-scale + servicesEnabled and founds an extra provider over
a full run; and a **two-service save round-trip** brings back both compute and
consulting contracts, both listed prices, and both per-firm boosts. Dispatch
routing (a `service` firm runs `ServiceBehavior`, not the operator loop) is
covered in `firmArchetypes.test.ts`.
