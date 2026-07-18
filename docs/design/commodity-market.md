# Commodity Desk — Pillar 3 design

Offworld Trading Company's lesson: a price chart the player can ACT on in
both directions is a game in itself. EconSim already has the hard part —
two trade cities walking anti-correlated daily prices in a 0.6×–1.8× band
(`TradeCitySystem`, `data/tradeCities.ts`) — but the player can only sell
into it. Buying was one-directional (the flat-priced importer at a fixed
1.25× markup). That leaves *spatial* arbitrage (route exports to the
better port) and forfeits *temporal* arbitrage (buy the dip, hold, sell
the spike) — the move every trading game is built on.

## Phase 1 — buy from the cities (SHIPPED)

`BUY_FROM_CITY {firmId, facilityId, productId, quantity, cityId}`:

- Warehouses only — storage is the natural position limit (combined
  input+output units vs `storageCapacity`), and staging in a warehouse is
  what lets the goods flow back out through the existing export path.
- Unit cost = `cityPrice × (1 + exportFreightFee(city))` — the same
  freight the sell side pays, symmetric and fuel-sensitive. Money books
  firm → world as `importPurchase`; conservation holds.
- Goods arrive at the product's `defaultQuality` (same convention as the
  flat importer).
- **The AI does not buy speculatively** — this is deliberately a player
  edge, like the wizard. AI firms already broker their surpluses out.

UI: a **Commodity desk** row on the warehouse inspector — product picker,
quantity, and one button per city quoting the delivered cost (price +
freight) against base, colored when it's a genuine dip.

## Viability probe (pre-implementation)

300-day run, seed 11, mechanical bot on the real recorded walks: buy 200
units when a city quotes ≤0.8× base, sell when ≥1.3× (either city), both
legs paying freight:

| buy-side freight | 300d profit | round-trips | avg capital tied | ROI/300d |
| --- | --- | --- | --- | --- |
| 8% (symmetric, shipped) | $8,008 | 14 | $10,567 | **76%** |
| 15% | $6,444 | 14 | $11,255 | 57% |
| 25% | $4,212 | 14 | $12,236 | 34% |

76%/300d is the *ceiling* for a perfectly disciplined bot running every
product across both cities with free storage — real players pay warehouse
build cost (~$4k) and daily maintenance, spot fewer dips, and tie capital
they'd otherwise put into retail (which compounds). Symmetric 8% freight
makes speculation a genuinely profitable sideline that does not dominate
operating a business, so no extra buy-side penalty was added.

## Phase 2 — forwards, price impact (SHIPPED)

**Forward contracts.** `SELL_FORWARD` locks today's city quote for
delivery 3–10 days out (max 2 open, ≤200 units). On the due day, staged
warehouse goods are pulled and paid at the locked price minus that day's
freight (freight risk stays live); short units cost a 15% default
penalty. This is shorting with a delivery truck: lock a spike, buy the
dip later, deliver. `market_wizard` achievement for delivering a forward
locked ≥1.3× base.

**Price impact — the finding that reshaped the phase.** Probing the
forward design exposed that Phase 1 had shipped a money printer:

- A shorting bot on the real recorded walks won 97% of trades for
  $48k/300d (worst trade −$16) — anti-correlated cities mean "lock A's
  spike, buy from B cheap" is riskless.
- Worse, plain instant cross-city arbitrage (buy B, export A, same day)
  was profitable on **300 of 300 probed days**, ~$1,300/day at 200 units.

The fix is market microstructure, not fees: **trades move the quote**.
Every desk buy, export, and forward lock fills along a linear impact
curve (0.15%/unit, so a 200-unit order averages 15% slippage) and leaves
the city's quoted price moved by the full amount (clamped to the walk
band; the daily center-pull heals it). Applies to everyone, AI exports
included — a glut softens prices for real now. Re-probed live:

| Strategy (100 days, real commands) | cash delta |
| --- | --- |
| greedy 200-unit best-spread round trips | **−$25,997** |
| patient 50-unit trips, ≥5% edge only | **+$3,809** (~$38/day) |

Greed loses, craft earns a modest sideline, and the 4-seed unattended
town probe is byte-identical to baseline (AI trade sizes round below
impact). That's a market.

## Later phases

- Market-moving world events with pre-announcements ("Ironvale tool
  tender next week") so reading the news becomes a trading skill.
- Gazette coverage of big player trades.
