# Real-estate firms — Arc D2 design (HD4)

## The hole this fills

Arc D1 built the archetype dispatcher and left three inert rows for the
specialists. D2 makes the first one real: **the landlord** — a firm whose whole
business is developing and renting housing, not a retailer that builds an
apartment on the side. The physical seed already existed (`maybeBuildApartment`
in `ai/expansion.ts`, an operator's side venture) and the rent-collection
pipeline already existed (`RentSystem` for cast tenants, `CrowdRentSystem` for
the crowd). D2 lifts a landlord-shaped development loop out of that seam, gives
the archetype a founder signal (housing runs chronically tight → a rentals firm
moves to town), and adds the missing half of a real property market:
**commercial leasing** — an operator can rent its premises from a property firm
instead of buying the building.

## What ships

1. **`ai/LandlordBehavior.ts` — the landlord loop.** Called by the dispatcher
   for `archetype === 'landlord'` firms. Solvency first (sell the weakest block
   through the B3 machinery under distress), then develop (build another block
   near the residential band when housing is tight and it can afford to). Its
   blocks join the existing rent pipeline unchanged: cast residents pay
   `APARTMENT_RENT_PER_DAY` (RentSystem), the block's spare capacity houses crowd
   renters paying `CROWD_RENT_PER_DAY` (CrowdRentSystem). **Operators keep
   calling the original `maybeBuildApartment` verbatim** — the seam was copied
   into a landlord-shaped sibling, not moved, so the pinned operator baselines
   don't budge.
2. **Commercial leasing — data model + billing + player build-flow choice.**
   Facilities gain optional `landlordFirmId` / `rentPerDay`. A firm may LEASE a
   premises through the build flow (`BUILD_FACILITY { leaseFrom }`): the landlord
   fronts the build cost and carries the asset, the operator pays `$X/day`
   instead of `$Y` upfront and runs its business there. `CommercialRentSystem`
   bills it daily, operator → landlord, `rentExpense` → `revenue` — the cash
   circulates firm-to-firm, conserved to the cent.
3. **The landlord founder row.** `AIFounderSystem` grows a table row: when town
   housing occupancy stays above 92% for a sustained streak, a real-estate firm
   founds and breaks ground on its first block.

## Decisions

- **Preset-gated behind `realEstateEnabled` (default false).** The Village
  bit-identity baseline is absolute, and the *plain* city/metropolis founder and
  tier baselines are pinned to their exact rng trajectories. A landlord firm
  entering the town changes firm balances, and the operators' several
  cash-threshold `rng.chance` short-circuits mean a changed balance reshuffles
  the shared stream. So the flag keeps the whole archetype **inert** in every
  pinned run — Village always, and plain city/metropolis with the flag off — and
  a City *game* (`useGameStore` turns it on), the probe, and the tests opt in.
  This is exactly the `servicesEnabled` house rule (see b2b-services.md),
  applied one level up because city has baselines too. **Verified bit-identical:
  Village seed 1/777 300-day rngState = 3593176944 / 3403302807 and
  $3,154,000.00; plain City seed 11 = 2546912297 and $3,169,000.00 — unchanged
  to the byte with all of D2 in the tree.** The metropolis founder-pin test
  (`founders.test.ts`, flag off) asserts every AI firm carries a full
  producer→factory→store chain — a landlord (no store) would fail it, which is
  the sharpest proof the flag must gate founding.

- **Zero shared-rng draws.** LandlordBehavior's cadence is a salted-hash gate
  keyed `(seed, day, firmId)` — the FireSaleSystem independent-stream idiom — and
  the founder row draws nothing (pure occupancy read, like the rest of
  AIFounderSystem). Even a hand-placed landlord can't perturb a trajectory.

- **The landlord loop never touches `strategy.lossStreak`.** That's an operator
  concept; leaving it alone lets the D1 archetype-routing test keep proving a
  landlord never ran the operator loop.

- **Commercial lease: the operator OPERATES, the landlord CARRIES the asset.**
  The engine keys operation off `ownerFirmId`, so a leased premises is owned (=
  operated) by the tenant — its retail/production revenue is the tenant's. The
  landlord's return is the rent stream; it fronted the build capital (its cash →
  world `buildSpend` at lease time) and its book value for the yield read is the
  premises' build cost. A leased premises is **unsellable by the tenant** (no
  refund — it isn't theirs), enforced in `Demolition.sellRefund`.

- **Self-lease is blocked in two places.** The build command rejects
  `leaseFrom === firmId` (a firm paying itself rent is money to nowhere), and
  `CommercialRentSystem` skips any facility whose `landlordFirmId` equals its
  `ownerFirmId` as defense in depth.

