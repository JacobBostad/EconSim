# Stock Market — investing overhaul design

The player complaint that started this: build a holding company and the
game calls you a failure. Buy a 49% stake in a rival and your valuation
drops by the full purchase price — `companyValuation`
(`companySelectors.ts:215-233`) never reads `firm.sharesHeld`
(`Firm.ts:73`), and the cash exits to `WORLD_ACCOUNT`
(`Simulation.ts:423-427`) with no offsetting asset. Since valuation IS
the scoreboard — objective ladder (`constants.ts:73-77`), quarterly
grade (`reportSelectors.ts:110-116`), 60% of the day-200 challenge score
(`reportSelectors.ts:179`) — every scoring surface tells the investor
they are destroying value by investing. The audit that mapped the
valuation, shares, acquisition, assets, AI-finance, and money-flow
subsystems condensed to seven problems:

- **P1 — stakes are a valuation black hole.** `sharesHeld` is not a
  term in `companyValuation`; a liquid, dividend-yielding asset is
  booked at $0. Cross-held firms are mutually understated.
- **P2 — dividend income never enters earnings.** Dividends book as
  category `'none'` (`DividendSystem.ts:43-50`), so they raise cash but
  not `netProfit`; the 30× `EARNINGS_MULTIPLE`
  (`companySelectors.ts:208,231`) capitalizes operating profit only. A
  pure holding company is valued at its decaying cash pile — no asset
  for the stakes (P1) and no multiple on their income. Doubly punished.
- **P3 — minority holders are expropriated on takeover.**
  `performAcquisition` deletes every other firm's stake in the target
  (`Acquisition.ts:116`) while the price — discounted only by the
  buyer's own stake (`Acquisition.ts:34`) — goes to `WORLD_ACCOUNT`
  (`Acquisition.ts:61-64`). AI rescue M&A
  (`AIStrategySystem.ts:357-373`) fires precisely on the distressed
  firms whose shares look cheap, so a 49% position can vaporize any
  day. Related lossy edges: the target's stake in the buyer is skipped
  valueless (`Acquisition.ts:118`), and stakes transferred above the
  49% cap are clipped with no refund (`Acquisition.ts:119-123`).
- **P4 — the share "price" is not a market price.**
  `max(1, round(valuation/100))` identically for buy and sell, zero
  spread, zero impact, infinite world-account counterparty
  (`Simulation.ts:415-435`). One anomalous profitable week swings the
  price by 30× the spike (7-day avg × 30, losses floored at zero) —
  buy after a bad week, sell after a good one, risk-free. The commodity
  desk carefully applies 0.15%/unit impact plus ~8% freight each way
  (`Trade.ts:32,60-62`); shares are the only friction-free asset in
  the game.
- **P5 — investing is invisible in the books.** All share trades and
  dividends use category `'none'` with `firmId: null`
  (`Simulation.ts:425,433`, `AIStrategySystem.ts:339-343`,
  `DividendSystem.ts:47-48`). No cost basis is stored, realized gains
  are uncomputable, and no P&L line ever shows what the portfolio
  earned.
- **P6 — the valuation base is crude**, and every share/buyout price
  inherits it: facilities at undepreciated historical `buildCost`
  against 50% actual recovery (`Demolition.ts:20`); upgrade capex
  vanishes (`Upgrades.ts:48-54` never raises `buildCost`); inventory at
  static `basePrice` (`companySelectors.ts:66-74`); closed facilities
  at $0 while their frozen inventory still counts; vehicle cargo,
  intangibles, and forwards unvalued; loss-makers floored at netWorth.
