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
