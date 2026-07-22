# Changelog

## World-scale roadmap (shipped — see docs/design/ for the plan)

The current arc rebuilds the engine for real-world scale: population in the
thousands via statistical cohorts plus a fully-simulated cast, districts,
25-30 firms, a broad product catalog, and specialist firm archetypes
(real estate, investing, business services).

The work runs in four arcs, and the fragments below are told newest-first
within the section — so this navigation map reads the opposite way, oldest
foundation first: **A — the engine** (data-driven demand, districts + dark
cohorts, the live crowd economy, and the founder scaling that fills a
Metropolis); **B — investing** (fair takeovers and the minority-stake control
ladder); **C — breadth** (a wider consumer catalog, the B2B services channel,
deep 3-stage chains); **D — the specialists** (the firm-archetype framework,
then the landlord, holdco, and service-provider archetypes that ride it). A
real City or Metropolis game switches the whole stack on together (crowd +
districts + all three specialist channels); Village stays the classic,
bit-identical, every-resident-simulated town.

- **A — cast-parity attempt #3: the restocked-shelf revisit (measured, NOT
  shipped, dark foundation).** Built the forward path the prior cast-parity
  verdict named — a cast-SHOPPING model change, not another demand constant: when
  a City cast **worker**'s urgent need stocks out at an *open* store, that (store,
  product) is queued, and if logistics restocks it the **same day** the worker
  gets **one** extra purchase attempt through the SAME `RetailDemandSystem` path
  ("swung by on the way home"). Flag-gated `SIZE_PRESETS.restockRevisit` (false
  every preset; a new per-tick `runRestockRevisitSystem` and an optional
  never-populated `Citizen.pendingRevisits`), so flag-off is **byte-identical** —
  village seeds 11/4/7 and city seed 11 pins hold, and a Village stays
  bit-identical even with the flag FORCED true (double-gated on crowd presence).
  The 300-day × 3-seed grid (`docs/design/probes/cast-revisit.ts`): the mechanism
  engages exactly as designed (cast worker sat **+2 to +3.6**, cast bread urgency
  and emigration ease) but re-triggers the documented **immigration flood** —
  seed-11 crowd empShare craters 0.36→0.25, collapsing the comfortable band
  (0.365→**0.291**) and blowing the committed worker gap-daily guard (5.84→
  **10.52**); seed 4 fails gap-daily (7.02→**9.22**); only seed 7 seats. Money
  conserves to the cent on every cell. **No band widened, nothing re-pinned** —
  the revisit is confirmed the right demand-side half of the fix but insufficient
  alone (it needs the inert `immigrationEmpFloor` gate to land jointly), and lands
  dark-and-inert as the fourth measured cast-parity foundation. Suite +5
  (`castRevisit.test.ts`, now 580); `tsc` clean, full suite green. See
  docs/design/cohorts-and-districts.md, "Cast-parity attempt #3".
- **E step 3 — the Town seam (UI batch, district/cohort reads).** The last
  deferred slice of the district/cohort families lands: the UI's flat reads now
  route through the seam. **7 reader references across 2 files** —
  `PopulationDashboard` (the district roster, the crowd-per-district cohort loop,
  and the `districtAt` building tally) and `TownRenderer.drawAmbientCrowd` (the
  cohort-population scan and the per-district lookup) — read `townOf(state)`
  (home default, since the UI renders the home town; each carries a one-line
  comment noting the town selector it gains at the endgame). A pure read-path
  change: no component, memoization, or prop restructure, and because the
  accessor returns the SAME objects the flat path did, React memo/deps behaviour
  is unchanged. The remaining UI families (citizens, firms, facilities,
  marketStats — ~81 flat reads audited) stay flat for a later UI batch: each
  converts once its family's `Town` getter has landed (citizens and marketStats
  landed in this batch's sim slice; firms and facilities are still to come).
  Verified end to end: the full e2e gauntlet is green (smoke, deepsmoke,
  citysmoke `reachedDay` 66, metrosmoke, fpsguard p95 33.4ms under the 80ms
  bound), `tsc` clean, the full suite green, and the fails-on-revert probe
  (`get cohorts() { return {}; }`) turns pinned cohort tests red. Pinned
  baselines untouched (no sim path changed).
