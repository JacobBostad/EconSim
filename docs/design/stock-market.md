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

## Phase 4 / Arc B2 — AI as market participant (SHIPPED, city-scale)

All four behaviours ship gated on `sizePreset !== 'village'`. The
Village 300-day run is an exact rng-state / serialize bit-identity
contract (the orchestrator re-runs it), and any change to the shared
rng draw order or the transaction flow would break it — so every B2
path is made structurally unreachable in a Village. Verified: seeds
1 / 11 / 777 produce identical `rngState` and serialized state at day
300 with and without B2 (and the determinism + golden-save suites
cover it). As shipped:

- **One code path.** AI trades still route through `tradeShares`
  (`AIStrategySystem.ts` `maybeBuyStakeCity`), so the Phase 2 fee/impact
  and the new float ledger apply to AI exactly as to the player.
- **Yield-based buying** (`maybeBuyStakeCity`). Target selection is the
  highest trailing dividend yield — `smoothedProfitBase / marketCap`,
  the SAME smoothed base `DividendSystem` pays from
  (`DividendSystem.smoothedProfitBase`) — among rivals that are healthy,
  actually earning (`base > 0`), and operating-solvent
  (`operatingValuationOf > 0`). This replaces the Village path's
  "highest valuation" rule, which maximised price paid per dividend
  dollar and bought into firms about to fold.
  - *RNG discipline (critical).* The city economy is chaotic and the
    A3 crowd/tier acceptance bands are pinned to its rng trajectory, so
    the buy keeps the Village path's EXACT draw structure — same `$35k`
    floor short-circuit, same `rng.chance(0.12)` cadence, same 5% block,
    same `ceoQuote(rng)` on success — and changes ONLY deterministic
    logic. Persona appetite therefore expresses "aggressive personalities
    buy more" through the deterministic stake CAP
    (`min(MAX_STAKE_PCT, round(25 × stakeAppetite))` — expansionist
    accumulates toward 40%, exporter stops near 18%), never through
    frequency, so no rng draw moves.
- **Distress selling** (`BankruptcySystem.liquidatePortfolio`). A
  distressed/insolvent AI sells its whole portfolio at market — sorted
  order, full `tradeShares` fee/impact/realized-P&L — BEFORE any facility
  is closed. Selling can lift cash back to solvency, in which case the
  facility close is skipped that tick: the reprieve a real operator buys
  by liquidating stakes instead of shuttering shops. Player portfolios
  are never force-sold (the owner decides).
- **Per-personality dividend stance** (`Personality.dividendMult`, applied
  in `DividendSystem` at city scale only). Growth personas retain
  (expansionist 0.85, brand_builder 0.9), income personas distribute
  (price_fighter 1.1, exporter 1.15); the rotation averages to 1.0. The
  multiplier tilts ONLY the firm-to-firm holder payments — the
  public-float world-drain is computed from the neutral
  `DIVIDEND_PAYOUT_RATIO` base, so the town's dividend sink (and thus the
  A3 crowd/tier calibration) is unchanged by persona. Village runs
  `mult = 1` with the neutral remainder, byte-identical to the pre-B2
  payout.

### Float ledger (resolves the B1 review flag)

B1 review noted that aggregate outside holdings of one target could
exceed 100% — three 49% holders summed to 147% — because nothing summed
the float. Decision: **cap the aggregate at 100% with first-come
priority**, not a founder-retention ledger. It is the natural fit for
`tradeShares`, which already clamps a buy to `MAX_STAKE_PCT − held`; the
float cap is one more clamp, `applied ≤ 100 − Σ(everyone's stake in the
target)`, derived live from `sharesHeld` with no new persisted state and
no migration. A latecomer is clamped to the remaining float; a target
with none left rejects the buy. Enforced at city scale only: Village's
looser (grandfathered) behaviour is held for the bit-identity contract,
and with Village's 25% AI cap its aggregate never nears 100% anyway — the
new city yield-buying is the only pressure toward full float. Measured
(b2-portfolio probe, 300 days): max aggregate float per target stays
≤ 88% across seeds 11/4/7; no target is ever over-sold.

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

- **B2 city valuation drift is AI-side, not a ladder re-pin.** Because
  yield-buying builds real portfolios, and `companyValuation` marks held
  stakes as assets (the P1 fix), the *AI* firms' marked valuations rise:
  the city day-300 valuation MEDIAN moves ~+55–73% (seeds 11/4/7:
  $27.7k/$25.4k/$26.4k → $44.3k/$39.4k/$45.7k, b2-portfolio probe). This
  is > the 10% re-pin trigger, but the objective ladder
  (`constants.ts:73-77`) is NOT re-pinned: it is an ABSOLUTE
  *player*-valuation win condition pinned on the Village/Cozy economy,
  and B2 is gated off Village and never auto-builds the player a
  portfolio — the player's operating valuation is untouched. The drift is
  the intended cross-holding markup on firms that choose to hold equity,
  it is bounded (depth-2 marks, no recursion) with positive, bounded
  unrealized P&L and no wash-trading (turnover ≈ 2.0–2.2, all build-up),
  and marked stakes still cannot collateralise loans (credit keys off
  `operatingNetWorth`). Reported per Arc B2 item 7.
- **A3 cohortRent plateau assertion is one-sided (B2).** B2 diverts some
  city firm cash from wages into stakes, so the crowd cash pool eases
  down a few percent in the mid-game instead of sitting dead flat
  (day-80→120 moved −11.7% on seed 11 vs −5.7% pre-B2). The pool stays
  well under the `$500/cap` runaway cap and the `<$2/cap/day` drift
  guard, both untouched. The plateau check (`cohortRent.test.ts`) —
  which exists to catch the pool CLIMBING — was made one-sided (bound the
  upward move only), faithful to that intent; a mild bounded decline is
  now allowed, exactly as the sibling signed-drift guard already allowed
  it.
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
