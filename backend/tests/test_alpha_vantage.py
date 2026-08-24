import unittest
from dataclasses import replace

import httpx

from app.alpha_vantage import AlphaVantageClient
from app.config import Settings
from app.domain import Timeframe


def settings() -> Settings:
    return Settings(
        alpha_vantage_api_key="test-key",
        alpha_vantage_base_url="https://alpha.test/query",
        alpha_vantage_cache_ttl_seconds=60,
        alpha_vantage_timeout_seconds=2,
        alpha_vantage_min_request_interval_seconds=0,
        redis_url=None,
        simulation_interval_seconds=60,
        history_limit=40,
    )


class AlphaVantageClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_retries_a_per_second_rate_limit_response(self) -> None:
        requests = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal requests
            requests += 1
            if requests == 1:
                return httpx.Response(
                    200,
                    json={"Information": "Please spread out requests to 1 request per second."},
                )
            return httpx.Response(
                200,
                json={
                    "Time Series FX (Daily)": {
                        "2026-08-20": {
                            "1. open": "1.1650",
                            "2. high": "1.1720",
                            "3. low": "1.1620",
                            "4. close": "1.1700",
                        }
                    }
                },
            )

        client = AlphaVantageClient(settings(), transport=httpx.MockTransport(handler))
        try:
            result = await client.get_candles("EURUSD", Timeframe.D1)
        finally:
            await client.close()

        self.assertEqual(requests, 2)
        self.assertAlmostEqual(result.candles[0].close, 1.17)

    async def test_reuses_daily_provider_response_across_requested_timeframes(self) -> None:
        requests = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal requests
            requests += 1
            return httpx.Response(
                200,
                json={
                    "Time Series FX (Daily)": {
                        "2026-08-20": {
                            "1. open": "1.1650",
                            "2. high": "1.1720",
                            "3. low": "1.1620",
                            "4. close": "1.1700",
                        }
                    }
                },
            )

        configured = replace(settings(), alpha_vantage_intraday_enabled=False)
        client = AlphaVantageClient(configured, transport=httpx.MockTransport(handler))
        try:
            hourly = await client.get_candles("EURUSD", Timeframe.H1)
            daily = await client.get_candles("EURUSD", Timeframe.D1)
        finally:
            await client.close()

        self.assertEqual(requests, 1)
        self.assertEqual(hourly.effective_timeframe, Timeframe.D1)
        self.assertEqual(daily.effective_timeframe, Timeframe.D1)

    async def test_builds_live_gmi_from_aligned_spx_and_ndx_provider_bars(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            symbol = request.url.params["symbol"]
            first = 100.0 if symbol == "SPY" else 200.0
            return httpx.Response(
                200,
                json={
                    "Time Series (15min)": {
                        "2026-08-21 10:00:00": {
                            "1. open": str(first * 1.01),
                            "2. high": str(first * 1.03),
                            "3. low": str(first),
                            "4. close": str(first * 1.02),
                            "5. volume": "100",
                        },
                        "2026-08-21 09:45:00": {
                            "1. open": str(first),
                            "2. high": str(first * 1.01),
                            "3. low": str(first * 0.99),
                            "4. close": str(first),
                            "5. volume": "100",
                        },
                    }
                },
            )

        client = AlphaVantageClient(settings(), transport=httpx.MockTransport(handler))
        try:
            result = await client.get_candles("GMI", Timeframe.M15)
        finally:
            await client.close()

        self.assertEqual(result.effective_timeframe, Timeframe.M15)
        self.assertEqual(result.candles[0].close, 1000)
        self.assertEqual(result.candles[1].close, 1020)
        self.assertEqual(result.price_basis, "50/50 normalized SPX and NDX")

    async def test_parses_and_caches_intraday_index_proxy_ohlcv(self) -> None:
        requests = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            self.assertEqual(request.url.params["function"], "TIME_SERIES_INTRADAY")
            self.assertEqual(request.url.params["symbol"], "SPY")
            return httpx.Response(
                200,
                json={
                    "Meta Data": {"6. Time Zone": "US/Eastern"},
                    "Time Series (15min)": {
                        "2026-08-21 10:00:00": {
                            "1. open": "645.0",
                            "2. high": "647.0",
                            "3. low": "644.5",
                            "4. close": "646.5",
                            "5. volume": "1000000",
                        },
                        "2026-08-21 09:45:00": {
                            "1. open": "643.0",
                            "2. high": "645.5",
                            "3. low": "642.5",
                            "4. close": "645.0",
                            "5. volume": "900000",
                        },
                    },
                },
            )

        client = AlphaVantageClient(settings(), transport=httpx.MockTransport(handler))
        try:
            first = await client.get_candles("SPX", Timeframe.M15)
            second = await client.get_candles("SPX", Timeframe.M15)
        finally:
            await client.close()

        self.assertIs(first, second)
        self.assertEqual(len(requests), 1)
        self.assertEqual(first.effective_timeframe, Timeframe.M15)
        self.assertEqual(first.price_basis, "SPY ETF proxy")
        self.assertEqual([item.close for item in first.candles], [645.0, 646.5])
        self.assertEqual(first.candles[0].timestamp.hour, 13)

    async def test_falls_back_from_premium_fx_intraday_to_daily(self) -> None:
        functions = []

        def handler(request: httpx.Request) -> httpx.Response:
            function = request.url.params["function"]
            functions.append(function)
            if function == "FX_INTRADAY":
                return httpx.Response(
                    200,
                    json={"Information": "This is a premium endpoint. Please subscribe."},
                )
            return httpx.Response(
                200,
                json={
                    "Time Series FX (Daily)": {
                        "2026-08-20": {
                            "1. open": "1.1650",
                            "2. high": "1.1720",
                            "3. low": "1.1620",
                            "4. close": "1.1700",
                        }
                    }
                },
            )

        client = AlphaVantageClient(settings(), transport=httpx.MockTransport(handler))
        try:
            result = await client.get_candles("EURUSD", Timeframe.H1)
        finally:
            await client.close()

        self.assertEqual(functions, ["FX_INTRADAY", "FX_DAILY"])
        self.assertEqual(result.effective_timeframe, Timeframe.D1)
        self.assertIn("Intraday entitlement unavailable", result.fallback_reason or "")
        self.assertAlmostEqual(result.candles[0].close, 1.17)

    async def test_normalizes_close_only_daily_commodity_series(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.params["function"], "WTI")
            self.assertEqual(request.url.params["interval"], "daily")
            return httpx.Response(
                200,
                json={
                    "name": "Crude Oil Prices WTI",
                    "data": [
                        {"date": "2026-08-21", "value": "64.72"},
                        {"date": "2026-08-20", "value": "63.90"},
                    ],
                },
            )

        client = AlphaVantageClient(settings(), transport=httpx.MockTransport(handler))
        try:
            result = await client.get_candles("WTI", Timeframe.M15)
        finally:
            await client.close()

        self.assertEqual(result.effective_timeframe, Timeframe.D1)
        self.assertEqual(result.price_basis, "official close-only commodity series")
        self.assertEqual(result.candles[-1].open, result.candles[-1].close)
        self.assertEqual(result.candles[-1].close, 64.72)


if __name__ == "__main__":
    unittest.main()
