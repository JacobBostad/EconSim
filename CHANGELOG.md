# Changelog — `claude/business-sim-game-enhancement` branch

One continuous development run turning EconSim from a solid simulation into a
deep, self-explaining economy game. Everything below is tested (119 → 210
engine tests), probed with headless balance runs, and guarded by CI.

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

## Player features

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
  and the rush-order beats (offer, completion, lapse).
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

- CI (tests + build + e2e), three golden-save fixtures (legacy, modern,
  wholesale-era), three scripted playtest bots (general store; all-verticals;
  pure supplier), a 600-day soak, deep browser smoke, and time-averaged
  balance probes that respect the economy's real cycles. Perf: 0.20ms/tick
  at day 300 with everything on (the night-shopping fix removed more work
  than the P&L stamps added).
