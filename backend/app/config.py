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
        default_factory=lambda: ("http://localhost:3000",)
    )
    redis_url: str | None = None
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
        if not self.api_prefix.startswith("/"):
            raise ValueError("API prefix must start with '/'")

    @classmethod
    def from_env(cls) -> "Settings":
        redis_url = os.getenv("GMI_REDIS_URL") or None
        return cls(
            app_name=os.getenv("GMI_APP_NAME", "Global Market Index API"),
            environment=os.getenv("GMI_ENVIRONMENT", "development"),
            api_prefix=os.getenv("GMI_API_PREFIX", "/api/v1"),
            cors_origins=_csv(
                os.getenv("GMI_CORS_ORIGINS", "http://localhost:3000")
            ),
            redis_url=redis_url,
            simulation_interval_seconds=float(
                os.getenv("GMI_SIMULATION_INTERVAL_SECONDS", "1.0")
            ),
            history_limit=int(os.getenv("GMI_HISTORY_LIMIT", "500")),
            random_seed=int(os.getenv("GMI_RANDOM_SEED", "17")),
        )