- **E step 3 — the Town seam (third slice, citizens + marketStats).** The `Town`
  view's third and fourth families convert together: every **citizen reader**
  (**70 sites across 28 files**) and every **marketStats reader** (**22 sites
  across 16 files**) in the sim layer now routes through `townOf(...).citizens` /
  `.marketStats`. ctx-scoped systems (`Labor`, `Payroll`, `Satisfaction`, `Tier`,
  `Movement`, `CitizenSchedule`, `Accounting`, `TownStats`, `Rent`, `Immigration`,
  `CastCurator`, `RetailDemand`, `MarketStats`, `CohortDemand`, `EventLog`,
  `OperatorBehavior`, `expansion`) hoist `const town = townOf(ctx.state,
  ctx.townId)` once; bare-`state` helpers, selectors, achievement/mission checks,
  and `Simulation` command handlers call `townOf(state)` (home default) with the
  endgame-param comment where the surrounding converted families carry one. The
  daily `MarketStatsSystem` rebuild was inspected under the writer rule: it
  reads-then-mutates each existing per-product entry in place (same object
  reference), so it routes through the view like any reader — only
  `emptyMarketStat` creation is a writer. Writers stay flat by design: the
  `createCitizen` sinks (`factories`, `startingScenario`), the one removal path
  (`LaborSystem.removeCitizen`'s `delete`), the `marketStats` partition creators,
  and `migrations`. The **money-scope reads** — the account-resolution trio and
  `totalMoneySupply` conservation, now for citizen cash as well as cohort — stay
  flat by design (region-wide; they resolve/iterate ALL towns at the endgame),
  each commented. The harness is shown to guard the conversion: a scratch
  mis-conversion `get citizens() { return {}; }` turns **91 tests red across 52
  files**, and `get marketStats() { return {}; }` turns **266 tests red across 90
  files** (the widest blast radius — the book is read with `!` non-null
  assertions throughout); restoring each returns green. Pinned baselines hold
  exactly: village seeds 11/4/7 reproduce `rngState` 3274842624 / 2896139677 /
  4253583594, city seed 11 its `rngState` 2546912297 and money supply 316900000.
  Suite +1 citizen/marketStats-determinism test in `townSeam.test.ts` (now 581);
  `tsc` clean; no UI touched. Remaining families (firms ~450, facilities ~360,
  map dims, UI reads) follow the same recipe in region.md § step 3.
- **E step 3 — the Town seam (second slice, cohorts).** The `Town` view's second
  family converts: every **cohort reader** in the sim layer now routes through
  `townOf(...).cohorts` — **46 reader references across 9 files** (`CrowdRent`,
  `CohortSocial`, `CohortLabor`, `CohortDemand`, `CastCurator`, `Payroll`,
  `AIFounder`, `RetailDemand` systems + `reportSelectors`). ctx-scoped systems
  hoist `const town = townOf(ctx.state, ctx.townId)` once and read `town.cohorts`;
  bare-`state` helpers mid-gradient call `townOf(state).cohorts` (home default)
  and carry a comment noting the `townId` param they gain at the endgame move.
  Writers stay flat by design (the view is read-only): the two tier-promotion
  CREATION sites (`CohortSocial.moveTier`, `CastCurator.retire`) plus
  `startingScenario` and `migrations`. The **money-scope subtlety** the districts
  family never hit is documented and left flat: the account-resolution primitive
  (`getAccountCash`/`accountExists`/`addAccountCash` under `recordTransaction`)
  and the `totalMoneySupply` conservation sum are **region-wide** reads — money
  moves between towns, so at the endgame they resolve/iterate ALL towns' cohorts,
  and routing them through a single town's view would misrepresent their scope.
  The harness is shown to guard the conversion: a scratch mis-conversion
  (`get cohorts() { return {}; }`) turns **28 tests red across 14 files**;
  restoring returns green. Pinned baselines hold exactly: village seeds 11/4/7
  reproduce `rngState` 3274842624 / 2896139677 / 4253583594, city seed 11 its
  `rngState` 2546912297 and money supply 316900000. Suite +1 cohort-determinism
  test in `townSeam.test.ts` (now 575); `tsc` clean; no UI touched. Remaining
  families (firms ~450, facilities ~360, citizens ~210, marketStats ~35, map
  dims, UI reads) follow the same recipe in region.md § step 3.
- **E step 3 — the Town seam (first slice, spike).** The region's `GameState`
  refactor (`state.firms` → `state.towns[townId].firms`, ~1,300 sites) lands its
  first honest brick: the `Town` as a **view**, not stored state. `core/Town.ts`
  adds `townOf(state, townId)` — getters that return the flat records, so
  `townOf(state,'home').districts === state.districts` (same reference) — plus
  `HOME_TOWN_ID` and a `townId` seam threaded through `SimContext` (defaulted to
  home by `makeContext`). Because the town is **computed, never serialized**, no
  `towns` key enters a save: byte-identical, zero migration, `SAVE_VERSION`
  untouched. The design decision — option **(b) view first, then (c) records
  move** — is written into region.md as the step-3 as-built plan, with the
  conversion recipe the firms/facilities/citizens batches follow. The **districts
  family** is fully converted as the first slice: **14 reader sites across 8
  files** now route through the accessor (writers stay flat by design; the view
  is read-only). Each conversion is provably behaviour-identical (the accessor
  returns the same object), and the harness is shown to guard it — a scratch
  mis-conversion (`get districts() { return {}; }`) turns 8 tests red across 3
  files; restoring returns green. Pinned baselines hold: village seeds 11/4/7
  reproduce `rngState` 3274842624 / 2896139677 / 4253583594, city seed 11 its
  `rngState` and money supply. Suite +7 (`townSeam.test.ts`, now 567); `tsc` and
  `build` clean; no UI touched. Remaining families (cohorts ~50, firms ~450,
  facilities ~360, citizens ~210, marketStats ~35, map dims, UI reads) are
  itemized with the recipe in region.md § step 3.
- **Challenge mode at City scale.** The scored 200-day challenge (final score +
  local leaderboard + share summary) predated the world-scale era and only knew
  the Village. It is now a first-class City experience. The New Game challenge
  toggle already composed with the world picker (a City challenge gets the City
  era flags worldScaleConfig turns on); this pass makes the SCORING and the BOARD
  honest at scale. What mis-scored: the score's town-satisfaction leg read only
  the simulated cast, blind to the crowd cohorts that are most of a City — so a
  thriving City of hundreds scored its satisfaction off ~150 named agents.
  Fixed: `challengeScore` now weights satisfaction over the cast AND the crowd
  (population-weighted, mirroring the cohort migration gate); in a Village the
  crowd is empty so it reduces to the cast mean exactly (bit-identical — the
  Village score is unchanged). The rest of the formula was already honest at
  scale and is documented as such: valuation (600 of 1000 pts) is net-worth-based
  (companyValuation), so City rent, service seats, dividends, and pool-export
  revenue all flow through cash and daily net profit into the score — a City
  income empire scores like an operator. Leaderboards are now keyed SEPARATELY
  per world (a Village 200-day score and a City one are different games): the
  Village board keeps the original `econsim.challenges` key untouched — every
  pre-world-scale score survives with NO migration — and City/Metropolis get
  their own `econsim.challenges.<world>` slots (the named-save-slot idiom).
  Legacy Village entries with no `world` field are stamped `village` on read. The
  share summary and the finish-line/Awards displays name the world scale, and
  Awards renders one board per world. Balance (docs/design/probes/city-challenge.ts,
  the same v7 bot at 200 days, seeds 11/9): the City run lands in a sane band vs
  the Village — Village meadowbrook 124-140, City meadowbrook 216-269, City
  grand_junction 215-224 — higher because the crowd economy grows a bigger, more
  valuable firm ($44-57k net worth vs $18-20k), with no score component pegged
  (valuation 150-216 of 600, well under the $150k cap; exports/share still
  discriminate) and money conserved to the cent. Separate boards make the
  Village-vs-City gap a feature, not an unfairness, so NO display/multiplier tune
  was needed — sim behavior is not a challenge-mode knob. Suite +7 (567 tests).
  The one sim-source change is the pure read-only score selector (not in the tick
  path), so the pinned Village (seed 11 rngState 3274842624) and City trajectories
  are untouched.

- **The City cast-parity mechanism — built, measured across the full grid, NOT
  shipped (docs-only verdict).** The forward path the City-decoupling verdict
  named: give the trip-limited cast the crowd's throughput to close the
  cast-worker gap AND lift City crowd employment so the wage leg can carry the
  comfortable band at a raised founder trigger. Three City-preset-gated
  mechanisms were built as real code, every one INERT at its default so the
  shipped City run and Village stay bit-identical (the full 545-test suite passes
  unchanged): an honest ACCOUNTING SPLIT for the worker catch-up
  (`catchupSyntheticSignal` — parity baskets buy real stock and pay real revenue
  but are excluded from the founder-visible shortage gauge), a prosperity-scaled
  pool sink, and a NEW employment-aware immigration gate (`immigrationEmpFloor` —
  inflow scaled by job availability so capital attracts labor only where there is
  work). Measured jointly across the trigger × wage × sink × basket × gate grid
  on all three seeds (`docs/design/probes/city-decoupling.ts`): the full
  mechanism seats the pinned **seed 11 on every committed guard** (9 firms, worker
  0.64 / comfortable 0.34, gap 3.8, drift $0.14, conserved), but **no cell seats
  all three** — the honest split suppresses the firm count it needs (the catch-up
  unmet had been inflating the founder signal), closing the cast gap re-triggers
  the immigration flood (curable, and cured, by the new gate), and the residual
  cast-worker gap on seeds 4/7 stays supply-capped and bistable (WCB 4→6→8 does
  not close it — the cast is trip-limited, not basket-limited). No guard re-pinned,
  no band widened; the City holds at fill 0.65 / $16 crowd wage / flat rent. The
  ingredients land dark as measured foundations, and the three-layered root cause
  + full grid table are recorded in docs/design/cohorts-and-districts.md ("The
  City cast-parity mechanism"). The next attempt needs a cast-shopping model that
  grants an extra restocked-shelf VISIT, not deeper single-visit baskets — a
  scheduling change, not a demand constant.
- **Grand Junction — the first scenario authored for the world-scale era.** Every
  authored town (Meadowbrook, Port Haven, Mill Country, Boomtown Flats, Dust
  Hollow…) is village-scale; the City era had no scenario showing it off. Grand
  Junction is a City-only start (worldScale-tagged, so the New Game picker offers
  it only when City is chosen and never in the Village flow — the two orthogonal
  pickers snap together): two entrenched giants hold bread and tools, a thin
  boutique keeps clothes barely supplied, and 16 homes peg occupancy so a landlord
  breaks ground ~day 56 — while the datacenter hums from day 0 and a holdco shows
  up for the yields. The plumbing already composed (createInitialState takes
  scenario × config independently; the default Meadowbrook + City IS the pinned
  City baseline), so this is data only — no new systems, no createInitialState
  rework, the worldScaleConfig path untouched. Probed 300d × seeds 11/4/7 against
  the City baseline: 16-18 firms with zero insolvencies, worker band ~.67-.71,
  cast satisfaction 53-58, pool drift 0.3-1.0/cap/day (under the cohortRent
  guard's 2.00 bar), money conserved to the cent — the honest first cut (14 homes
  + a missing staple) pushed drift and satisfaction OUT of the norms and was
  softened to 16 homes + all staples supplied until it held. A scripted 200-day
  operator building into the underserved bread market grows its book +$9-27k with
  every era channel (compute, landlord lease, dividend stake) firing. Suite +9
  (scenario load/run/round-trip/gating + the viability run);
  `docs/design/probes/grand-junction.ts` carries the balance tables.

- **World-scale era missions + achievements — the guided tour of the specialist
  economy.** Every prior era shipped its own mission chain and achievement set
  (coffee/apartments, wholesale, the four pillars); the world-scale era had none,
  so a City player discovered leases, compute, stakes, forwards-at-mark, and pool
  exports only by accident. Now: **five era missions** appended to the chain —
  *Lease, Don't Buy* (open a premises via `leaseFrom`), *Plug In* (subscribe a
  facility-owning firm to compute), *Own a Piece* (buy a rival stake), *Read the
  Ports* (ship a staple into a port whose larder is under the 🔥 thin bar), and
  the *Four Streams* capstone (hold retail + a lease/rent stream + a dividend
  stake + a live compute boost at once) — and **six era achievements**: first
  lease signed, full compute coverage, a forward closed at the mark (any P&L), a
  3-stake portfolio, a landlord's repossession collected, and a thin port fed
  back to target cover. **Gating keeps Village byte-identical:** each mission
  carries an `eligible(state)` predicate reading its channel's config flag (OFF
  at Village preset), and `activeMission` skips an ineligible def — so an era
  mission never becomes active in a Village game and its serialized mission list
  is unchanged; each achievement check gates on the same flag/preset first (the
  `town_lifted`/`mill_country` idiom) and returns false in Village even with the
  condition forced. Four lifetime player-action tallies feed the counter-based
  entries (the `deskTrades` idiom, never read by any sim branch): `forwardsClosed`
  (ForwardSystem `closeForward`), `poolFeedsWhileThin` / `poolCoversRestored`
  (Trade `performExport`, computed from pool cover before/after a player ship),
  and `landlordRepossessions` (BankruptcySystem's repossession rung) — all inert
  flag-off (no pool/lease exists) and none touching the shared rng, so the
  Village seed 11/4/7 rngState pins and every pinned City/Metropolis baseline are
  untouched to the byte. Tests: each era mission completes when its condition is
  met and not before (driven in a City sim through the real command paths — lease,
  subscribe, export, forward close, repossession — the playtestV8 idiom), each
  achievement fires once and is provably inert in Village, and the golden-save +
  determinism suites still pin Village/City serialization bit-for-bit. Suite +14
  (missions +6, achievements +8, now 545).
- **D2 follow-up — the repossession rung + AI operator leasing** (design HD4; see
  docs/design/real-estate.md). Closes the two holes the D2 review flagged. **(1)
  Repossession rung.** When a tenant's insolvency would CLOSE a leased premises
  (`landlordFirmId` set), `BankruptcySystem` now REVERTS it to the landlord
  instead: ownership transfers on-book, the crew is released, the tenant's supply
  lines into it are dropped, the lease fields are cleared, and NO money moves —
  the tenant loses premises it never paid for and the landlord (which fronted the
  build capital) recovers its asset, closing the stranded-asset hole. It is the
  single insolvency close-point, so the player receivership path and the AI path
  ride the same rung. **(2) AI operator lease-vs-buy.** An expanding operator
  (`maybeExpand`) now leases its new outlet from a landlord instead of buying when
  cash is tight (below 2× the build cost) and a landlord with spare financing
  capacity offers — a deterministic sorted read, no rng. The landlord stays
  rational: `landlordCanFinance` fronts capital only down to its DISTRESS floor
  (not its full development keep-buffer), which is sound precisely because the
  repossession rung bounds the downside — a lease is now a recoverable, yield-
  bearing asset, not a capital sink. **Inert in every pinned run by the existing
  flag chain — NOT a second flag:** `realEstateEnabled` gates landlords entirely,
  so flag off there is no lessor, the lease branch is skipped, and the buy path
  runs byte-for-byte. Verified: plain City seed 11 300-day `rngState` = 2546912297
  / $3,169,000.00 and the whole flag-off City/Metro grid (seeds 11/4/7) unchanged
  to the byte; the flag-ON standard City/Metro 300-day organic leases = 0 (the
  store path is shortage-gated and the founder system backfills undersupply first),
  so the metropolis founder pins (24-30 firms / 0 insolvent) still hold. The
  lease-vs-buy rule and the repossession rung are pinned by driving the shortage
  the store path targets (`probes/ai-lease.ts`: City 11/4/7 → 2 leases each,
  landlord healthy ~$56k, repossession returns the asset, money conserved; flag
  off → 0 landlords, 0 leases). Suite +7 (realEstate.test.ts, now 15).
- **E follow-up — forward settlement feeds the pool + trade-desk polish**
  (see docs/design/region.md): closes the divergence that doc flagged. A settling
  forward SHIPS goods into the city, so for a pooled consumer good on a pool city
  the delivered quantity now feeds the larder through the same per-product guard a
  spot export uses (`pool?.inventory[productId] !== undefined`) — a delivered
  forward creates the *exact* cover overhang a spot dump of the same size does. The
  sign/close paper impacts on the walk stay put, correctly: they hedge the city's
  demand at paper time when no goods move, so there's no larder delta to book then
  — only settlement puts stock on the shelf. A deliberate default (the 15% penalty
  path) ships nothing and feeds nothing. Flag-off is untouched by construction
  (the pool only exists with `tradeDemandPoolsEnabled` on; `feedPool` no-ops when
  there's no pool). **Polish:** the trade desk now shows cover in days on BOTH
  ports (🔥 thin / 🧊 glutted, each chip prefixed by its port emoji) rather than
  only the routed one, and the morning advisor gains a pool-aware nudge — ship
  into a thin port's premium when you hold ≥ 10 units of what it's short of (cover
  below the `TRADE_POOL_THIN_COVER_DAYS = 4` 🔥 bar), cover-driven and inert
  flag-off. *Skipped:* no dedicated pool panel, no cover sparkline, no stacked
  multi-port advisor lines — the desk carries the full both-port read and one nudge
  per briefing suffices. Measured (trade-pool probe, City seed 11): a forward
  delivering 200 bread lands the quote at 0.874× (cover 6.9d), the exact overhang a
  200-unit spot dump produces, vs a 1.000× baseline before; a deliberate default is
  byte-identical to the no-forward baseline (1.000×, 6.0d); money conserved across
  settlement (Δ = 0). Suite +7 (forwards.test.ts: delivered-vs-default overhang,
  forward-feeds-like-spot parity, village flag-off touches no pool; advisor.test.ts:
  thin-pool nudge fires on thin-city + stocked-player, silent on no-stock / at-target
  / flag-off village). Village 1/11/777 and city 11 pins untouched (no sim-path
  change flag-off). Full suite green.
- **Metropolis becomes a New Game option** (beta): the biggest world scale — a
  390×276 map, the 30-firm founder field, and the full 18-product catalog with
  the deep C3 chains — was engine-only and soak-proven for unattended AI; it is
  now playable from the New Game modal alongside Village and City.
  `worldScaleConfig` (a pure helper the store and its tests share) wires the same
  channels a City game does — crowd + services + landlords + trade-city demand
  pools — with ONE deliberate omission: `investorsEnabled`, whose holdco founder
  row is double-gated on `sizePreset === 'city'` (a live holdco reshuffles the
  D3-measured crowd-tier bands), so the flag is a no-op at metropolis and is left
  off rather than set to something inert. The player-facing audit
  (docs/design/probes/metropolis-playability.ts, seeds 11/4/7, player flags on)
  found the engine sound but the player's *foothold* thin: a standard $15k start
  is $13k behind every one of the 25-30 AI rivals (each founds with the $28k
  metropolis founderCash) on a map whose deep chains cost up to $11,200 to stand
  up — one chain, no runway. Fix: a **player-only** metropolis cash uplift
  (`METROPOLIS_PLAYER_START_CASH_BONUS`, +$13k) opening the player at $28k
  founder-parity at standard (relaxed $38k / brutal $22k keep the gradient),
  applied only on the store's New Game path so every probe/test/pin that builds
  config directly stays byte-identical. Verified inert to the pinned AI
  trajectory: rngState, the 24-30 founder count, and 0-insolvent are all
  bit-identical across a $15k→$999k player-cash sweep (nothing in the
  founder/strategy/finance scans reads the player firm's cash — they key off
  profit base, marketCap, and employee/facility counts, all zero for the
  do-nothing player firm). The other audit numbers came back healthy: **save
  size** at day 300 is 2.7-3.2 MB, and a single autosave (default slot) SUCCEEDS
  in real headless Chromium — verified with the actual serialized state, not a
  quota estimate — so autosave does not silently fail; only the new-game-over-a-
  late-metropolis case (default + backup, ~6.4 MB) trips `QuotaExceededError`,
  which `saveGame` already catches (returns false, best-effort backup, no crash
  or corruption of the live save). **Perf** is 0.30-0.34 ms/tick at day 300, ~3000
  sustainable tps on one core — an order of magnitude over the 280 tps the 100×
  speed asks for, so 100× runs at full speed. Village seeds 11/4/7 reproduce
  their exact 300-day `rngState` (3274842624 / 2896139677 / 4253583594); the
  metropolis founder pins pass untouched. Suite +6 (worldScaleConfig.test.ts:
  village stays the classic difficulty config, City lights all four channels,
  Metropolis wires services/realEstate/trade-pools with investors off and lands
  the uplift on the real player firm at metropolis only); e2e +1 (metrosmoke.mjs,
  the Metropolis boot smoke in the citysmoke idiom at a short horizon).
- **E — the region seed** (design-forward; see docs/design/region.md): the
  roadmap's last arc opens the next axis — several towns sharing one world,
  trading with each other — as a *seed*, not the finished thing. The design doc
  lays out the region container (towns share one clock/rng/money supply and a
  freight graph; a town owns its map/cast/cohorts/firms; the trade cities are
  just towns the player doesn't operate in yet), the honest cost of the
  `GameState` refactor it needs (~1,300 flat-town call sites — `state.firms` etc.
  — behind an absolute bit-identity contract, so it lands as a flag-gated
  gradient, never a big bang), the migration path (pool → producing stub →
  `Town` struct as a one-town region reproducing the pins → a second live town →
  region UI), and what stays out of scope and why. The exploration's finding is
  written down: `createInitialState` builds a *world*, not a reusable `Town`, and
  cohorts key `districtId:tier` (an intra-town axis) — so regions are a layer
  *above* the district machinery, and the trade cities are the honest seed to
  grow. **The shippable slice: trade-city demand pools.** Each opt-in trade city
  grows a TINY cohort-style consumption pool — a population and, per consumer
  product, an inventory that exports refill and daily consumption drains, read at
  the same needSpec spec-midpoints the crowd's cohorts grow from (staples drain
  fast, luxuries barely; raws carry no pool). Its export quote picks up a
  **cover-driven** premium (thin stock) or discount (an export overhang), layered
  on top of the existing seeded walk: dumping 500 bread on Port Rosa now depresses
  its bread price for *days* — a real inventory overhang consumption works off
  over ~a week, deeper AND longer the bigger the dump — instead of one impact
  tick, and a starved city pays a premium until its larder refills. The pool
  REPLACES the one-tick `applyPriceImpact` for POOLED products (the durable
  supply signal is cover now; splitting a dump self-penalizes because the fed
  inventory is read live, so the anti-arbitrage guard is preserved and made more
  persistent — and raws/intermediates the pool never stocks keep the classic
  one-tick impact even on a pool city, a per-product guard the review demanded),
  and a pre-announced tender throttles restock so the Gazette's
  shock bites through real cover. It is a **price model, not a money holder** —
  exports still settle firm↔world through `recordTransaction`, conserved to the
  cent; it draws **zero** shared-rng (every quantity is a deterministic function
  of population × spec × stored inventory, sorted-product iteration) and holds no
  cash. Gated behind `tradeDemandPoolsEnabled` (default off at every preset,
  the shipped `servicesEnabled` precedent): with the flag off **no pool key is
  serialized and the trade book is byte-identical to pre-Arc-E** — proven by
  diffing the full 300-day village state (the only delta anywhere is the one new
  `false` config line). Village seeds 1/11/777 reproduce their exact 300-day
  `rngState`; city seed 11 reproduces its `rngState` and money supply; the
  tierAcceptance bands and metropolis founder pins pass untouched. A City world
  opts in; the trade desk now reports the better port's cover in days (🔥 thin /
  🧊 glutted) — the smallest honest surface. Measured (trade-pool probe, City,
  seed 11): overhang 0.74×→0.91× over 10 days (monotonic inventory decay vs the
  before-era's floor-slam-and-walk-bounce); size sensitivity 200u→~8d / 500u→~15d
  / 1000u→~21d / 1500u→~24d; starvation premium ~1.25–1.39× for ~6 days; money
  conserved; two seed-7 runs bit-identical. Suite +9 (tradePool.test.ts):
  pinned-baseline gate (no pool key with the flag off, classic one-tick path
  intact), pool seeding/quote parity, multi-day overhang, starvation premium,
  conservation, determinism, save round-trip. Full suite green (507 tests).
  **Step 2 — producing trade cities** (region.md migration step 2): the pool
  gains a SUPPLY side. Each city def carries a `productionByProduct` profile —
  per consumer product, the fraction of its own consumption it makes locally —
  and `updatePools` adds that local output every day (unthrottled, the stub
  town's own economy), so IMPORTS (the throttleable restock tender) now cover
  only the remaining GAP: `imports = max(0, (drain − localProd) + gap×rate) ×
  throttle`. Equilibrium is untouched (at target, imports exactly replace the
  consumption production doesn't, so a seeded-at-target pool quotes the bare walk
  day-to-day — no standing price drifts, the pins hold), but a deep overhang can
  only work off through consumption-minus-production, so the two ports genuinely
  SPECIALIZE: Port Rosa (🚢, food-leaning) grows 85% of its own bread and 15% of
  its tools; Ironvale (🚂, industrial) mirrors it (20% bread / 85% tools). A city's
  export market DEEPENS where it under-produces (chronically thin cover, a
  standing premium — Ironvale food, Port Rosa tools) and SHRINKS where it
  self-supplies (its output keeps the shelf full, so a dump overhangs harder AND
  longer). Deterministic, cash-free (production books no transaction), sorted
  iteration, inert flag-off. Measured (probe, City, seed 11): a same-fraction dump
  lingers ~23d on the port that MAKES the good vs ~18d on the importer (both
  d0 0.667×); under one tender the under-produced good starves to the 1.55× clamp
  while the self-supplied one holds at 1.12×; 500-bread overhang on food-rich Port
  Rosa now 0.737×→0.889× over 10d (size sensitivity 200u→~8d / 500u→~17d /
  1000u→~25d, all longer than step 1). No new surface — the cover chips already
  carry the specialization (a thin 🔥 on an under-produced good). playtestV8 (seed
  11) re-pinned honestly: net worth $60.0k→$62.8k (+$2.8k, was +$8.2k — dumping a
  staple on food-rich Port Rosa is now genuinely less lucrative, and the AI's
  exports feed the same pools), floor +$1.5k, still solvent/conserved, all six
  legs fire. Suite +6 (production determinism, equilibrium-holds, specialization
  spread, gap-only tendering, cash-free conservation, flag-off inertness). Village
  seeds 11/4/7 and city seeds 11/4/7 reproduce their `rngState` untouched. Full
  suite green (551 tests).
- **D2 — real-estate firms** (design HD4; see docs/design/real-estate.md): the
  first live specialist archetype. `ai/LandlordBehavior` runs the `landlord`
  dispatcher row — a firm whose whole business is developing and renting housing:
  it sells its weakest block through the B3 machinery under distress, then builds
  another near the residential band when housing is tight and affordable, its
  blocks joining the existing rent pipeline (cast pay `APARTMENT_RENT_PER_DAY`,
  the crowd fills spare capacity at `CROWD_RENT_PER_DAY`). Operators keep calling
  the original `maybeBuildApartment` verbatim — the seam was copied, not moved.
  **Commercial leasing** lands the missing half of a property market: facilities
  gain `landlordFirmId`/`rentPerDay`, an operator can LEASE its premises through
  the build flow (`BUILD_FACILITY { leaseFrom }` — "$X/day instead of $Y
  upfront"; the player picks a landlord in the build panel), and
  `CommercialRentSystem` bills it daily operator → landlord as `rentExpense` →
  `revenue`, firm-to-firm, conserved. A firm can never lease from itself (blocked
  at the command and the billing guard). `AIFounderSystem` grows a `landlord`
  row: when town housing occupancy holds above 92% for 15 sustained days
  (measured; first entry day 56-67) a rentals firm founds and breaks ground,
  respecting the founder cap (sub-capped to ⌊cap/6⌋ so it doesn't crowd out
  staple operators) and the A5 solvency brake. The whole archetype is gated
  behind a new `realEstateEnabled` flag (default off) — INERT in every pinned
  run, so the servicesEnabled house rule keeps the trajectories exact: Village
  seed 1/777 and plain City seed 11 reproduce their D1 300-day `rngState` and
  money to the byte, and the metropolis founder pins (24-30 firms / 0 insolvent)
  hold both with the flag off (bit-identical) AND on (28/27/30, 0 insolvent).
  Landlords are solvent across 300-day city+metropolis soaks, conservation exact;
  commercial-lease yield is pinned at 15% (in the 12-18% band), residential
  apartment yield measures much higher (~530-940%, inherent to the pinned $7k /
  50-tenant apartment) and is reported honestly. Suite +8 (realEstate.test.ts).
- **D3 — investor holdco archetype** (design HD5; see docs/design/stock-market.md,
  "Arc D3"): the first specialist to fill a D1 dispatcher row. A pure holding
  company (`systems/ai/investor.ts`) that owns no production and runs one loop —
  its equity book: deterministic holdco-sized yield buying (bigger blocks, a
  lower idle-cash floor, a cap laddering toward the 40% control block than the
  operator's dabbling), dividend harvesting, B1 rescue consolidation where the
  control ladder allows, and portfolio liquidation before insolvency. Every
  trade routes through `tradeShares`, so MAX_STAKE_PCT, the 40% hostile blocker,
  the 100% public-float ledger, and the fee/impact bind a holdco identically to
  the player and the operator field; a holdco's stakes show up in the existing
  ownership panels through the same `sharesHeld` wiring (player parity, no new
  UI). Holdco valuation was already correct from B1 — a zero-facility firm is
  cash + portfolio mark (stakes marked at each target's marketCap), and dividend
  income earns the 30× multiple via `dividendIn` — verified and unit-tested, not
  duplicated. A founder row spins a holdco up on a sustained fat-dividend-yield
  spread (median trailing yield across listed firms above a bar, N days). Gated
  behind an opt-in `config.investorsEnabled` flag (the shipped `servicesEnabled`
  precedent), OFF in every pinned baseline and double-gated on
  `sizePreset === 'city'` — because an active holdco is a large net buyer and
  shares trade against the public float, so it drains the firm sector and
  measurably shifts the A3 crowd-tier bands (seed-11 300-day worker 0.61→0.71
  with it live). With the flag off, zero investors found: Village seeds 1/777
  and City seed 11 reproduce their exact 300-day `rngState` and money supply, and
  the tierAcceptance bands + Metropolis 24-30-firm 0-insolvent founder pins pass
  untouched. City games opt in via the UI. Measured (d3-investor probe, City,
  300 days): seeds 11/4/7 found 3/3/2 solvent holdcos, portfolio P&L
  +$39.2k/+$44.9k/−$12.4k on $18.1k/$16.0k/$3.6k dividend income, turnover
  1.5-2.1 (no wash-trading), every cap held, conserved to the cent. Full suite
  green (+6 D3 tests: holdco valuation, the founder gate on/off, cap compliance,
  distress liquidation; the D1 dispatcher test updated — `investor` now routes to
  a live behavior, `service` stays the inert stub).
- **D4 — service firms** (design HD3/D4; see docs/design/b2b-services.md): the
  first specialist archetype lands, and it proves the B2B channel generalizes.
  `ai/ServiceBehavior.ts` fills the D1 `service` dispatcher row — a provider loop
  that enters a service under tight town utilization (the C2 datacenter-entry
  gate, lifted verbatim out of the operator's `maybeBuildDatacenter` seam and
  generalized to the catalog), grows its own capacity (level up, else a second
  site) when its seats run persistently full, and holds a 120-day maintenance
  cash buffer before any spend. Operators keep their C2 subscribe-side behavior;
  they no longer build datacenters. A SECOND service — office CONSULTING — ships
  to prove the channel is not compute-specific: a covered firm builds brand
  faster per ad dollar (`advisoryBoost` × MarketingSystem's ad→brand gain,
  `CONSULTING_BRAND_MULT` = 1.10) — a margin-side benefit that touches nothing in
  production, valued in the ROI gate off trailing ad spend exactly as compute is
  valued off gross. `data/services.ts` is now a 2-entry catalog and
  `ServiceBillingSystem` iterates it generically (deterministic billing order:
  service id, then contract id). `AIFounderSystem` gains the `service` founder
  row — aggregate uncovered seat demand above a bar for 20 days founds a provider,
  city-scale + `servicesEnabled` only, so plain-preset soaks (flag off) can't
  reach it: the counter map is never touched and no `service` firm is ever
  founded there (pinned by the plain-city inertness test). D4 probe (300d city,
  seeds 11/4/7): both services adopted (compute ~46%, consulting 17-30%), all
  providers solvent, zero cross-service billing bleed, per-service churn < 0.1/day,
  money conserved to the cent, ≤ 0.37 ms/tick. Suite green (484 tests).

- **D1 — the firm archetype framework** (design HD5; see
  docs/design/firm-archetypes.md): the scaffold for specialist firms. Every AI
  firm today runs one loop — the shopkeeper's; landlords, holdcos, and service
  providers need a dispatcher. `FirmStrategy` gains `archetype`
  ('operator' | 'landlord' | 'investor' | 'service', default 'operator'), and
  `AIStrategySystem` splits into a per-firm archetype DISPATCHER plus behavior
  modules under `systems/ai/`: today's monolith loop becomes
  `OperatorBehavior` VERBATIM (pricing/labor/sourcing that stays operator
  forever), with the build behaviors (`expansion.ts` — holding the D2 landlord
  and D4 service seams) and capital behaviors (`finance.ts` — the D3 investor
  seam) in sibling modules the orchestrator still calls in the exact old order.
  The B2/B3/C2 behaviors (portfolio buying, distress consolidation, datacenter
  provisioning) stay in the operator cadence — D1 marks their seams as comments,
  it does not reshuffle them. `AIFounderSystem` gains a per-archetype
  opportunity-signal TABLE (a `trackSignals` + `tryFound` row per archetype)
  with today's staple-gap / under-supply signals as the sole live operator row;
  adding a landlord/investor/service row is additive and never re-touches the
  operator path. `SAVE_VERSION` → 2 with the roadmap's one versioned migration:
  old saves stamp `strategy.archetype = 'operator'` on every firm (golden
  fixtures v1–v7 load unchanged; a migration test pins that a real v1 save —
  which carries no `"archetype"` string — gains the field). A pure refactor,
  and measured as one: Village seed 1 / 777 and City seed 11 reproduce their
  exact 300-day `rngState` and total money supply, and the full suite is green
  (471 tests, +6 for this arc: dispatcher routing by a stub non-operator
  archetype, direct `dispatchFirmBehavior` selection, and the migration).

- **C1 — product breadth**: the consumer catalog grows from the shipped 8
  products to 18 with five complete new chains — produce→meals (prepared food),
  leather→shoes (apparel), lumber→furniture and minerals→appliances (durables),
  and grapes→wine (a luxury a rung below jewelry) — all comfortable+ goods
  (worker tier mult 0, deliberate: it keeps the pinned worker budget valid). Each is authored in the house data style: full raw→
  factory→retail chain, tier-targeted needSpec (staples worker-priced, durables/
  wine comfortable-and-up, affluent luxury kept thin), a chain-wizard blueprint,
  a founder name pool, retail shelf assignments, and a natural seasonal hook
  where it fits. Every tuned constant carries its pinning measurement.

  The gate is the whole game. `makeCitizenNeeds`/`defaultNeedFor` and the
  trade-city price walk both iterate the catalog and DRAW from the shared rng per
  product, and the A1 `order` field pins the seeded draw sequence — so a naive
  add would drift every Village baseline. Products now carry an `availableIn`
  preset floor (default 'village' = present everywhere); every Village-active
  system that iterates a product list — the citizen need/preference draws, the
  trade-city rng walk, market-stat seeding, the founder scan, save-migration
  backfill, facility recipe copies, and the UI — reads a PRESET-FILTERED list
  (`productIdsForPreset`) instead of the raw catalog. The C1 products carry
  `availableIn: 'metropolis'` and needSpec orders above the Village max, so the
  Village AND City slices are byte-identical to pre-C1: a 300-day Village run at
  seed 4242 reproduces the exact rngState and full-state hash, and all pinned
  City tests (determinism, tier-gate acceptance, golden save v7) pass unchanged.

  Why metropolis-only and not city (the honest trap): the City preset carries a
  knife-edge, seed-pinned A3/A4 tier-band calibration with near-zero headroom.
  Feeding the breadth into the City crowd shifted the bands out of band (the
  crowd shops through a diluting per-tier softmax, so more products thin every
  product's service and drag satisfaction), and the extra rng draws from the
  broader trade-city walk and citizen creation desynced the pinned trajectory
  outright — measured, and every tuning lever traded one seed for another.
  Metropolis has no pinned tier-band test (its robust founder-count/solvency/
  conservation guards pin it), so it carries the breadth. The abstract crowd
  (cohorts) stays on the base catalog at every preset (COHORT_DEMAND_PRODUCT_IDS)
  — which keeps the calibration byte-stable AND avoids a founder deadlock where a
  crowd craving an as-yet-unserved product drags town satisfaction below the
  founder's entry gate; the C1 products' citizen demand comes from the named
  cast, whose satisfaction carries the A1 basket renormalization (now applied to
  cohorts too, provably inert for the City crowd's base basket and engaging only
  for the Metropolis crowd's broader one). Founders gain the breadth chains in
  Metropolis and the wizard/build-panel/assortment UI surface them there.

  Measured (metropolis, seed 7, 300d): money conserved to the cent, 30 solvent
  AI firms, ~0.32 ms/tick; the worker (median-tier) daily basket at spec
  midpoints is $11.04 against a $24.00 median income (46% — well inside the 85%
  C1 acceptance), and the per-tier renormalized basket weight is capped at the
  3.2 baseline (worker 2.80 inert, comfortable/affluent 4.35→3.20), which bounds
  any single product's introduction dip. Honest limit: in a pure UNATTENDED
  metropolis the founder cap saturates on the base staples first (whose fill sits
  below the metropolis 0.80 trigger), so the C1 chains stay a player/wizard build
  off real cast demand rather than auto-populating — cracking that is a
  founder-cadence recalibration, not a catalog change. Probe:
  docs/design/probes/c1-breadth.ts; pinned tests: src/sim/tests/productBreadth.test.ts.
- **C2 — the B2B services channel** (design HD3; see docs/design/b2b-services.md):
  firms now have a recurring firm-to-firm expense that CIRCULATES instead of
  leaking to the world account. One service ships — datacenter compute — but the
  shape (a service catalog + a provider facility + a coverage boost) generalizes.
  A new `datacenter` facility (city-scale only, buildable by player + AI, kept
  out of Village menus/founder paths) sells 40 compute seats × level; a firm
  whose reserved seats meet its demand (`ceil(employees/4) + facilities`)
  produces 6% faster company-wide. ServiceBillingSystem (daily, between Rent and
  Accounting) walks each provider's price by utilization, lets AI subscribers
  join (7d boost value > seat bill × 1.3) and drop (5 failing ROI days — the
  hysteresis band stops flapping), and bills one `recordTransaction` per contract
  under a new `serviceExpense` ledger category whose counterparty is the
  provider's revenue. Preset-gated behind a `servicesEnabled` flag (a City world
  turns it on): every pinned baseline — Village bit-identity AND the plain
  city/metropolis founder/soak trajectories — runs the channel inert, untouched.
  Probe (docs/design/probes/b2b-services.ts, 300d City, seeds 11/4/7): provider
  solvent every seed ($35-71k lifetime revenue, 0 insolvent), subscribers
  out-produce non-subscribers by 8.7-30.4% per producing facility, adoption
  25-38% of eligible AI firms at boost 1.06, subscribe/cancel churn ≤0.083/day
  (no flapping), money conserved to the cent, ~0.29-0.43 ms/tick at day 300.

- **C3 — deep (3-stage) chains** (see docs/design/deep-chains.md): the
  `intermediate` product category goes live. `ChainBlueprint` generalized from
  the fixed producer→factory→retail triple to an ordered list of production
  `stages` (each a facility + recipe), store appended after the last. Two
  metropolis chains deepen from raw→consumer to raw→intermediate→consumer:
  `minerals → STEEL → appliances` and `lumber → PLANKS → furniture`. Steel and
  planks are producer goods — no needSpec, never retailed, `availableIn:
  'metropolis'` — that move stage-to-stage (or firm-to-firm) on the existing
  wholesale/contract machinery like a raw. **Bit-identity**: a 2-stage blueprint
  builds BYTE-IDENTICALLY to the old triple (same facilities, order, coordinates,
  contracts) — the 300-day Village exact-rngState baseline reproduces unchanged
  (village-bitidentity-check), and chains.test.ts pins the concrete 2-stage
  structure. **The choice** (restructure two existing C1 durables rather than add
  a new consumer good or a shared steel→tools hub): it adds two live intermediates
  with ZERO new consumer-demand rng (the durables' needSpec/basePrice/tiers are
  untouched, so the metropolis basket bound and cast renorm are exactly as C1 left
  them), and — because comfortable+ durables are rarely auto-founded (base staples
  saturate the cap first) — the added stage's overhead lands on player/wizard
  builds, not the pinned unattended metropolis field. A heavily-founded staple
  (tools) turned 3-stage would have threatened the metropolis solvency guard;
  measured and rejected. **Save-compat**: the old single-factory recipes
  (`assemble_appliances`, `build_furniture`) stay as legacy aliases — no new build
  picks them, but a mid-flight metropolis factory set to one keeps producing;
  migration backfills the new intermediates' market/trade-city entries. Village
  and City never see any of it (metropolis-gated at every product list + facility
  recipe copy). The chain wizard shows the full stage list + total cost; the AI
  input-sourcing loop reaches across all three stages unchanged: intra-firm
  stage contracts are never re-sourced, so every intermediate flows on its own
  chain's links (the importer prices intermediates only as a comparison
  reference — it carries no import recipe for them and never stocks or ships
  one). Measured (docs/design/probes/c3-chains.ts, 300d
  metropolis, seeds 7/11/4): a wizard-built appliances chain runs end-to-end
  profitably — steel flows ~29 u/day produced AND shipped, chain P&L net
  ~$+1,567/day, firm cash +~$330k over 300d, money conserved to the cent,
  ~0.31-0.37 ms/tick, 200-day soak still 0 insolvent. Honest limit: local
  metropolis retail of a comfortable+ durable is thin by C1 design (the crowd that
  fills stores never craves C1; the C1-craving named cast is trip-limited), so a
  deep chain monetizes its durable output by exporting the surplus (the documented
  arc) while the shelf serves the local trickle — C3 changed only PRODUCTION, so
  retail demand is exactly as C1 left it. Pinned tests:
  src/sim/tests/chains.test.ts, src/sim/tests/productBreadth.test.ts.

- **A5 — the Metropolis fills up**: the 30-firm cap now actually happens. The
  founder-scale probe (docs/design/probes/founder-scale.ts — Metropolis + City,
  3 seeds, 300d, with an abort-reason table) diagnosed the binding constraint:
  the Metropolis was stuck at 5-6 AI firms because its world account runs a
  structural deficit at crowd scale (subsistence to a large idle crowd) and the
  Village-era `worldCash >= $22k` founding gate blocked ~200 of 300 days while a
  screaming shortage went unanswered (under-supply streaks to 291 days, fill-rate
  0.2-0.5). Four fixes, all preset-gated (Village bit-identical, its founder path
  and constants untouched): (1) the world-cash gate is now Village-only — founding
  is money-conserved (the firm pays land costs straight back) and more firms
  employ the crowd and relieve the drain, so a negative world balance is not
  insolvency; (2) per-preset founder pacing in SIZE_PRESETS (Metropolis cooldown
  7 vs the baseline 20, under-supply trigger 0.80, founding runway $28k vs $22k)
  read via new AIFounderSystem helpers; (3) under-supply entry founds the
  MOST-STARVED staple, not the first in fixed order — the probe caught bread
  stacking competitors while clothes starved 100-140 days unanswered; (4) a
  solvency brake: capital stops chasing a market whose incumbents are already
  struggling (>12% of AI firms unhealthy), turning the fill-rate signal from a
  pure service-level read into one that respects profitability. Result at day 300
  (3 seeds): Metropolis 24/28/30 firms, 0 insolvent, 0 distressed, cash median
  $8-11k, wholesale spread 0.55-0.72, money conserved to the cent, ~0.85-1.13
  ms/tick. The raised runway converts the last handful of entrants from
  ramp-casualties into solvent competitors (a shorter cooldown 6 packs to 30 but
  slides into a post-300 cascade — measured and rejected). Honest limits: the
  durable ceiling is ~25-27, so a 400-day horizon shows margin pressure at the
  full cap (the crowd-hiring cash-gate spiral in CohortLaborSystem, a demand-side
  A3 concern, not a founder defect); and CITY is left at its calibrated ~8-9 firm
  equilibrium — pushing it into the teens tripped the pinned A3 pool-drift and
  worker/cohort tier guards, so the "City in the teens" goal is an A3 crowd-tier
  recalibration, not an A5 founder-pacing one. City keeps only the (inert-for-count)
  most-starved distribution fix.
- **Arc A3 complete — the City lives**: the crowd has a society
  (CohortSocialSystem: satisfaction with real purchase/stockout nudges,
  tier mobility on cohort-owned wealth signals, desirability-weighted
  migration), pays rent (apartment blocks house crowd renters for their
  landlords; everyone else pays the world — the sink that bounds the
  pools), and the cast stays a faithful largest-remainder sample of it
  (CastCuratorSystem retire/promote swaps). Supply answers demand: AI
  founders enter occupied markets on persistent under-supply, and the
  cast's true staple demand is visible through urgent-need catch-up
  baskets. Final 300-day acceptance on three seeds: tier bands landed
  (worker 59-66%, comfortable 32-39%), cast-vs-cohort satisfaction gap
  1.3-3.5 points, money conserved to the cent, ~0.2ms/tick. City (beta)
  is selectable in New Game; golden save v7 and City determinism guards
  lock it in. Affluent stays a thin 2-3% top tier until product breadth
  and physical districts give luxury a labor supply — measured and
  documented, not assumed.
- **The crowd works and shops (A3 slices 1-2)**: non-Village towns now hold
  a real crowd. Worker cohorts bootstrap with cash in the residential
  districts; CohortLaborSystem fills the slots the named cast leaves open
  (cast always has priority, firms only hire crowd they can afford) and
  crowd counts as present crew at the cohort's skill; payroll settles one
  transaction per firm × cohort plus subsistence for idle crowd.
  CohortDemandSystem settles crowd purchases through the SAME shelves,
  store scoring, and market signals as the cast — trip-limited demand with
  10-bucket urgency distributions per product (the shadow-parity probe's
  measured model, ported wholesale), in 5 shop-window slices interleaved
  with cast shopping and restocks. Facility inspector and Population
  dashboard surface crowd staffing and district employment. Village towns
  re-verified bit-identical at every slice.
- **B1 — fair takeovers + control ladder**: full acquisitions cash out
  minority holders at the acquisition price (cost basis released with
  realized P&L) instead of clipping stakes; recordTransaction refuses to
  move money against a dead account (both sides or neither); a 25% stake
  earns board visibility and a 40% stake blocks hostile takeover of the
  target.
- **Shadow-cohort parity probe (A2 spike — the gate for A3)**: a prototype
  cohort demand engine ran beside the live agent town for 300 days × 3
  seeds with zero state mutation (end-of-run rng state matches the A1
  baselines exactly). Twenty model iterations later, per-product unit
  flows track the real economy within ±5% on every macro product on all
  seeds, the satisfaction formula transfers, and the probe refuted four
  design assumptions before any A3 code exists — demand is trip-limited
  (not urgency-rate-limited), cohort urgency needs quantile-bucket
  distribution state, tier gates need cohort-owned wealth distributions,
  and the original 2%/day tier flow was 3-4× too slow. Verdict, binding
  design directives, and the runnable probe are recorded in
  docs/design/cohorts-and-districts.md and docs/design/probes/.
- **Districts + dark cohorts (A2)**: the city gains structure without
  changing a single behavior. Three districts partition the classic map
  (Iron Row / Midmarket / The Rows) with a daily desirability cache; the
  crowd's future home — `district × tier` cohorts with REAL cash-pool
  accounts (a fourth account kind wired through the conservation
  invariant) — lands empty and dark behind the new `sizePreset` config
  ('village' = today's game, bit-identical, re-verified against the A1
  baselines). A Districts panel shows the new geography. Old saves
  backfill the partition on load; golden saves v1-v6 untouched.
- **Demand is data now (A1)**: every consumer product declares a `needSpec`
  (initial urgency, growth, quantity, walkaway price, per-tier appetite,
  and deterministic migration defaults) and citizen needs are generated
  from the catalog — the hand-authored need table, the TierSystem
  growth/price tables, and the migration backfill table all collapsed into
  one per-product declaration. The seeded draw order is pinned by an
  explicit `order` field, and the refactor is verified BIT-IDENTICAL:
  300-day runs on three seeds reproduce the exact pre-change rng state,
  populations, and satisfaction. Satisfaction gains basket normalization
  (min(1, W₀/Σw), W₀ = the shipped basket's 3.2): provably inert today,
  it caps total unmet-need drag once the catalog grows, so each new
  product redistributes satisfaction exposure instead of stacking
  unbounded misery on the town.

# Historical — `claude/business-sim-game-enhancement` branch

One continuous development run turning EconSim from a solid simulation into a
deep, self-explaining economy game. Everything below is tested (119 → 297
engine tests), probed with headless balance runs, and guarded by CI. The
latest arc — four pillars from a market-research pass against Capitalism
Lab, Big Ambitions, and Offworld Trading Company — added citizen classes,
hireable managers, a real commodity market, and shared daily play.

## Investing & the stock market

- **Stakes on the balance sheet** (investing overhaul, Phase 1 — see
  docs/design/stock-market.md): a holding company finally makes sense.
  Company valuation now marks held stakes to market — three deterministic
  tiers (operating valuation excludes holdings; marketCap adds them at the
  counterparties' operating value and is what shares trade at; the
  scoreboard valuation marks your stakes at their sale price) — so buying
  at market moves your valuation by exactly $0 instead of cratering it by
  the purchase price. Dividends are real income now: booked dividendIn on
  the holder (part of net profit, so the earnings multiple capitalizes a
  portfolio's income stream) and dividendOut on the payer (a distribution,
  never an expense), from a 7-day smoothed profit base with pools
  snapshotted pre-payout and firms settled in sorted order. Every share
  trade books shareBuy/shareSell with a tracked cost basis, and sells
  report realized gain or loss against what you actually paid. All trades
  — player and AI — go through one shared path (core/Shares.ts), loan
  collateral uses operating net worth only, and old saves migrate with
  stakes marked at today's price. Probed: a pure holding company that buys
  25% of every rival now GROWS from $15k to ~$17k over 150 days on marks
  plus ~$1k of dividend income, fully conserved (previously the same play
  looked like destroying $11k on day one).

- **Market friction** (investing overhaul, Phase 2): the stock market
  earns the same respect as the commodity desk. Every share trade pays a
  3% fee and fills along half its own price impact (0.4%/percent), with
  the displaced quote mean-reverting 20%/day toward fair value — the free
  round-trip timing play now loses ≥4% of notional. Sustained losses
  discount a firm below book value (bounded at half its net worth), and
  buyouts price off the same marketCap a 1% stake trades at, so creeping
  acquisition and clean takeover agree. The Company dashboard gains a
  Your-portfolio card (per-stake cost basis, mark, unrealized P&L,
  dividend estimate), and the advisor now warns (🏗️) when an unserved
  staple market is drawing an AI founder — claim it or compete with it.

## Economy & AI depth

- **AI rival personalities**: every AI firm has a named CEO with an archetype
  (🥊 Price Fighter, 📣 Brand Builder, 🏗️ Expansionist, 🚢 Exporter) that
  tilts shared strategy knobs — ad caps, price-cut depth, penetration targets,
  expansion appetite, R&D cadence, export retention. CEOs quip on gazette
  headlines; scenarios pin personalities for flavor.
- **Wage warfare**: the wage lever got a UI (town average, top rival, poach
  risk, one-click Beat Market) and AI counterplay — firms raise wages under
  tight labor (staff ride the raise) and drift back under slack.
- **Full supply-side elasticity**: shortage signals (finished-product unmet >
  sold, routed upstream through contracts) climb a ladder — over-crew (2.5×
  output) → level upgrades → widen shelf contracts → duplicate the entire
  production sub-chain (producer + factory II) — and reverse under losses
  (profit-gated boost + downsizing), so booms end in equilibrium instead of
  insolvency.
- **AI market entries**: mid-game roasteries (coffee), late-game luxury,
  apartment landlording under housing squeezes, rescue M&A, share purchases.
- **AI founders — capital follows people**: leave a staple (bread, tools,
  clothes) with no staffed seller for 20 straight days in a town worth
  living in (satisfaction at the immigration gate, 30+ citizens, day 55+)
  and a brand-new rival firm founds a starter chain for it — built by the
  player's own chain wizard machinery, funded from the world account
  (conserved), with a rotation-assigned CEO and a 📰 Gazette debut. Any
  seller appearing resets the clock, so serving your markets keeps
  competitors out; a total-AI cap keeps the map from crowding. Probed:
  Gold Rush's missing clothes market gets its Weaver House by ~day 80
  (solvent 220 days later), Meadowbrook never draws a spurious entry, and
  a rescued Dust Hollow attracts new employers only AFTER the exodus
  stops — the revival completes the migration story.
- **Wholesale market**: supply contracts can source from other firms'
  facilities — the buyer pays ~70% of market price on each shipment (seller
  books revenue, buyer books COGS), sellers never part with stock their own
  chains reserve, and broke buyers don't get shipped to. Buy local
  intermediates cheaper than importing, or run a pure-supplier strategy.
  Sellers set their own price (50–100% of market, default 70%): AI buyers
  pick the cheapest qualifying supplier, so undercutting wins the customer —
  and anyone priced above import parity gets dropped for the importer.
- **Wholesale price wars**: AI sellers work the same lever — cut toward a
  personality floor while surplus sits unsold (Price Fighters dive to 55%),
  creep up to 85% while customers pay — and locked-in buyers defect to any
  rival supplier 10%+ cheaper. Probed 300 days on six scenario/seed combos:
  live price spreads of 0.55–0.85, every AI firm solvent, money conserved.
  The Market dashboard's **Wholesale board** makes the war legible: every
  supplier's asking price, surplus, and customer count, sorted cheapest-first
  against the importer benchmark — undercut the top row and the next AI
  sourcing pass is yours. The 🔪 Undercutter achievement rewards serving an
  AI customer at 60% or less (an achievement, not a mission — the mission
  chain is sequential, and a niche-strategy gate would block mainstream
  players from everything after it).
  (Also fixes what was a free-goods exploit: the UI offered cross-firm
  sources but nothing charged for them.) Measured: at 85% a wholesale
  storefront's margin couldn't cover wages; at 70% it roughly breaks even
  until you add ads, sharper prices, or scale. A Local Sourcing mission and
  an advisor buy-local hint teach it — and AI firms shop their own input
  contracts too: import lines switch to any local firm (the player included)
  holding a real surplus when wholesale beats the importer, and revert if
  the supplier runs dry. Overproduce intermediates and AI customers come to
  you. Seller agency: every producing facility has a "sell wholesale"
  toggle (protect an export stockpile from forced sales) and lists its
  customers; AI buyers never shop from warehouses.
- **Port Rosa follows world news**: trade prices mean-revert toward
  event-shifted centers (droughts raise grain there too); fuel spikes scale
  export freight. Exporters never ship stock their own shelves are waiting on.
- **Ironvale, a second trade city**: an industrial inland hub that pays up for
  tools, minerals and finery but discounts food, behind pricier freight. Its
  price walk is anti-correlated with Port Rosa's, so arbitrage spreads open
  and close — exports, standing orders, and AI brokers all route to whichever
  port nets more. The Gazette's **Trade Desk** shows today's biggest spreads;
  a mission and an Arbitrageur achievement teach the routing game.
- **Debt is a lifecycle, not a state**: AI firms deleverage when cash-rich
  instead of carrying expansion loans forever; receivership offers a one-click
  emergency loan against remaining credit; the advisor flags heavy debt
  service.
- **The affordability thermostat**: the price controller now sees priced-out
  walkaways and cuts when they outnumber buyers — without it, quality/brand
  premiums let prices ride the market-power ceiling until town demand quietly
  died (measured: satisfaction 63 → 28 by day 120).
- **Prosperity tiers** (classes-and-ascension Phase 1): every citizen sits on
  a worker → comfortable → affluent ladder, derived daily with hysteresis
  (5–7 consecutive good days to climb, 5 sustained bad days to slip). Bars
  are probe-calibrated: the unattended labor market pays one flat wage, so
  each tier accepts savings as an alternative to above-market pay — wealth is
  the natural climb, generous player wages the shortcut. The Population tab
  shows the ladder; ascents to affluent make the event feed. Phase 1 changes
  no behavior yet — tiered demand and store positioning build on it next.
- **Tiered demand** (Phase 2): the ladder now changes how citizens shop —
  affluent citizens drink 1.5× the coffee, buy 1.4× the clothes, and tolerate
  10–20% premium prices on their favorite categories; luxury cravings follow
  the ladder (workers never, comfortable a little, affluent avidly), replacing
  the old satisfaction+cash gate so new money must climb before it becomes new
  tastes. Deliberately **additive-only**: probes showed trimming worker staple
  demand even 10% contracts the whole town by day 300 (revenue → jobs →
  immigration compound), so workers keep the calibrated baseline and
  prosperity strictly adds demand — ascension is always good news for
  shopkeepers, and no bot floor moved. Four-seed A/B: population and
  satisfaction statistically indistinguishable from baseline, with one probe
  town's AI pastry boutique finding its first unattended customers.
- **Store positioning** (Phase 3): every store can hang a 🏷️ Discount or
  ✨ Premium sign — but signs must be **earned** or they do nothing. Discount
  is earned by genuinely undercutting (≤95% of market average) and wins
  worker footfall while repelling the affluent; premium is earned by shelf
  quality ≥ 60 and wins affluent/comfortable shoppers, tolerates 15% higher
  prices, and repels workers. AI CEOs adopt formats in character (price
  fighters go discount, brand builders go premium once their quality earns
  it). Measured in a contested market: flipping one store to premium traded
  21 worker regulars for a comfortable/affluent clientele — and halved
  revenue in a worker-majority town. Who you sell to is now a strategy. The
  draft "price image" penalty (discount shoppers walk away at high prices)
  was probed at −5 town satisfaction and cut — a lying sign now simply does
  nothing instead of punishing the whole town.
- **Ascension as spectacle** (Phase 4): the ladder is visible everywhere —
  tier counts join the daily town history with "Middle class share" and
  "Affluent citizens" trend charts in the Population tab; affluent citizens
  stroll the map wearing a gold circlet (comfortable citizens get a white
  collar); ascents to affluent make the Gazette; and two achievements
  celebrate the climb (🥂 High Society for the town's first affluent citizen,
  🌊 Rising Tide when comfortable-or-better citizens outnumber workers).

## Player features

- **Hireable store managers** (Pillar 2, Phase 1): delegate a store to a
  named, salaried professional — three candidates (junior/seasoned/veteran)
  rotate weekly, and skill sets the duty list: everyone runs daily pricing,
  seasoned hands also size shelf contracts, veterans manage the ad budget
  too. Salary books as wages on the P&L; a firm that can't cover payday
  loses its manager on the spot. Measured: a $17/day junior manager rescued
  a mispriced store launch for a ~$12.8k hundred-day swing vs hands-off —
  while the $39/day veteran didn't earn their premium in a one-store market.
  Delegation has real economics, not just convenience.
- **Executive team**: two firm-wide hires complete the delegation ladder —
  a 🚚 logistics manager sizes shelf contracts across every store and swaps
  importer contracts to cheaper local wholesale (the same shop-around logic
  AI buyers use), and a 🚢 sales manager ships staged goods toward rush
  orders unattended and keeps standing export orders on every stocked
  warehouse. Hired from the Player Holdings inspector; one per role,
  $28–52/day, seniority buys extra duties and sharper price floors.
- **The manager lifecycle**: managers grow on the job (+0.004 skill/day,
  capped 1.3) and earn new briefs as they cross the duty gates — a 🎓
  promotion event marks each one. Every 60 days served, a salary review
  ratchets pay 12% automatically: hire cheap and train, and patience turns
  a junior into a well-paid veteran — or fire and re-hire from the weekly
  market. Delegation now has a career arc.
- **Commodity desk** (Pillar 3): the trade-city price walks are now playable
  in both directions — buy goods FROM Port Rosa or Ironvale at price +
  freight into a warehouse, hold the position (storage is the limit), and
  export the spike later. Temporal arbitrage joins spatial: buy the 0.7×
  dip, sell the 1.5× spike, pay freight both ways. Probed at 76%/300d ROI
  ceiling for a perfectly disciplined bot before warehouse costs — a real
  edge that doesn't dominate running a business, so freight stayed
  symmetric at ~8%. The AI deliberately doesn't speculate; the desk is a
  player edge, like the wizard.
- **Forward contracts + price impact**: lock a city's spiked price today,
  deliver within 3–10 days from any warehouse — shorting with a delivery
  truck (miss the delivery and pay a 15% default penalty; 📈 Market Wizard
  for delivering a 1.3×+ lock). Probing forwards exposed that the desk was
  a money printer — instant cross-city arbitrage profited every single day
  and a shorting bot won 97% of trades — so the market got real
  microstructure: **every trade moves the quote** (0.15%/unit, orders fill
  along the impact curve, the daily walk heals it). Measured live: greedy
  200-unit round trips now lose $26k/100d while patient 50-unit trading
  with a real edge earns ~$38/day. Craft beats greed, the town probe is
  unchanged, and AI gluts soften prices for real.
- **Daily challenge** (Pillar 4): one button starts today's shared run —
  seed = the UTC date, standard difficulty, the classic town, scored at day
  200. The deterministic engine makes it serverless: every player worldwide
  races the *same* town, and the leaderboard + share string recognize daily
  runs from the seed alone (📅 2026-07-18 beats "seed 20260718").
- **Announced trade shocks**: every couple of weeks a city pre-announces a
  price move three days ahead — "📯 Ironvale announces a tool tender,
  ~1.5× from day N" — and the quote races to the headline once it begins
  (markets react to news fast; the normal drift resumes after). Reading
  the Gazette is now a trading skill: the probed informed-trader edge is
  ~$100 per play — real, repeatable, bounded by price impact, and not
  worth building a warehouse for on its own. Ticker chip counts down to
  the move, the Advisor calls the play while the window is open (stage
  goods for a surge, lock a forward before a glut — warehouse owners
  only), and a 📯 Play the News mission teaches the desk.
- **Tier-driven town stories**: prosperity is now a magnet — when the
  middle class is broad (40%+ comfortable-or-better), newcomers arrive with
  a trade (+0.1 skill) and the Gazette says why; a struggling all-worker
  town with low satisfaction mutters about leaving instead (the warning
  shot before real departures below). The Gazette gains a 🎩 Society column: the ladder's
  daily counts, the citizen on the longest climbing streak, and the newest
  affluent household.
- **Scenario social character**: every scenario card sells its town's tier
  story up front — one probe-grounded line (Gold Rush mints affluence on
  its own; Mill Country is "a worker town waiting for someone to lift it")
  under the description on New Game. Lifting Mill Country to a
  comfortable-or-better majority earns 🌅 Lifted the Town, an achievement
  no other scenario can grant.
- **Emigration made real**: the growth loop now runs in reverse. A town
  held in deep misery (80%+ workers AND average satisfaction under 42) for
  10 straight days starts losing households — unemployed first, then the
  most miserable — savings leaving with them (conserved, the mirror of
  arrival cash) and the Gazette naming who left and why. One good day
  resets the clock: rescuing the town stops the bleed immediately, and the
  advisor warns (🧳) from day three of pressure. Probed 300 days across
  all six scenarios × two seeds: zero pressure accumulated anywhere —
  only genuinely neglected towns qualify (Mill Country's worst dip is
  satisfaction 44).
- **Dust Hollow, the turnaround scenario**: a seventh town that opens IN
  the crisis — the company pulled out, there are no stores and no
  employers, satisfaction collapses past the emigration bar by ~day 13 and
  wagons roll from ~day 24. Unattended it drains toward the population
  floor; one bread chain built from starting cash stops the bleed inside
  three weeks (probed, three seeds). Rescuing any bleeding town — families
  left, pressure zeroed, satisfaction back above 50 — earns ⛑️ Stopped
  the Bleed. The crisis is visible everywhere it should be: a red
  families-near-leaving tag and lifetime families-lost count in the
  Population tab, a Chronicle stat line, and an Intro mention (all
  verified live in the browser), plus a quiet two-note departure sting
  when a family goes. Golden save v6 pins the era for migration safety —
  a real Dust Hollow town captured mid-exodus (day 30, four families
  gone, pressure 18) that must load and keep unfolding forever; its
  Population-tab crisis shot joined the README.
- **Follow mode**: a 🎥 Follow button on any citizen puts the camera on
  their day — commute, shopping trips, and, if you've been paying them
  well, the day they earn their gold circlet. Esc or grabbing the map
  hands the camera back.

- **Coffee**: a cheap everyday product (grain → roastery → café) nobody serves
  at start — a first-mover mainstream niche, wizardable, with AI contest.
- **Real estate**: buildable Apartments collect daily rent, house immigrants,
  and raise resident satisfaction; distinct premium look on the map.
- **Sell/demolish facilities**: half-cost refunds with full reference cleanup —
  mistakes are no longer permanent maintenance drains.
- **Chain wizard upgrades**: one-click chains arrive auto-priced with a starter
  ad budget, and "managed" (auto-priced) products get the AI's own discipline:
  shelf contracts widen with demand and ad spend drifts down while the store
  loses money (downward only — raising spend stays the player's call).
- **Challenge mode**: scored day-200 runs (valuation-weighted 0–1000,
  difficulty multipliers), local leaderboard, copy-to-clipboard replayable
  dares (deterministic seeds).
- **Town size**: Cozy (40 homes / 80 citizens) or Bustling (double, taller
  map) — ceilings you earn by running a town people want to move to.
- **Receivership**: insolvency pauses the game with an itemized collapse
  report and ways back, instead of silently closing facilities.
- **Backup slot**: New Game stashes the old town; ↩ Undo New restores it.
- **Named save slots**: park towns and switch between them — save-as, load,
  overwrite, delete, each slot listed with day/scenario/population/cash.

## Legibility — the economy explains itself

- **🧭 Advisor briefing**: prioritized one-liners (losses and their dominant
  cost, blocked production, poach risk, hungry markets, export windows).
- **Satisfaction anatomy**: the equilibrium decomposed (base + employment +
  housing + provisioning) with each product's shortage priced in points —
  stagnation always names its cause.
- **Town trends & business cycles**: 60-day population/employment/satisfaction
  charts with a live phase badge (Hiring boom / Absorbing arrivals).
- **Spending power**: household money flows, per-product spend, hungry-market
  callouts. **Yesterday chip**: last closed day's net in the top bar.
- **Facility P&L**: every facility's last closed day — cash earnings plus
  internal shipments valued at market price (producers show the value they
  create), minus wages, upkeep, and inputs. Best-first table in Company;
  the advisor names your money pit. Facility stats are now snapshotted at
  the daily reset, so advisors read full days instead of mid-day partials.
- **Supply-chain flow overlay (F)**: animated contract routes, volume-scaled;
  wholesale (cross-firm) routes glow amber, and exporting warehouses get
  lanes running off toward the trade cities.
- **Daily digests fixed**: production/bottleneck alerts read yesterday's stats
  (the old midnight-status checks could only ever emit false labor alarms).
- **Closed doors aren't stockouts**: shoppers arriving after closing time
  are tracked separately, so the digest reports "missed N shoppers who
  arrived after closing — shelves were stocked" instead of phantom
  stockouts at a full store. The underlying lostSales signal is unchanged
  (probed: removing after-hours arrivals from it starves shelf-widening and
  stalls immigration at ~42 citizens — the equilibrium was measured with
  them in).
- **Cash runway countdown**: when the 7-day average burn would empty the
  till within 15 days, the Advisor leads with "~N days of cash left" (danger
  at ≤5) — missed payroll and receivership used to arrive with no countdown.
- **Big-moment sweep, verified live**: the five dramatic beats all fire
  correctly in a real browser — the takeover (fanfare + banner, below),
  the Empire chronicle at the re-priced rung, the day-200 challenge
  finish (score breakdown, leaderboard rank, copy-result / new-challenge
  / sandbox exits), and the receivership arc:
  a teetering firm slides distressed → insolvent, the modal lays out the
  books (negative cash, available credit, "last profitable day: never")
  with three ways back, and the emergency loan genuinely rescues it —
  Weathered the Storm unlocks, the firm returns to healthy, and the next
  report card honestly grades the disaster quarter an F.
- **The takeover moment**: acquiring a rival — the biggest single move in
  the game — used to pass with one event-log line. Now the fanfare plays
  and a banner names the absorbed firm ("Loom & Thread is yours —
  facilities, staff, brands, and contracts absorbed"), with the same
  baseline-on-mount guard as achievement toasts so loading a save doesn't
  replay old conquests.
- **Wage-ratchet warning**: when 7-day payroll eats 60%+ of revenue while
  the firm runs at a loss, the Advisor says so and names the way out (grow
  sales or trim staff before out-bidding rivals again). Born from the
  plateau probe, where a bot matching rival wages every cycle fed payroll
  past margin and flatlined with ~$0 cash while profitable rivals
  compounded. Quiet when you're profitable — earning your payroll is fine.
- Mid-game dashboard sweep: the Company quality chip shows the product's
  real default quality instead of 0 for products without R&D spend; the
  Bottlenecks panel groups 3+ identical reasons into one counted line with
  clickable facility names; wholesale wins/losses that name the player's
  firm get good/bad-news sound stings.
- **Saturation ≠ starvation**: a producer idled by a full output buffer no
  longer triggers the harsh "produced nothing" alarm or the "money pit —
  sell it" advisor line. Both now say what's true and what to do: the chain
  makes more than it sells — sell the surplus wholesale, export it, or grow
  the store's share (a fresh player following the wizard path used to be
  scolded daily for a working launchpad chain).

## Art — the city looks like a city

- **Procedural 2.5D building kit** (`src/render/buildings.ts`): every facility
  type is a real building in oblique projection — gabled cottages, barns with
  silos, mine headframes, sawtooth-roofed factories that physically grow with
  upgrades, curved-roof warehouses, awninged shopfronts (gold awnings mark the
  player's), container-stacked import terminals, apartment blocks that gain
  floors per level. Buildings are world-proportional, so zooming in reveals
  detail instead of miniatures on huge lots.
- **Daylight palette**: sunlit grass plate with mowing stripes, sidewalked
  asphalt roads with dashed center lines, tilled farm plots, a paved retail
  plaza, district ground washes, layered trees.
- **Seasonal ground**: the whole plate repaints by season — snowfield with
  frosted furrows and snow-capped trees in winter, tawny autumn, lush spring,
  warm summer — under the existing weather particles.
- **Day/night cycle**: a real darkness curve (deepest at 1 am — the old one
  was inverted and peaked at 1 pm), with a light pass drawn *above* the tint
  so streetlamps pool on the avenues and lit buildings glow warm (shops
  brightest, homes cozy, working factories cool blue-white).
- Chimney smoke only while a factory is actually producing; trucks are drawn
  box trucks with product-tinted cargo; citizens are little walking figures
  with activity-colored clothes.
- **Trucks drive the roads, commuters walk them**: shipment and commute
  progress is mapped onto Manhattan polylines over the street grid
  (origin → avenue → vertical road → door), so deliveries roll down the
  avenues and citizens stream along the sidewalks instead of flying over
  rooftops — purely cosmetic, the engine's straight-line timing is
  untouched. Short hops and absurd detours stay as straight cut-acrosses.
- **Build-mode ghost**: placing a facility shows the actual 2.5D building
  translucent under the cursor with the land-adjusted price at that spot
  (red when unaffordable), so location cost is felt before the click.
- **Camera glide to selection**: selecting an off-screen entity from a list
  (event log, citizen/facility tables) glides the camera to it — click it
  and the map takes you there; any drag or wheel cancels the glide.
- **Keyboard camera**: arrow keys pan and +/− zooms about the screen
  center, applied per-frame while held so movement glides instead of
  stuttering on key repeat. Ignored while typing in a field; released
  keys clear on window blur so the camera never runs away.
- **The highway east**: the middle avenue continues past the last
  intersection and fades toward the horizon, with a signpost naming where
  it leads — Port Rosa and Ironvale are real places on the map now, not
  just numbers in the trade panel.
- **Minimap**: whenever the viewport crops the town (zoomed or panned), a
  bottom-left overview appears — season-tinted ground, the road grid,
  building dots in their legend colors with player holdings ringed in blue,
  and a white frame showing exactly where you're looking. Click or drag it
  to fly the camera. It disappears at the fit view, where it would only
  duplicate the map.
- **Placement clearance**: manual builds reject ground within 3 world units
  of an existing facility — the ghost turns red and names what's in the way,
  and a blocked click keeps build mode active instead of eating the money on
  two stacked buildings (the wizard already planned with its own clearance;
  AI jitter placement is exempt so rival expansion never deadlocks).

## Content & polish

- **Port Haven scenario** (exporter CEOs, thin home shelves) joins Meadowbrook,
  Gold Rush Gulch, Harvest Valley — and **Mill Country**, where every AI
  factory imports its raw goods, so the player's opening is to become the
  whole town's supplier (verified: a staffed farm lands its first AI
  customer within 40 days; unattended, all three mills survive 300 days on
  every probed seed — the price controller passes the import premium
  through, so the town works but pays for it until someone builds farms).
- Missions, achievements, intro, README, and media all teach the new systems.
- Two new world events: ☕ **Third-Wave Coffee Craze** (+70% coffee demand,
  mid-game onward — the fad follows the roasteries) and 🛳️ **Regional Trade
  Fair** (both ports pay ~25% over center for a few days — the good-news
  mirror of tariffs; ship your stockpiles).
- **Boomtown Flats scenario** (🏗️, sixth): 13 full homes, three staffed AI
  chains, and immigration stuck at the door — whoever builds the housing
  owns the boom. Scenarios gained a `homes` knob for it. Probed 300 days ×
  3 seeds: AI landlords enter the developer race by day 44–85 and the town
  more than doubles (26 → 59–71) once housing appears, everyone solvent.
- Sound stings: receivership, challenge fanfare, rival openings, poach alerts,
  the rush-order beats (offer, completion, lapse), and fire-sale offers/closings.
- **Crew training**: the facility inspector's staffing row shows the crew's
  average skill (0.7× green to 1.3× veteran output) and a 🎓 Train button —
  $120 per worker below the cap buys +0.15 skill on the spot, about two
  weeks of on-the-job practice. Workers already at peak aren't billed, and
  the whole session books as R&D. A real three-way decision now: train
  green hires, wait out practice, or poach veterans at a permanent wage
  premium. New 🎓 Master Crew achievement (a 2+ crew averaging 1.25+).
- **Fire sales**: when a rival facility bleeds money on the 7-day EMA view,
  its owner puts it on the block at 75% of build cost rather than keep
  feeding it — a four-day window announced in the ticker with a Buy button
  right on the chip. Accepting pays the rival firm-to-firm (money
  conserved) and transfers the building, its crew (jobs intact, now on
  your payroll), and its supply lines: contracts feeding the facility
  become yours, contracts sourcing from it keep their owners and start
  paying you at ship time like any wholesale switch. Offer timing rides
  the same stream-safe hash rng as rush orders, so no calibrated outcome
  re-dealt; which facility goes up is deterministic (the worst sustained
  loser). New 🏷️ Bargain Hunter achievement.
  *Tuned by cadence probe* (4 scenarios × 300 unattended days): the first
  cut let profitable firms offer their own supply lines (internal cost
  attribution makes healthy chains' mines and farms look like per-facility
  losers) and re-listed the same building every week — one run offered
  Granite Mine ten times. Now the seller must be struggling at the firm
  level (negative 7-day profit or distressed) and a lapsed offer keeps
  that facility off the block for 30 days. Re-probed: 9–12 varied offers
  per 300 days (~monthly), story-coherent sellers.
- **Rush orders**: once the player owns a warehouse, a port's buyer
  occasionally calls for a bulk load — 40–120 units of something the player
  stages or produces, delivered to the ports within six days for a bonus of
  ~35% of the order's value (locked at offer time) on top of normal export
  revenue. Any port counts; the map ticker tracks progress and days left;
  an unfilled order lapses with a gazette note. Offers roll from a hash of
  (seed, day) instead of the shared sim rng stream, so bolting the system on
  didn't re-deal any long-calibrated outcome (every playtest-bot floor
  passed untouched). New 🚚 Beat the Clock achievement.
  *Tuned by playthrough probe*: the first cut drew products from everything
  a player's facilities *could* switch to, so 17 of 19 probed offers were
  for goods nobody was making (2/19 completed). Offers now draw only from
  goods actually staged or actively produced, and quantities dropped to
  30–90 (a single staffed line makes ~10–13/day, so six days plus staged
  stock covers the top of the range). Re-probed, 3 seeds × 120 days: every
  offer targeted a live product line and even a passive bot with one
  standing order completed 7/19 — an attentive player clears most.
- **Ambient soundtrack**: a quiet generative lo-fi bed — a slow maj7 chord
  pad through a lowpass with a sparse pentatonic music-box line echoing over
  it. Nothing loops verbatim, so it never grates. Daytime is brighter and
  busier; night closes the filter down and lets the pad breathe. Its own 🎵
  toggle sits next to the mute button; it also honors the master mute and
  ducks to silence when the tab is hidden, swelling back over a few seconds.
- Chronicle viewable anytime; apartments/roasteries visually distinct.

## Measured findings (kept as design, documented in code)

- **Pillar-era health sweep** (post-arc, unattended): 600-day Bustling soak
  (seed 42) — population 40 → 84, money conserved, zero AI insolvencies,
  tiers 60/20/4, no stuck forwards or announcements, 0.23 ms/tick. All six
  scenarios probed 300 days × 2 seeds: every one conserved, growing, and
  AI-solvent. Scenario personalities show through the tier lens now —
  Port Haven's export wealth mints affluent citizens (up to 24 of 40, avg
  satisfaction 87) and Gold Rush pays miners into affluence too, while
  Mill Country stays a hard-scrabble worker town (49/14/0, satisfaction
  ~47–52) — exactly the fixer-upper it was designed to be.

- **Full drift verify after the session's balance changes** (ladder,
  festival, rush orders): all six scenarios plus a Bustling variant, 300
  unattended days each — money supply conserved everywhere, no NaN in
  market aggregates, every town alive with all (or all-but-one) AI firms
  solvent, populations growing where growth is expected (Meadowbrook and
  Mill Country 40→71-72, Boomtown 26→64), 0.065–0.125 ms/tick, and the
  re-priced ladder rendering correctly in the objective banner with no
  stale $150k copy anywhere.
- **The scripted-player plateau is strategy shape, not an engine cap**
  (followed up the ladder probe with book-level dumps and a deeper-play
  A/B): the bot plateaus near $28k because it fights the bread incumbent
  head-on with thin staffing while AI niche monopolies compound untouched —
  the clothes incumbent alone books ~$650/day revenue to the bot's ~$110.
  Retail staffing works exactly as advertised (a third clerk doubled the
  store's daily take on the spot), and the AI reaching $50k+ proves
  compounding works in-engine. The scoreboard paths are the ones the game
  already teaches: claim uncontested markets (the Advisor's "hungry market"
  line), supply the town wholesale, export — don't grind a brand war
  against an entrenched rival with one understaffed shop. Also observed:
  reflexively out-bidding rival wages every cycle can ratchet payroll past
  margin — wage defense is a lever, not an autopilot.
- **The endgame ladder's top rungs were imaginary** (probed: bot v4's
  strategy plus apartment compounding, 600 days × 3 seeds): the scripted
  player plateaus near $28k valuation, the richest AI incumbent near $64k,
  and the whole Cozy economy sums to ~$210k — the old Magnate ($150k)
  demanded owning most of the town and Empire ($400k) was unreachable even
  owning *everything*. Re-priced: Tycoon stays $50k (a real stretch above
  strong play), Magnate $100k (out-value every incumbent), Business Empire
  $200k (approach whole-town scale — epic, but achievable in a long
  Bustling game). The chronicle finale is live content again — verified in
  a real browser: crossing $200k mid-play pops the Town Chronicle with the
  valuation sparkline, the milestone timeline, and the endless-mode note,
  and the objective banner flips to "All objectives complete".
- **AI crews don't need training** (probed after shipping the player's
  training lever: 2 seeds, 300 unattended days): incumbent AI crews average
  1.26–1.30 skill — effectively at the 1.3 cap — purely through stable
  tenure, since on-the-job practice maxes a settled worker in ~50 workdays.
  The 🎓 workshop is therefore a catch-up tool for the player's newer,
  churning crews, not an advantage the AI lacks; giving the AI a training
  behavior would re-deal calibrated outcomes to solve a problem that
  doesn't exist.
- **The festival was a trap at $1,500** (probed: 6 seeds, paired 100-day
  runs, world events silenced): its direct revenue lift for a typical
  single-chain player is ~$50–200 — the 25% demand bump for 3 days just
  isn't much till money at town scale. Repriced to $800, where it reads as
  the civic splurge it actually is (a large multi-store empire can still
  break even on volume), and festival crowds now drink coffee too — the
  event predated the product and had skipped it. Fund-home measured as
  what its framing says: philanthropy with a long-horizon payoff (+5 pop
  per 3 homes by day 100, direct cash ROI negative) — kept as designed.
- **Challenge scores are scenario-fair enough for one leaderboard** (probed:
  identical bread-chain-plus-exports play, 200 days, all six scenarios × two
  seeds): scenario means ranged 212 (Gold Rush Gulch) to 289 (Mill Country /
  Port Haven) — a real ~±15% terrain effect, but the same order as seed
  luck within a scenario (Gold Rush swung 183→240 on seed alone). Kept the
  single leaderboard and its scoring; the Awards table now medals your best
  run per town (🏅) and says plainly that scores compare best within the
  same town and difficulty.

- **Shares play pays** (probed at day 100, two seeds): a 45% stake in the
  top rival costs ~$25k and returns ~$25/day in dividends — roughly a 35%
  annualized yield at the 30% payout ratio, so stake-building is a real
  late-game strategy and the credit toward a full buyout compounds it.
  The standings table now shows each rival's estimated dividend per 5%
  stake (7-day average profit at the payout ratio), so the yield is
  visible before buying instead of discovered after.
- **Personality spread** (300 days × 4 seeds, Meadowbrook): Brand Builders
  spend 2.5× a Price Fighter's ad budget ($81 vs $32/day) and hold the
  highest prices (1.29× base vs 1.22×); Expansionists end with the most
  facilities and valuations. The tilt is real but deliberately modest —
  personalities shade a shared strategy rather than fork it, and the knobs
  feed a tuned equilibrium (amplifying them requires a full re-probe).

- **Poverty trap**: some seeds' incumbents can't profitably serve a poor town,
  so it stagnates below the immigration gate — deliberately preserved as the
  player's opening (the anatomy panel names it).
- **Trip rotation**: sorting shopping trips by satisfaction-weighted urgency
  was measured to destroy need rotation (staples permanently outrank
  everything); raw urgency is what rotates trips. Documented so it isn't
  "fixed" again.
- **Single-stage expansion backfires**: a second bakery on one farm's grain
  starves both — hence whole-sub-chain duplication.
- **A lone single-product chain is sub-scale**: re-measured across all five
  scenarios, an unattended wizard bread chain loses $35–70/day — it needs
  ~60% market share to cover a 5-person wage bill, which no scenario hands
  out. Deliberate: the wizard is a launchpad, and every attended strategy
  the bots play (multi-product store, all-verticals, pure supplier) clears
  its wealth floors. An earlier "+$1.2k unattended" claim predated the
  deeper economy and is retired.
- **Pure grain supply is a sideline, not an empire**: AI roasteries really do
  switch their import lines to a player's farm surplus (measured: first
  customer by day ~51–126 across seeds, ~$1k of wholesale revenue), but
  cheap grain against real wages is cashflow-marginal — deliberate; supply
  works as a ramp or side business (bot v5 guards the loop).
- **Phantom night demand**: urgent needs used to send shoppers to closed
  stores all night; every bounce counted as a "lost sale" (~25/day per store
  on full shelves) and fed the AI's expansion signals. Urgency no longer
  overrides store hours; wizard chains also get the AI's shelf-widening on
  auto-priced products (their 40-unit contracts famine-feasted once demand
  grew). Post-fix baseline (4 seeds, 200 unattended days): satisfaction
  equilibrium rose from ~47–54 to ~60–65, all towns clear the immigration
  gate, populations stay moderate (employment binds instead). Challenge
  satisfaction points rescaled to start at 55 so the freed baseline isn't
  free score.

## Infrastructure

- **Playtest bot v8** guards the archetype/world-scale era: a 250-day scripted
  City run (all era flags on — services, real estate, investors, trade pools)
  that plays the channels only a full City has. A self-managing bread chain
  funds a competent player who: leases a store premises from a founded landlord
  ($0 upfront, rent billed daily — D2); subscribes to a compute provider once it
  quotes reasonably and takes the coverage boost (C2); takes a dividend stake in
  the fattest-yield healthy rival, player-parity with the holdco loop (B2); locks
  a forward on a bread spike and closes it early at the mark (B3 — the round trip
  realizes a small LOSS by design: closeForward releases the signing hedge before
  marking, so sign-then-close nets the spread it paid; the bot asserts the ledger
  truth, not a win);
  exports a staple into Port Rosa's demand pool, moving its cover (Arc E); and
  sells the warehouse back for salvage. Entry timing is polled, never hardcoded
  (the landlord founds ~day 56, providers/pool exist from day 0 — the citysmoke
  idiom); a leg that genuinely can't play logs a SKIP and the rest still assert.
  Seed 11 is pinned (the canonical City bit-identity seed; probed 11/4/7, all
  play every leg). Measured day-250 scorecard (seed 11): net worth $60.0k→$68.2k
  (+$8.2k), solvent, lease rent $194 billed, compute $2,481 billed + 1.06× boost,
  a 5% firm_6 stake paying $2,465 in dividends, a forward closed at −$16.85
  realized (settlement − fee, off the ledger), 3 pool
  exports (cover 1.00→0.91), a $1,584 salvage refund, money conserved to the
  cent, 0.35 ms/tick. Floors pinned well under those values (the v7 convention).
  Suite +1 (511 tests). Zero sim-source changes — a test/probe slice.

- **Playtest bot v7** guards the pillar era end-to-end through the command
  surface: a 200-day scripted run whose store is never priced by hand — a
  hired manager runs it — with an executive logistics desk, R&D into an
  earned premium sign, announcement trading, and forwards locked on spikes.
  Measured at seed 9: $21.7k valuation, 8 announcement plays, 6 forward
  wins, both managers retained ~180 days, 0.30 ms/tick; floors pinned well
  under those values.

- **Playtest bot v6** (offers era): a 250-day integration regression where
  the three new systems work together — rush orders filled hands-free by a
  standing export order, fire sales bought whenever affordable, crews
  trained whenever average skill dips below 1.1. Floors assert every
  system actually fired (measured 5 rush completions / 8 fire sales / 4
  trainings at the pinned seed; every probed seed exercised all three)
  with money conserved and the firm solvent at day 250.
- **Golden save v4** (rush-order / fire-sale era): a fixture whose counters
  were earned through real engine paths — a rush order completed by actual
  exports, a fire sale bought through the real accept path (the transferred
  factory sits in the player's holdings) — plus live rush and fire-sale
  offers mid-flight and a lapse cooldown, so every field added this era is
  pinned against future migration regressions. Perf re-checked at Bustling
  scale with both offer systems in the loop: 0.129 ms/tick at day 300.

- CI (tests + build + e2e), three golden-save fixtures (legacy, modern,
  wholesale-era), three scripted playtest bots (general store; all-verticals;
  pure supplier), a 600-day soak, deep browser smoke, and time-averaged
  balance probes that respect the economy's real cycles. Perf: 0.20ms/tick
  at day 300 with everything on (the night-shopping fix removed more work
  than the P&L stamps added).
