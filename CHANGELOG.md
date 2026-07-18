# Changelog — `claude/business-sim-game-enhancement` branch

One continuous development run turning EconSim from a solid simulation into a
deep, self-explaining economy game. Everything below is tested (119 → 297
engine tests), probed with headless balance runs, and guarded by CI. The
latest arc — four pillars from a market-research pass against Capitalism
Lab, Big Ambitions, and Offworld Trading Company — added citizen classes,
hireable managers, a real commodity market, and shared daily play.

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
