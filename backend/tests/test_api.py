import unittest

import httpx
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.massive import MassiveClient


class ApiContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = Settings(
            redis_url=None,
            simulation_interval_seconds=60,
            history_limit=40,
            random_seed=11,
        )

    def test_snapshot_and_domain_routes_share_one_contract(self) -> None:
        with TestClient(create_app(self.settings)) as client:
            health = client.get("/health")
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json()["status"], "ok")

            assets = client.get("/api/v1/assets").json()
            self.assertEqual(
                [item["symbol"] for item in assets["components"]],
                ["SPX", "IXIC"],
            )
            self.assertFalse(assets["provider"]["configured"])
            self.assertEqual(assets["provider"]["name"], "massive")
            self.assertEqual(assets["live_assets"], [])
            self.assertEqual(
                {item["asset_class"] for item in assets["asset_catalog"]},
                {"index", "commodity"},
            )
            self.assertEqual(
                [item["symbol"] for item in assets["asset_catalog"]],
                [
                    "GMI",
                    "RTY", "ES", "NQ", "YM", "NKD", "RB", "CL", "QM",
                    "HO", "NG", "QG", "GC", "SI", "HG",
                ],
            )

            snapshot = client.get("/api/v1/snapshot").json()
            self.assertIn("GMI", snapshot["prices"])
            self.assertIn("15m", snapshot["composite"])
            self.assertEqual(len(snapshot["pressure"]), 8)
            expected_timeframes = {"15m", "30m", "1h", "4h", "1d"}
            expected_symbols = {"SPX", "IXIC", "GMI"}
            self.assertEqual(
                set(snapshot["zones_by_timeframe"]), expected_timeframes
            )
            for timeframe, zones_by_symbol in snapshot[
                "zones_by_timeframe"
            ].items():
                self.assertEqual(set(zones_by_symbol), expected_symbols)
                for zones_for_symbol in zones_by_symbol.values():
                    self.assertLessEqual(len(zones_for_symbol), 12)
                    self.assertTrue(
                        all(zone["timeframe"] == timeframe for zone in zones_for_symbol)
                    )
            # Keep the original socket contract until the browser adapter moves
            # to the explicit multi-timeframe field.
            self.assertEqual(
                snapshot["zones"], snapshot["zones_by_timeframe"]["15m"]
            )

            candles = client.get(
                "/api/v1/index/candles",
                params={"symbol": "GMI", "timeframe": "15m", "limit": 5},
            ).json()
            self.assertEqual(candles["count"], 5)
            self.assertTrue(
                all(
                    candle["low"]
                    <= min(candle["open"], candle["close"])
                    <= max(candle["open"], candle["close"])
                    <= candle["high"]
                    for candle in candles["candles"]
                )
            )

            alert = client.post(
                "/api/v1/alerts",
                json={
                    "symbol": "GMI",
                    "zone_side": "demand",
                    "mode": "approach",
                    "timeframe": "4h",
                    "threshold_pct": 0.7,
                },
            )
            self.assertEqual(alert.status_code, 201)
            self.assertEqual(alert.json()["timeframe"], "4h")

    def test_websocket_starts_with_a_complete_snapshot(self) -> None:
        with TestClient(create_app(self.settings)) as client:
            with client.websocket_connect("/ws/market") as websocket:
                message = websocket.receive_json()
                self.assertEqual(message["type"], "market.snapshot")
                self.assertGreater(message["data"]["sequence"], 0)
                self.assertIn("GMI", message["data"]["prices"])
                self.assertIn("4h", message["data"]["zones_by_timeframe"])

    def test_imports_csv_history_for_a_custom_asset_and_serves_it_back(self) -> None:
        csv_body = """timestamp,open,high,low,close,volume
2025-01-02T00:00:00Z,100,104,99,103,1200
2025-01-03T00:00:00Z,103,108,102,107,1500
2025-01-03T00:00:00Z,103,109,102,108,1700
"""
        with TestClient(create_app(self.settings)) as client:
            imported = client.post(
                "/api/v1/historical/import",
                params={
                    "symbol": "BRK.B",
                    "name": "Berkshire Hathaway B",
                    "timeframe": "1d",
                    "mode": "replace",
                },
                content=csv_body,
                headers={"Content-Type": "text/csv"},
            )
            self.assertEqual(imported.status_code, 200)
            payload = imported.json()
            self.assertEqual(payload["asset"]["symbol"], "BRK.B")
            self.assertEqual(payload["rows_received"], 3)
            self.assertEqual(payload["rows_deduplicated"], 1)
            self.assertEqual(payload["latest_candle"]["close"], 108)

            assets = client.get("/api/v1/historical/assets")
            self.assertEqual(assets.status_code, 200)
            self.assertEqual(assets.json()["assets"][0]["name"], "Berkshire Hathaway B")

            candles = client.get(
                "/api/v1/index/candles",
                params={"symbol": "BRK.B", "timeframe": "1d", "limit": 10},
            )
            self.assertEqual(candles.status_code, 200)
            self.assertEqual(candles.json()["count"], 2)
            self.assertEqual(candles.json()["candles"][-1]["high"], 109)

    def test_rejects_invalid_historical_ohlc(self) -> None:
        with TestClient(create_app(self.settings)) as client:
            imported = client.post(
                "/api/v1/historical/import",
                params={"symbol": "BAD", "timeframe": "1d"},
                content="timestamp,open,high,low,close\n2025-01-02,10,9,8,11\n",
                headers={"Content-Type": "text/csv"},
            )
            self.assertEqual(imported.status_code, 422)
            self.assertIn("OHLC", imported.json()["detail"])

    def test_serves_massive_futures_through_market_contract(self) -> None:
        live_settings = Settings(
            environment="production",
            massive_api_key="test-key",
            massive_base_url="https://massive.test",
            massive_min_request_interval_seconds=0,
            redis_url=None,
            simulation_interval_seconds=60,
            history_limit=40,
            random_seed=11,
        )

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/futures/v1/contracts":
                return httpx.Response(
                    200,
                    json={
                        "status": "OK",
                        "results": [
                            {
                                "active": True,
                                "product_code": "ES",
                                "ticker": "ESU6",
                                "last_trade_date": "2026-09-18",
                            }
                        ],
                    },
                )
            return httpx.Response(
                200,
                json={
                    "status": "OK",
                    "results": [
                        {
                            "ticker": "ESU6",
                            "window_start": 1787529600000000000,
                            "open": 6500,
                            "high": 6550,
                            "low": 6480,
                            "close": 6535,
                            "volume": 1000,
                        }
                    ],
                },
            )

        massive = MassiveClient(
            live_settings,
            transport=httpx.MockTransport(handler),
        )
        with TestClient(create_app(live_settings, massive_client=massive)) as client:
            self.assertTrue(client.get("/api/v1/assets").json()["live_assets"])
            response = client.get(
                "/api/v1/index/candles",
                params={"symbol": "ES", "timeframe": "1h"},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["requested_timeframe"], "1h")
        self.assertEqual(payload["timeframe"], "1h")
        self.assertEqual(payload["candles"][0]["close"], 6535)
        self.assertEqual(payload["source"]["provider"], "massive")
        self.assertEqual(payload["source"]["provider_symbol"], "ESU6")


if __name__ == "__main__":
    unittest.main()
