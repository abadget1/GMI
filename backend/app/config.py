from __future__ import annotations

import os
from dataclasses import dataclass, field
from math import isfinite


def _csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings, populated from environment variables by default."""

    app_name: str = "Global Market Index API"
    environment: str = "development"
    api_prefix: str = "/api/v1"
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: (
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        )
    )
    redis_url: str | None = None
    alpha_vantage_api_key: str | None = None
    alpha_vantage_base_url: str = "https://www.alphavantage.co/query"
    alpha_vantage_cache_ttl_seconds: float = 21_600.0
    alpha_vantage_daily_request_limit: int = 25
    alpha_vantage_timeout_seconds: float = 12.0
    alpha_vantage_min_request_interval_seconds: float = 1.1
    # Free-tier safe default: daily endpoints only. Intraday is opt-in because
    # it is both quota-expensive and commonly entitlement-limited.
    alpha_vantage_intraday_enabled: bool = False
    twelve_data_api_key: str | None = None
    twelve_data_base_url: str = "https://api.twelvedata.com"
    twelve_data_cache_ttl_seconds: float = 900.0
    twelve_data_timeout_seconds: float = 12.0
    twelve_data_min_request_interval_seconds: float = 0.25
    simulation_interval_seconds: float = 1.0
    history_limit: int = 500
    random_seed: int = 17

    def __post_init__(self) -> None:
        if not isfinite(self.simulation_interval_seconds) or not (
            0.05 <= self.simulation_interval_seconds <= 3_600
        ):
            raise ValueError("simulation interval must be finite and between 0.05 and 3600 seconds")
        if not 20 <= self.history_limit <= 10_000:
            raise ValueError("history limit must be between 20 and 10000")
        if not isfinite(self.alpha_vantage_cache_ttl_seconds) or not (
            15 <= self.alpha_vantage_cache_ttl_seconds <= 86_400
        ):
            raise ValueError("Alpha Vantage cache TTL must be between 15 and 86400 seconds")
        if not 1 <= self.alpha_vantage_daily_request_limit <= 25:
            raise ValueError("Alpha Vantage daily request limit must be between 1 and 25")
        if not isfinite(self.alpha_vantage_timeout_seconds) or not (
            1 <= self.alpha_vantage_timeout_seconds <= 120
        ):
            raise ValueError("Alpha Vantage timeout must be between 1 and 120 seconds")
        if not isfinite(self.alpha_vantage_min_request_interval_seconds) or not (
            0 <= self.alpha_vantage_min_request_interval_seconds <= 60
        ):
            raise ValueError("Alpha Vantage request interval must be between 0 and 60 seconds")
        if not self.alpha_vantage_base_url.startswith(("https://", "http://")):
            raise ValueError("Alpha Vantage base URL must be HTTP(S)")
        if not self.api_prefix.startswith("/"):
            raise ValueError("API prefix must start with '/'")

    @classmethod
    def from_env(cls) -> "Settings":
        redis_url = os.getenv("GMI_REDIS_URL") or None
        alpha_vantage_api_key = os.getenv("GMI_ALPHA_VANTAGE_API_KEY") or None
        twelve_data_api_key = os.getenv("GMI_TWELVE_DATA_API_KEY") or None
        return cls(
            app_name=os.getenv("GMI_APP_NAME", "Global Market Index API"),
            environment=os.getenv("GMI_ENVIRONMENT", "development"),
            api_prefix=os.getenv("GMI_API_PREFIX", "/api/v1"),
            cors_origins=_csv(
                os.getenv(
                    "GMI_CORS_ORIGINS",
                    "http://localhost:3000,http://127.0.0.1:3000",
                )
            ),
            redis_url=redis_url,
            alpha_vantage_api_key=alpha_vantage_api_key,
            alpha_vantage_base_url=os.getenv(
                "GMI_ALPHA_VANTAGE_BASE_URL",
                "https://www.alphavantage.co/query",
            ),
            alpha_vantage_cache_ttl_seconds=float(
                os.getenv("GMI_ALPHA_VANTAGE_CACHE_TTL_SECONDS", "21600")
            ),
            alpha_vantage_daily_request_limit=int(
                os.getenv("GMI_ALPHA_VANTAGE_DAILY_REQUEST_LIMIT", "25")
            ),
            alpha_vantage_timeout_seconds=float(
                os.getenv("GMI_ALPHA_VANTAGE_TIMEOUT_SECONDS", "12")
            ),
            alpha_vantage_min_request_interval_seconds=float(
                os.getenv("GMI_ALPHA_VANTAGE_MIN_REQUEST_INTERVAL_SECONDS", "1.1")
            ),
            alpha_vantage_intraday_enabled=os.getenv(
                "GMI_ALPHA_VANTAGE_INTRADAY_ENABLED", "false"
            ).strip().casefold()
            not in {"0", "false", "no", "off"},
            twelve_data_api_key=twelve_data_api_key,
            twelve_data_base_url=os.getenv(
                "GMI_TWELVE_DATA_BASE_URL", "https://api.twelvedata.com"
            ),
            twelve_data_cache_ttl_seconds=float(
                os.getenv("GMI_TWELVE_DATA_CACHE_TTL_SECONDS", "900")
            ),
            twelve_data_timeout_seconds=float(
                os.getenv("GMI_TWELVE_DATA_TIMEOUT_SECONDS", "12")
            ),
            twelve_data_min_request_interval_seconds=float(
                os.getenv("GMI_TWELVE_DATA_MIN_REQUEST_INTERVAL_SECONDS", "0.25")
            ),
            simulation_interval_seconds=float(
                os.getenv("GMI_SIMULATION_INTERVAL_SECONDS", "1.0")
            ),
            history_limit=int(os.getenv("GMI_HISTORY_LIMIT", "500")),
            random_seed=int(os.getenv("GMI_RANDOM_SEED", "17")),
        )
