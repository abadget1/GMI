import unittest
from dataclasses import replace

import httpx

from app.config import Settings
from app.domain import Timeframe
from app.massive import MassiveClient, MassiveEntitlementError


def settings() -> Settings:
    return Settings(
        massive_api_key="test-key",
        massive_base_url="https://massive.test",
        massive_cache_ttl_seconds=60,
        massive_contract_cache_ttl_seconds=60,
        massive_timeout_seconds=2,
        massive_min_request_interval_seconds=0,
    )


class MassiveClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolves_active_contract_and_normalizes_nanosecond_bars(self) -> None:
        calls: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            self.assertEqual(request.url.params["apiKey"], "test-key")
            if request.url.path == "/futures/v1/contracts":
                self.assertEqual(request.url.params["product_code"], "ES")
                self.assertEqual(request.url.params["active"], "true")
                return httpx.Response(
                    200,
                    json={
                        "status": "OK",
                        "results": [
                            {
                                "active": True,
                                "product_code": "ES",
                                "ticker": "ESZ6",
                                "last_trade_date": "2026-12-18",
                            },
                            {
                                "active": True,
                                "product_code": "ES",
                                "ticker": "ESU6",
                                "last_trade_date": "2026-09-18",
                            },
                        ],
                    },
                )
            self.assertEqual(request.url.path, "/futures/v1/aggs/ESU6")
            self.assertEqual(request.url.params["resolution"], "15min")
            return httpx.Response(
                200,
                json={
                    "status": "OK",
                    "results": [
                        {
                            "ticker": "ESU6",
                            "window_start": 1787530500000000000,
                            "open": 6510,
                            "high": 6525,
                            "low": 6505,
                            "close": 6520,
                            "volume": 125,
                        },
                        {
                            "ticker": "ESU6",
                            "window_start": 1787529600000000000,
                            "open": 6500,
                            "high": 6515,
                            "low": 6495,
                            "close": 6510,
                            "volume": 100,
                        },
                    ],
                },
            )

        client = MassiveClient(settings(), transport=httpx.MockTransport(handler))
        try:
            result = await client.get_candles("ES", Timeframe.M15, 2)
            cached = await client.get_candles("ES", Timeframe.M15, 2)
        finally:
            await client.close()

        self.assertIs(result, cached)
        self.assertEqual(result.provider_symbol, "ESU6")
        self.assertEqual([item.close for item in result.candles], [6510, 6520])
        self.assertEqual(result.candles[0].timestamp.isoformat(), "2026-08-24T00:00:00+00:00")
        self.assertEqual(len(calls), 2)

    async def test_builds_gmi_from_aligned_es_and_nq_futures(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/futures/v1/contracts":
                root = request.url.params["product_code"]
                return httpx.Response(
                    200,
                    json={
                        "status": "OK",
                        "results": [
                            {
                                "active": True,
                                "product_code": root,
                                "ticker": f"{root}U6",
                                "last_trade_date": "2026-09-18",
                            }
                        ],
                    },
                )
            root = "ES" if request.url.path.endswith("ESU6") else "NQ"
            base = 6500 if root == "ES" else 24000
            return httpx.Response(
                200,
                json={
                    "status": "OK",
                    "results": [
                        {
                            "ticker": f"{root}U6",
                            "window_start": 1787529600000000000,
                            "open": base,
                            "high": base * 1.02,
                            "low": base * 0.99,
                            "close": base * 1.01,
                            "volume": 100,
                        }
                    ],
                },
            )

        client = MassiveClient(settings(), transport=httpx.MockTransport(handler))
        try:
            result = await client.get_candles("GMI", Timeframe.D1, 1)
        finally:
            await client.close()

        self.assertEqual(result.provider_symbol, "ESU6+NQU6")
        self.assertAlmostEqual(result.candles[0].close, 1000)
        self.assertEqual(result.candles[0].volume, 200)

    async def test_surfaces_entitlement_errors(self) -> None:
        client = MassiveClient(
            replace(settings(), massive_api_key="denied"),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    403, json={"status": "ERROR", "error": "not entitled"}
                )
            ),
        )
        try:
            with self.assertRaises(MassiveEntitlementError):
                await client.get_candles("GC", Timeframe.D1, 2)
        finally:
            await client.close()


if __name__ == "__main__":
    unittest.main()
