import unittest

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


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


if __name__ == "__main__":
    unittest.main()