- **Landlords share the founder cap but are sub-capped.** A landlord is an AI
  firm and counts against `founderMaxAiFirms`, but real-estate firms are held to
  ~1/6 of the cap (City 3, Metropolis 5) so a chronic squeeze grows a rentals
  sector without starving the staple operators that feed the town. The
  founder-scale probe measured metro seed 7 stacking 8 landlords (27% of a
  30-cap map) before this brake.

- **AI leasing (operator lease-vs-buy) — SHIPPED (D2 follow-up).** An expanding
  AI operator now leases its new outlet from a landlord instead of buying when
  cash is tight (below 2× the build cost) and a landlord with spare financing
  capacity offers (`maybeExpand` in `ai/expansion.ts`; the lessor lookup is a
  deterministic sorted read, no rng). **Inert in every pinned run by the same
  chain the whole archetype rides — NOT a second flag.** `realEstateEnabled`
  gates landlords entirely: flag off, the founder row never seats a landlord and
  none is hand-placed, so `findLandlordLessor` returns null, the lease branch is
  skipped, and the buy path runs byte-for-byte. **Verified: plain City seed 11
  300-day rngState = 2546912297 and $3,169,000.00, and the whole flag-off
  City/Metropolis grid (seeds 11/4/7) is unchanged to the byte with all of this
  follow-up in the tree.** The store/outlet path is additionally shortage-gated,
  and the AIFounderSystem backfills undersupply before an operator's shortage
  gate ever trips, so `maybeExpand` is organically dormant in the founder-driven
  City/Metropolis presets — flag-ON City/Metro 300-day organic leases = 0
  (measured), which is why the flag-on metropolis founder pins (24-30 firms, 0
  insolvent) in `probes/real-estate.ts` still hold unchanged. The lease-vs-buy
  rule and the repossession rung are measured by driving the shortage the store
  path targets
  (`probes/ai-lease.ts`: City seeds 11/4/7 → 2 leases each, landlord stays
  healthy at ~$56k, repossession returns the asset, money conserved to the cent;
  flag off → 0 landlords, 0 leases) and pinned by `realEstate.test.ts`.

- **Repossession rung — SHIPPED, and the stranded-asset hole is CLOSED.** The D2
  review flagged that a leased facility is owned-on-book by the tenant while the
  landlord fronted the build capital, so a tenant insolvency stranded the asset.
  The fix lands in `BankruptcySystem`: when the facility the insolvency ladder
  would CLOSE is a leased premises (`landlordFirmId` set), it REVERTS to the
  landlord instead of shuttering — ownership transfers on-book, the crew is
  released, the tenant's supply lines into it are dropped, the lease fields are
  cleared, and **NO money moves** (the tenant loses premises it never paid for;
  the landlord recovers its asset). It is the single insolvency close-point, so
  the player receivership path and the AI path are covered by the same rung.
  Deterministic and conserved; inert in every pinned run (flag off, no premises
  is ever leased, so `landlordFirmId` is never set and the rung never fires).
  Because a tenant insolvency now RETURNS the asset, the landlord's downside on
  financing a lease is **bounded**, which is why `landlordCanFinance` fronts
  capital down to the landlord's DISTRESS floor (`LANDLORD_DISTRESS_CASH`, the
  line at which it would start selling blocks) rather than its full development
  keep-buffer: a leased premises is a recoverable, yield-bearing asset, not a
  capital sink like an apartment it commits to operate.

## The founder signal — measured and pinned

The landlord enters where housing is chronically tight. `townHousingOccupancy`
is filled ÷ total home slots across every `home` facility (a regular home holds
2; an apartment holds `APARTMENT_CAPACITY` = cast residents + crowd tenants).

| constant | value | pinning |
| --- | --- | --- |
| `LANDLORD_OCCUPANCY_BAR` | 0.92 | a growing crowd city runs its home stock this full; below it there is slack the market absorbs without new development |
| `LANDLORD_FOUNDER_DAYS` (N) | 15 | measured: at 15 a landlord founds on tight-housing seeds (first entry day 56-67, right after `FOUNDER_EARLIEST_DAY`) and abstains on slack ones (metro seed 4, occupancy 87.5% never sustained tight → 0 landlords) — the signal discriminates a chronic squeeze from a transient full week |
| `LANDLORD_FOUNDER_COOLDOWN` | 25 | town-wide, so a sustained squeeze grows the stock a firm at a time |
| landlord sub-cap | ⌊cap/6⌋ | City 3 / Metro 5 — bounds the rentals sector under the shared founder cap |
| `COMMERCIAL_TARGET_YIELD` | 0.15 | the commercial-lease ask = 15% annualized on premises book value — squarely in the 12-18% band |
| AI lease-vs-buy bar | cash < 2× build cost | the operator leases its new outlet (rather than buying) when a landlord offers and cash below this bar makes leasing preserve runway; the task's literal rule, on the store/outlet path |
| landlord finance floor | `LANDLORD_DISTRESS_CASH` ($12k) | a landlord fronts a lease down to its distress floor, not its full $30k development keep-buffer — the downside is bounded by repossession, so a lease is a recoverable asset play, not a capital sink |

