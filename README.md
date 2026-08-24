# Meridian Global Market Intelligence

A real-time cross-asset market dashboard and supply/demand zone engine. The project combines a Next.js analytics interface with a FastAPI ingestion service, deterministic demo feeds, composite-index calculations, zone-quality scoring, and proximity alerts.

## What is included

- A responsive global macro dashboard inspired by professional trading workstations
- S&P 500 and Nasdaq Composite views across 15-minute, 30-minute, 1-hour, 4-hour, and daily intervals
- Normalized equal-weight and market-cap-weight index calculations
- Supply/demand zone detection using base candles, 2–3 candle impulses, trend, break-of-structure, fair-value-gap, and retest filters
- Sector pressure heatmaps for energy, agriculture, industrial metals, and semiconductors
- Configurable, timeframe-specific approach, inside-zone, and crossing alerts
- REST bootstrap plus WebSocket snapshots, with an in-memory cache and optional Redis mirror
- Deterministic simulation, so the full experience works without market-data credentials

## Quick start

### Dashboard

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### API

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The API documentation is available at [http://localhost:8000/docs](http://localhost:8000/docs). Copy `.env.example` to `.env.local` to connect the dashboard to both REST history and the WebSocket stream. Without those variables, the UI uses its deterministic browser simulator and fixtures.

## Import historical data

Use **Import** in the dashboard to upload a UTF-8 `.csv` or `.json` OHLCV file, then choose it from the asset selector. The import supports any symbol, including symbols such as `AAPL`, `BTC-USD`, or `EUR/USD`; it is kept separate from the configured GMI component universe.

Required fields are `timestamp`, `open`, `high`, `low`, and `close`; `volume` is optional. Timestamps may be ISO-8601, Unix seconds, or Unix milliseconds. Header aliases such as `time`, `date`, `o`, `h`, `l`, `c`, and `vol` are accepted. Duplicate timestamps use the last row, which makes vendor corrections safe to re-import.

For automation, post raw UTF-8 CSV or JSON to:

```text
POST /api/v1/historical/import?symbol=AAPL&timeframe=1d&mode=replace&format=csv
Content-Type: text/csv
```

`mode=replace` replaces that asset/timeframe history; `mode=merge` keeps existing bars and overwrites duplicate timestamps. Imports are limited to 10 MB and 10,000 input rows, and the in-memory service retains the most recent `GMI_HISTORY_LIMIT` bars per asset/timeframe (500 by default).

## Verification

```bash
npm run lint
npm run typecheck
npm run test:market
npm run build
cd backend && .venv/bin/python -m pytest -q
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the system diagram, file structure, data contracts, calculation methodology, and production hardening notes.

> This project is an analytical reference implementation, not investment advice or an execution system. A production deployment must license its market data, preserve provider timestamps, and test alert semantics against venue-specific trading calendars.

The dashboard intentionally uses the starter's MUI design system and a dependency-free SVG candlestick renderer. The backend API is a single-user local reference service: authentication, tenant isolation, durable notifications, and provider entitlements are production requirements, not features of this prototype.
