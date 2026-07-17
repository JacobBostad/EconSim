# EconSim — a Capitalism Lab in miniature

A deterministic, inspectable, browser-based economic simulation. A small town of
citizens earns wages, shops, and consumes; firms run real supply chains (farm →
bakery → store; mine → tool works → store; cotton farm → tailor → boutique);
prices move with supply and demand;
firms make or lose money; an AI competitor reacts; and **you** run a company —
building facilities, setting prices and wages, hiring workers, and wiring up
supply contracts.

It is intentionally small in scope but **not shallow**: goods physically move
through inventories, money is conserved to the cent, the same seed always
replays identically, and every important number can explain itself in the UI.

---

## Quick start

```bash
npm install
npm run dev        # open the printed http://localhost:5173 URL
```

Other commands:

```bash
npm test           # run the Vitest suite (engine correctness + 365-day stability)
npm run build      # type-check (tsc) + production build (vite)
npm run typecheck  # type-check only
```

### How to play (60-second tour)

1. Press **Play** (top-left) and pick a speed (1× / 5× / 20× / 100×).
2. Watch the map: green dots are citizens working, orange dots are shopping,
   purple squares are shipments moving goods between facilities.
3. Click any facility, citizen, firm, or shipment to inspect it in the right
   panel. Hover any underlined number for the formula behind it.
4. Open the dashboards (top bar): **Company**, **Market**, **Supply Chain**,
   **Population**, **Debug**.
5. Build a competing bread chain: in the left **Build** panel pick **Farm**,
   click an empty spot on the map; do the same for a **Factory** and a **Retail
   Store**. Then, in each facility's inspector:
   - Farm → select recipe **Grow Grain**, **Hire** workers.
   - Factory → select recipe **Bake Bread**, hire workers, create a supply
     contract pulling **grain** from your farm.
   - Retail Store → set retail product to **Bread**, set a price, hire a clerk,
     create a contract pulling **bread** from your factory.
6. Undercut the AI's bread price and watch your market share grow (or your cash
   bleed if you price below cost). Save anytime; it persists in `localStorage`.

---

## Architecture

The golden rule: **the simulation engine is completely independent of React.**
React only renders state and dispatches commands.

```
UI (React)  ──dispatch(Command)──▶  Simulation  ──mutates──▶  GameState
   ▲                                    │
   └──────────reads (selectors)─────────┘
```

```
/src
  /sim
    /core         Simulation, GameState, SimulationConfig, Random (seeded PRNG),
                  Id, Tick, Commands, Events, Transactions
    /entities     Citizen, Firm, Facility, Product, Recipe, Inventory, Vehicle,
                  Contract, Market, Accounting, Location, factories
    /systems      One file per system; run in a fixed order each tick
    /data         products, recipes, facilityDefinitions, startingScenario,
                  names, constants  (all game rules live here, as data)
    /selectors    Pure read-only views for the UI (company, market, citizen,
                  facility, supplyChain, debug)
    /persistence  saveLoad (JSON <-> localStorage), migrations
    /tests        Vitest specs (see "Tests")
  /store          useGameStore — the thin Zustand bridge + fixed-step driver loop
  /ui             React components (display + intent only)
  /render         TownRenderer — self-contained animated canvas (zoned town,
                  roads, buildings, citizens, trucks, day/night, $/goods popups)
  /utils          formatMoney, formatTime, math, clamp
```

### The simulation loop

