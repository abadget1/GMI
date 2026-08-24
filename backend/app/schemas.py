from __future__ import annotations

from pydantic import BaseModel, Field

from .domain import AlertMode, Timeframe, ZoneSide


class AlertRuleCreate(BaseModel):
    symbol: str = Field(min_length=1, max_length=20, examples=["GMI"])
    zone_side: ZoneSide
    mode: AlertMode
    timeframe: Timeframe = Timeframe.M15
    threshold_pct: float = Field(default=0.5, ge=0, le=25)
    zone_id: str | None = None
    enabled: bool = True
    cooldown_seconds: int = Field(default=300, ge=0, le=86_400)


class AlertEvaluationRequest(BaseModel):
    symbol: str = Field(min_length=1, max_length=20)
    current_price: float = Field(gt=0)
    previous_price: float | None = Field(default=None, gt=0)
    timeframe: Timeframe = Timeframe.M15