- **P7 — buying shares gives the target nothing.** Purchase cash goes
  to the world, never the issuer (`Simulation.ts:423-427`); no share
  count, no float, no issuer-side registry (holders are found by
  scanning all firms' `sharesHeld`, `DividendSystem.ts:35-40`), and
  ownership confers no control or information.

## Design principles

1. **Money moves only through `recordTransaction`.** Every settlement
   is exactly one conserved transfer between two validated accounts
   (`GameState.ts:256-301`); `totalMoneySupply`
   (`GameState.ts:385-390`, tested at `accounting.test.ts:37-41`)
   stays the invariant it is today.
2. **Unrealized gains live in selectors, never in cash.** Marking
   stakes to market is pure metadata — repricing moves no money, so
   conservation is untouched by construction.
3. **Determinism everywhere.** All randomness through the existing
   seeded `(seed, day)` hash streams (the `FireSaleSystem.ts:31-36` /
   `TradeCitySystem` pattern); every iteration over `state.firms` that
   has economic effect runs in sorted-key order, never `for..in`
   insertion order.
4. **One market mechanism, not two.** The commodity desk's friction
   template — price impact, spread, bounded walk with center-pull
   (`Trade.ts:32-62`) — is the proven in-repo model; the share market
   reuses it rather than inventing a second microstructure.
5. **Keep the 49% cap and the full-acquisition boundary**
   (`constants.ts:83`). Partial stake vs. control stays a clean binary;
   the control ladder (Phase 3) refines the space below 49% without
   introducing fractional-control ambiguity.

## Phase 1 — stakes on the balance sheet (IN PROGRESS)

Three valuation tiers, each a pure selector, each strictly one level
deeper than the last — no fixed-point solve, no circularity:

- **Operating valuation** — today's formula, holdings excluded. This
  is the pricing anchor and the measure of the underlying business.
- **marketCap** — operating valuation plus holdings marked at each
  counterparty's *operating* valuation (depth-1). Share price per 1% =
  `marketCap / 100`, replacing `valuation/100` at `Simulation.ts:415`.
- **Scoreboard valuation** — operating valuation plus holdings marked
  at each counterparty's *marketCap* (depth-2). This is what the
  objective ladder, quarterly grade, and challenge score read, and
  what `DailySnapshot.valuation` (`Accounting.ts:55`, written at
  `AccountingSystem.ts:72`) records.

The depth-2 scoreboard mark is chosen so that **a stake's book value
equals its sale-price basis**: selling 1% fetches the counterparty's
`marketCap/100`, which is exactly what the scoreboard carried it at.
Consequently buying at market is valuation-neutral — cash out equals
mark in — and the P1 punishment disappears without letting cross-held
firms inflate each other (each tier only references the tier below).

Bookkeeping that lands with it:

- **New `LedgerCategory` members** (`Transactions.ts:33-47`):
  `dividendIn`, `dividendOut`, `shareBuy`, `shareSell`, with matching
  `AccountingPeriod` fields (`Accounting.ts:9-20`) and `applyToLedger`
  cases (`GameState.ts:303-347`). `dividendIn` enters `netProfit`, so
  the 30× multiple finally capitalizes investment income (fixes P2) —
  a holding company's earnings premium reflects what its portfolio
  pays.
- **Dividend determinism.** Because dividend income now feeds the same
  `netProfit` that sizes dividend pools, all pools are computed from a
  pre-payout snapshot of every firm's profit, then paid out with firms
  iterated in sorted order — killing the object-key-order dependence
  of the current mid-loop cash cap (`DividendSystem.ts:26-31`).
- **Cost basis per stake.** `sharesHeld` grows from
  `Record<FirmId, pct>` to `{pct, costBasis}` (migration at
  `migrations.ts:114`, golden saves regenerated). Sales compute and
  report realized gain/loss against basis, surfaced in the sale
  transaction and the event feed (fixes P5's untraceability).
- **Credit limits switch to operating net worth.** The loan cap
  (`constants.ts:55-57`, `Simulation.ts:625`,
  `ReceivershipModal.tsx:53`) keys off OPERATING valuation, not the
  marked scoreboard number — marked stakes priced off other firms'
  30×-profit noise must not become borrowable collateral on top of the
  existing inventory-at-basePrice credit loop
  (`Simulation.ts:582-594`).

Money-conservation fixtures in `stocks.test.ts` and
`aiCounterplay.test.ts` extend to cover every new flow.

## Phase 2 — market friction (SHIPPED)

Shares were the money-printer the commodity desk was explicitly
engineered not to be (free round trips at a manipulable anchor, P4).
Same cure, same template — as shipped:

- **Per-trade fee**: `SHARE_TRADE_FEE` = 3% of notional, both
  directions, paid to the world (`core/Shares.ts`). Booked inside the
  shareBuy/shareSell ledger amounts; cost basis is all-in.
- **Price impact**: `SHARE_PRICE_IMPACT_PER_PCT` = 0.004 per percent
  traded. The order fills along half its own impact (exactly
  `impactedFillPrice`'s scheme), then displaces the resting quote
  (`state.sharePriceShift`, clamped ±25%), which decays 20%/day back
  toward fair value in FinanceSystem — sorted iteration, no rng.
  Valuation marks always use the UNDISPLACED marketCap: the shift is
  a liquidity phenomenon, not a change in fair value.
- **Loss discount**: `earningsPremium` replaces the `max(0, ·)` floor —
  sustained losses now price a firm below book, bounded at −½ of
  positive net worth. Buyouts price off `marketCap` (the same number
  1% trades at ×100), so creeping and clean acquisitions agree.

Measured: buy+immediate-sell of 10% loses ≥4% of notional (was a free
round trip); a holding company buying 25% of all three rivals pays
~7-8% friction on the blocks (large blocks SHOULD cost more) and still
finishes day 150 at ~$18.5k vs $15k start with ~$1.2k dividend income
— better than Phase 1 because the loss discount also cheapens its
distressed buys. Selling stays always-available at the frictioned
price — instant exit, honest spread.

## Phase 3 — fair takeovers + control ladder

- **Minority holders get paid.** `performAcquisition` splits the
  consideration: for each firm holding pct of the target, buyer pays
  holder `pct/100 × price` firm-to-firm via `recordTransaction`; only
  the residual public-float share goes to `WORLD_ACCOUNT`. Fixes P3
  and resolves the standing contradiction between the 0.9× distressed
  buyout discount (which invites cheap stake accumulation) and rescue
  M&A (which currently makes those stakes toxic).
- **No more silent value destruction at the edges.** Stakes
  transferred above the 49% cap are cashed out at market instead of
  clipped (`Acquisition.ts:119-123`), and the target's stake in the
  buyer is cashed out instead of deleted (`Acquisition.ts:118`).
- **Validate both accounts before every settlement.** `addAccountCash`
  silently no-ops when the referenced firm no longer exists
  (`GameState.ts:216-228`) while the other side still books — an
  acquisition deleting a firm mid-day would otherwise mint or destroy
  money. Every Phase 3 settlement checks existence first.
- **Control ladder below the cap:** at 25%+ the holder gains board
  visibility (the target's full financials in the dashboard); at 40%+
  the stake blocks hostile AI acquisition of the target (or grants
  right-of-first-refusal at the same price). This converts the 49% →
  100% cliff into a strategy space and gives the player a real counter
  to rescue-M&A, building on the creeping-acquisition loop the
  pre-held-stake buyout discount already rewards (`Acquisition.ts:34`,
  tested at `mna.test.ts:57`).

## Phase 4 — AI as market participant

- **One code path.** AI trades route through `tradeShares` instead of
  mutating `sharesHeld` directly (`AIStrategySystem.ts:339-344`) — the
  Phase 2 spread/impact rules apply to everyone or they are not rules.
- **Yield-based buying.** Target selection by deterministic dividend
  yield (`avgNet / marketCap`) with a health check, replacing
  "highest valuation" (`AIStrategySystem.ts:322-333`), which today
  maximizes the price paid per dividend dollar and happily buys into
  firms about to fold.
- **Distress selling.** An insolvent AI liquidates its portfolio
  before `BankruptcySystem` starts closing facilities — stakes are
  liquid assets, and today no bankruptcy path reads `sharesHeld` at
  all. AI stops being a one-way cash sink into equities.
- **Per-personality dividend policy.** `DIVIDEND_PAYOUT_RATIO` becomes
  a per-firm policy driven by AI persona (and player-settable), paid
  from a smoothed profit base matching the UI's own estimate
  (`CompanyDashboard.tsx:142-154`) rather than one noisy day — giving
  investors a genuine yield-vs-growth read on each firm.

## Phase 5 — asset-liquidity sweep

The share market prices firms off their balance sheets, so the worst
balance-sheet distortions from the assets map get fixed here:

- **Upgrade capex adds to `buildCost`** (`Upgrades.ts:48-54`), so it
  reaches valuation, the SELL_FACILITY refund base (`Demolition.ts:32`),
  and fire-sale asks (`FireSaleSystem.ts:98`). An L3 facility stops
  booking at L1 cost.
- **Apartments become sellable and valued** — remove `'home'` from
  `UNSELLABLE_TYPES` (`Demolition.ts:23`) and from the valuation
  exclusion (`companySelectors.ts:223`); building one no longer
  permanently destroys its $4,500 cost from measured valuation.
- **Forwards closeable early at mark.** A close-out command
  (`Commands.ts:70-77` is sign-only today) cash-settles the remaining
  obligation at its mark instead of forcing the 15% deliberate-default
  exit that books as a miscategorized `'logistics'` expense
  (`ForwardSystem.ts:113-118`).
- **SELL_FACILITY salvages inventory** instead of writing off stored
  goods and in-transit cargo (`Demolition.ts:8-9,63-69`).
- **Insolvent AI sells facilities instead of closing them.**
  `BankruptcySystem` closing the costliest facility
  (`BankruptcySystem.ts:73-99`) zeroes its valuation contribution,
  while selling would recover 50% — the strictly better option becomes
  available to AI (`Demolition.ts:36` is player-only today).

## Open questions / accepted quirks

- **Dividend float leakage is an intentional money sink.** The un-held
  public-float share of every dividend pool exits to `WORLD_ACCOUNT`
  (`DividendSystem.ts:56-66`). This is kept deliberately: the town
  economy needs drains, and "outside shareholders get paid too" is a
  legible fiction. Stated here so nobody "fixes" it as a leak.
- **Integer-percent granularity stays for v1.** Stakes remain whole
  percentage points (`Simulation.ts:401`, 5% UI blocks at
  `CompanyDashboard.tsx:160-165`); a share-count model would force a
  `Record<FirmId, ...>` shape migration plus golden-save churn for
  resolution the sim's scale doesn't need. Documented limitation, not
  a bug.
- **Zombie-firm equity.** Firms are never deleted by insolvency
  (`BankruptcySystem` has no deletion path), so equity in a
  perpetually insolvent firm trades at the `max(1, ·)` floor forever,
  while acquisition deletes equity in one stroke — the two exit paths
  imply contradictory terminal values for a share near zero. Phase 2's
  below-book discount for sustained losses narrows the gap; a true
  terminal state for dead AI firms (equity wipe, asset auction) is
  deferred until the market phases prove out.
- **Primary issuance (P7's deeper half)** — shares as a capital raise
  for the issuer, with float and treasury — is out of scope for this
  overhaul. The secondary market must price honestly before a primary
  market can mean anything.