`Simulation.tick()` advances the clock by exactly one tick and runs every system
in a **fixed order**. Daily roll-up systems run first (so the day that just
ended is finalized before the new day's per-tick systems run):

```
TimeSystem → WorldEvents → MarketStats → AIStrategy → EventLog → Marketing →
Finance → Dividends → Bankruptcy → Satisfaction → Immigration →
Accounting → Payroll →                                      (daily roll-ups)
CitizenSchedule → Movement → Labor → Production → Logistics → Retail →
Achievements → Missions                                     (every tick / hourly)
```

Each system is a function `(ctx: SimContext) => void` that mutates the live
`GameState` in place (chosen for speed: 365 in-game days simulate in ~1.5 s).
Systems that only act daily/hourly guard on `isDayBoundary` / `isHourBoundary`.

Time model: `ticksPerHour` (default 2) → a day is 48 ticks. Work hours 08–16;
shops open 08–22; citizens shop after work (or sooner if a need is urgent).

### Determinism

- All randomness comes from a single seeded PRNG (`core/Random.ts`,
  mulberry32-style). Its entire state is one `uint32` stored **inside**
  `GameState` (`rngState`), so it can never desync and round-trips through
  save/load. `Math.random()` is never used in the engine.
- Ids are generated from per-prefix counters in `GameState`, not timestamps.
- Result: the same seed + same command sequence ⇒ byte-identical state
  (verified by `determinism.test.ts` and `saveLoad.test.ts`).

### Money & accounting

- All money is **integer cents**. Every cash movement goes through one helper,
  `recordTransaction`, which moves the money, appends a transaction record, and
  updates the affected firm's accounting accumulators. So a firm's books always
  reconcile with the transaction log (`accounting.test.ts`).
- Accounts are firms, citizens, or a single **world** account (utilities /
  government / outside world). Maintenance, variable production costs, logistics,
  build spend, and subsistence flow to/from the world account, so **total money
  across citizens + firms + world is conserved exactly** (asserted in tests).

---

## Entity model (summary)

| Entity   | Owns / has | Key behaviour |
|----------|------------|---------------|
| Citizen  | home, optional job, cash, needs, satisfaction | wakes, commutes, works, earns wages, shops by store score, consumes |
| Firm     | cash, facilities, employees, prices, wage policy, accounting, AI strategy | produces, prices, pays wages, profits or goes distressed/insolvent |
| Facility | type, owner, inventories, recipe/retail product, employees, status | produces / sells / stores; reports bottlenecks |
| Product  | base price, category, perishability, scoring weights, need type | data-driven catalog |
| Recipe   | inputs, outputs, labor, ticks, variable cost | data-driven transformation |
| Contract | source, destination, product, reorder point, target, max | drives logistics shipments |
| Vehicle  | cargo, route, ETA, transport cost | moves goods between facilities |
| Market   | per-product demand/supply/price/share stats | drives dashboards + AI |

---

## Economic formulas (all in code, all inspectable in the UI)

**Production** (`ProductionSystem.ts`)
```
workerFactor      = laborRequired > 0 ? min(1, presentWorkers / laborRequired) : 1
inputAvailability = all inputs present ? 1 : 0
efficiency        = baseEfficiency * workerFactor * inputAvailability
productionProgress += efficiency        (per tick)
when progress ≥ ticksRequired: consume inputs, add outputs, pay variableCost
status = input-starved | labor-starved | inventory-full | active
```

**Store score** (`RetailDemandSystem.ts`) — how a citizen picks a store
```
availability = inStock ? 1 : 0
price        = clamp(referencePrice / actualPrice, 0, 2) / 2
distance     = 1 - clamp(dist / maxShoppingDistance, 0, 1)
quality      = stockQuality / 100
brand        = firmBrand / 100
reliability  = prior successful purchases (capped)
score = 0.28*availability + 0.22*price + 0.18*distance
      + 0.14*quality + 0.12*brand + 0.06*reliability   (+ small seeded jitter)
```
A purchase happens only if the store is open & stocked, the citizen can afford
it, the need is above threshold, and the price is within their willingness to pay.

**Accounting** (`AccountingSystem.ts`, `entities/Accounting.ts`)
```
grossProfit     = revenue − costOfGoodsSold
operatingProfit = revenue − COGS − wages − maintenance − logistics − variableProductionCost
```
COGS = materials bought from the importer. Internal transfers cost nothing;
internal production cost shows up as wages + variable cost (no double counting).

**AI pricing** (`AIStrategySystem.ts`) — a mean-reverting controller
```
sold out while selling      → raise 2–5%
has stock but sold nothing  → cut hard (priced out of market)
held surplus, no sellout    → cut gently
selling steadily            → drift toward base price
clamped to [floor, ceil] × basePrice
```

**Strategic depth — the three Capitalism-Lab axes** (you win on more than price):

- **Brand / Advertising** (`MarketingSystem.ts`): a daily ad budget builds brand
  (diminishing returns, ~3%/day decay). Brand adds a 12% term to the store score
  *and* raises willingness-to-pay (`price cap × (1 + brand/250 + (quality−50)/300)`).
- **Quality / R&D** (`INVEST_RND` command): cash buys quality points (diminishing
  toward 100); production stamps the firm's quality onto its goods, feeding the
  quality term in demand + willingness-to-pay.
- **Finance / Loans** (`FinanceSystem.ts`, `TAKE_LOAN`/`REPAY_LOAN`): borrow up to
  1.5× net worth; daily interest is a real cost; `net profit = operating − interest`.
  Heavy debt deepens insolvency — leverage is genuine risk/reward.

The AI uses all three (advertises, invests in quality when flush, borrows to
**open new outlets** where demand is unmet), so the world grows on its own.

**Land value** (`core/LandValue.ts`): ground near homes (foot traffic) costs
0.8×–1.6× to build on and rent, shown as a green→red heatmap while placing.
Downtown premiums buy real customers via the distance term in store scoring.

**Labor market** (`LaborSystem.ts`): workers carry a skill multiplier
(~0.85→1.3 with tenure; crews produce at average skill) and jump to firms
paying ≥15% more — wage policy poaches veterans or loses yours.

**M&A** (`core/Acquisition.ts`): buy out AI rivals at 1.3× valuation (0.9×
distressed, credit for held shares) and absorb everything; flush AI firms
rescue-acquire dying rivals too. Objectives escalate on a ladder (Tycoon
$50k → Magnate $150k → Business Empire $400k).

**Inter-city trade** (`TradeCitySystem.ts`): Port Rosa, a distant trade city,
prices every product on a bounded daily random walk (0.6×–1.8× base). Stage
goods in a warehouse and EXPORT them at Port Rosa's price minus 8% freight —
stockpile cheap, ship on spikes. Booms/gluts make the news; the Market
dashboard shows live Port Rosa prices.

**World events** (`WorldEventSystem.ts`, defs in `data/worldEvents.ts`): once per
day there is a 20% chance a news event starts (max 2 active, opposites never
overlap). Events are temporary town-wide modifiers with a headline — economic
booms/recessions move willingness-to-pay ×1.25/×0.75, droughts/bumper harvests
scale farm output ×0.5/×1.6, mine collapses/rich veins scale mines, product
crazes raise per-trip purchase quantity ×1.6, fuel spikes scale transport cost
×2.2, and tariffs raise import prices ×1.5. Active events appear as chips on
the map (hover for the playbook) and in the event log; they roll from the
seeded rng, so a given seed always produces the same news history.

---

## Extending the simulation

Everything that defines the game is **data** in `/src/sim/data`.

**Add a product** — append to `products.ts`. If consumers buy it, give it a
`needType` of `food`/`goods`; add a need for it in `startingScenario.ts`.

**Add a recipe** — append to `recipes.ts` (inputs/outputs/labor/ticks/variable
cost), then list its id in the relevant facility definition's `allowedRecipes`.

**Add a facility type** — add a `FacilityType` in `entities/Facility.ts`, a
definition in `facilityDefinitions.ts`, and (if it produces) recipes. Add it to
`BUILDABLE_DEFS` to let the player build it.

**Add an AI strategy** — extend `FirmStrategy.kind` and branch in
`AIStrategySystem.ts`. The system already has hooks for restaffing and pricing.

**Add a system** — write `(ctx: SimContext) => void` in `/systems` and insert it
into the `SYSTEMS` array in `core/Simulation.ts` at the right point in the order.

**Add a command** — add a case to the `Command` union (`core/Commands.ts`) and a
handler in `Simulation.dispatch`. The UI dispatches it; the engine validates it.

**Tune the economy** — `core/SimulationConfig.ts` (`DEFAULT_CONFIG`) holds tick
rate, work/shop hours, payroll, distress thresholds, AI price bounds, subsistence
income, etc. Config is part of saved state.

---

## Tests

`npm test` runs the Vitest suite (`src/sim/tests`):

- **production** — consumes inputs & makes outputs; halts without inputs;
  slows/stops without workers.
- **retail** — purchase moves cash citizen→firm and reduces inventory; need
  urgency drops; stockouts create unmet demand; lower price scores higher.
- **payroll** — wages move firm→citizen; missed payroll is recorded when broke.
- **pricing** — AI raises on sellouts, cuts on surplus, stays within bounds.
- **logistics** — contracts ship goods source→destination; importer sourcing
  charges the buyer.
- **accounting** — firm books match the transaction log; **money supply is
  conserved** across the economy.
- **saveLoad** — serialize/deserialize restores identical state; save==keep
  running.
- **determinism** — same seed ⇒ identical state; different seeds differ.
- **stability** — **365 in-game days** run without crashing, with logs bounded
  and money conserved.

---

## Design decisions & defaults (documented tradeoffs)

- **In-place mutation** of a single `GameState` (no Immer) for 100× speed.
- **World account** absorbs external costs so money is perfectly conserved and
  the importer is modeled as a real firm.
- **Retail "open"** = staffed (≥1 assigned employee) within open hours; selling
  is not gated on a clerk being physically present (production *is* gated on
  present workers). This abstraction avoids dead stores during the shopping
  window. See `storeIsOpen`.
- **Subsistence income** (`config.subsistenceIncomePerDay`, default $12/day) is
  paid to unemployed citizens from the world account so the consumer economy
  keeps functioning at high unemployment. Set to 0 for a harsher world.
- **Satisfaction is an equilibrium**, not a counter: it drifts toward a level
  set by employment and whether needs are met (≈85 employed & provided, ≈60 on
  subsistence, far lower under chronic shortage), so the town reads as healthy
  by default and reacts to shocks. A 120-day no-player balance test guards this.
- **Starting scenario**: 40 citizens / 20 homes; three AI firms (bread, tools,
  and clothes chains); an external importer; a player firm with $15,000 and no
  facilities (buildable land). Lean staffing so the AI chains are roughly
  break-even and there's room for the player to compete.

## Known limitations

- One city; product catalog is three consumer chains (bread, tools, clothes);
  one AI strategy archetype per chain.
- Labor market is "instant hire from the unemployed"; no wage-driven poaching
  yet (the architecture leaves room for it).
- AI expansion currently opens retail outlets only (capped); it doesn't yet add
  upstream capacity or new product lines, and the AI never initiates M&A.

## Roadmap

Multiple cities & inter-city trade · taxes & subsidies · inflation & macro
policy · deeper AI (upstream expansion, AI-initiated M&A) · land values & rent ·
a scenario editor & mod support · LLM-driven strategic agents (the command API
is designed for this).

Already in (the Capitalism-Lab core loops): real supply chains, retail demand &
pricing, **brand/advertising**, **quality/R&D**, **corporate finance/loans**,
a **stock market** (buy up to 49% of rivals; 30% of their daily profit is paid
out as dividends pro-rata), **town growth** (high satisfaction + a tight labor
market attracts immigrants; the municipality builds new homes — creating jobs
literally grows your market), competing AI that expands, financial statements,
company valuation & standings, bankruptcy, save/load with migrations.
