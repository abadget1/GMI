# Global Market Index API

FastAPI backend for the real-time Global Market Index dashboard. It ships with
a deterministic synthetic feed so the full UI can run without vendor keys. The
`SyntheticMarketFeed` remains the zero-credential fallback. Setting
`GMI_ALPHA_VANTAGE_API_KEY` enables the built-in quota-aware Alpha Vantage
adapter for indices, forex, commodities, crypto, and the normalized GMI.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

When using a local ignored environment file, start with
`uvicorn app.main:app --env-file .env.local --reload --port 8000`.

Open `http://localhost:8000/docs`, or start the API and Redis together with:

```bash
docker compose up --build
```

## API surface

- `GET /api/v1/assets` — components, weights, methodology, and timeframes.
- `GET /api/v1/snapshot` — one dashboard-ready market payload.
- `GET /api/v1/index/candles?symbol=GMI&timeframe=15m` — OHLC history.
- `GET /api/v1/pressure?group=Energy` — supply/demand pressure scores.
- `GET /api/v1/zones/GMI?timeframe=15m&min_quality=70` — structural zones.
- `POST /api/v1/alerts` — register timeframe-specific approach, cross, or inside-zone alerts.
- `POST /api/v1/alerts/evaluate` — explicit alert evaluation hook.
- `WS /ws/market` — bounded, live `market.snapshot` messages.

`GET /api/v1/index/candles` and `GET /api/v1/zones/{symbol}` resolve data in
this order: user-uploaded history, Alpha Vantage, then the deterministic core
fallback. Responses include `requested_timeframe`, effective `timeframe`, and
source metadata. Premium intraday entitlement failures automatically fall back
to Alpha Vantage daily endpoints; direct indices use SPY/QQQ/DIA ETF proxies
when the premium `INDEX_DATA` endpoint is unavailable.

Snapshot zone fields are deliberately dual-published during the browser
contract transition:

- `zones[symbol]` is the backward-compatible 15-minute zone list.
- `zones_by_timeframe[timeframe][symbol]` contains every supported timeframe.

Each symbol/timeframe list is quality-sorted and capped at 12 zones. Alert
events include both `distance_pct` and the immutable triggering
`threshold_pct`, so historical labels do not depend on later rule edits.

## Index methodology

The index is a fixed-reference weighted-return index with base value 1,000:

```text
Index(field,t) = 1000 * sum(weight_i * price_i(field,t) / reference_price_i)
```

Weights are normalized to sum to one. Open and close use their corresponding
component values. High and low use weighted normalized component extrema and
therefore form a conservative bar envelope; component extrema do not
necessarily occur simultaneously. This is mathematically coherent across
instruments with different quote levels, unlike an average of raw index prices.
The demo gives SPX and IXIC equal weights; component weights are configurable.

For a production index, persist divisor/reference changes for rebalances,
corporate actions, and component substitutions. Real-time bars should be built
from exchange-time event streams with watermarks and late-tick correction.

## Pressure and zones

Pressure is a bounded `[-100, 100]` score. Positive values indicate demand;
negative values indicate supply. Inputs combine order-book imbalance,
inventory, flows, momentum, and logistics stress with documented normalization.

Zone detection is deterministic and explainable: it finds a two- or three-bar
impulse, anchors to the last opposing candle, returns exact time/price bounds,
and records virgin/touch state, fair-value-gap, break-of-structure, trend
alignment, and a quality score. It is a decision-support signal, not trade
execution advice.