## Probe verdicts

`docs/design/probes/real-estate.ts` — 300-day, seeds 11/4/7, real-estate ON.

**City (day 300):**

| seed | AI firms / landlords | insolvent | housing occ. | conserved |
| --- | --- | --- | --- | --- |
| 11 | 12 / 3 | 0 | 99.7% (tight 24d) | exact |
| 4 | 13 / 3 | 0 | 69.9% (landlords relieved the squeeze) | exact |
| 7 | 14 / 3 | 0 | 98.3% (tight 183d) | exact |

**Metropolis (day 300) — founder pins, flag OFF (pinned baseline) vs ON:**

| seed | flag OFF (ai / ops / insolv.) | flag ON (ai / ops / landlords / insolv.) |
| --- | --- | --- |
| 11 | 29 / 29 / 0 | 28 / 24 / 4 / 0 |
| 4 | 27 / 27 / 0 | 27 / 27 / 0 / 0 |
| 7 | 29 / 29 / 0 | 30 / 25 / 5 / 0 |

The pinned metropolis founder pins (**24-30 firms, 0 insolvent**) are **unchanged
with the flag off (bit-identical rng trajectory) and STILL HOLD with the flag on**
— landlords displace a few operators under the shared cap but the field stays in
band and fully solvent. Conservation exact on every seed, both flag states.

**Occupancy responds.** Seeds that run chronically tight found landlords (city
11/7, metro 11/7); seeds that don't (metro 4, 87.5% never sustained) found none;
and where landlords build enough new stock the squeeze eases (city seed 4 falls
from tight to 69.9%) — the intended negative feedback.

**Landlords are solvent — 0 insolvent, every seed, both presets.**

**Rent yield — measured honestly, in two lines.**
- *Commercial leases* yield **15% by construction** (the `commercialLeaseAsk`
  formula), inside the task's 12-18% band — this is the yield a landlord
  actually *sets*.
- *Residential apartments* yield **~530-940% on book value** — far above the
  band, because a ~$6-7k apartment collects `CROWD_RENT_PER_DAY` × ~50 crowd
  tenants ≈ $150/day. This is **inherent to the pinned pre-D2 A3 apartment
  economics** (`APARTMENT_CAPACITY` = 50 × $3/day against a facility that builds
  for ~$7k — operators build the same block in the flag-off city baseline), not
  a D2 knob, and it is why landlords are reliably solvent. The macro economy is
  unchanged: the crowd pays the same rent whether it lands in a landlord-owned
  block or the world's informal-housing account, so the A3 pool-drift sink is
  untouched. The consequence is that the distress path (sell a block under
  cash strain) is **unit-tested directly** rather than soak-exercised — a
  money-printing landlord rarely goes distressed on its own.

## Tests

`src/sim/tests/realEstate.test.ts` (15): landlord dispatch routing (never runs
the operator loop); the player leasing premises instead of buying + one day of
rent billed conserved with `rentExpense`/`revenue` booked; the self-lease block
at both the command and billing layers; the commercial ask hitting the 12-18%
band; a distressed landlord selling its weakest block via B3, conserved; the
founder gate firing under a chronic squeeze (flag on) and NEVER firing with the
flag off (the streak counter doesn't even accrue); and the occupancy read.

The D2 follow-up adds seven: the **repossession rung** on both paths — an AI
tenant and a player tenant driven insolvent each hand their leased premises back
to the landlord (facility on the landlord's book, lease cleared, crew released,
NO money moved, conserved to the cent); the **AI operator lease-vs-buy** firing
flag-on under a constructed shortage (a cash-tight operator leases its outlet,
$0 upfront, landlord fronts it, conserved), BUYING when no landlord offers, and
NEVER leasing flag-off (no landlord is ever seated, so no premises is leased —
the inertness chain, asserted over a 150-day sim); leasing keeping the landlord
solvent across repeated leases with money conserved per call; and
`landlordCanFinance` gating on runway above the distress floor and refusing an
insolvent landlord.

`docs/design/probes/ai-lease.ts` — the mechanism probe (why it constructs the
shortage rather than soaking a standard preset is documented in its header): City
seeds 11/4/7 flag-on measure 2 leases each, landlord healthy at ~$56k, a
repossession returning the asset, money conserved; flag-off, 0 landlords and 0
leased premises (chain inert).
