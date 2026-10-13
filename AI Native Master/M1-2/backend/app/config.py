from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    app_name: str = "내돈비서 API"
    data_backend: str = "firestore"
    firebase_service_account_json: str | None = None
    codyssey_api_key: str | None = None
    codyssey_base_url: str = "https://copa.codyssey.kr/v1"
    codyssey_model: str = "gpt-5.4-mini"
    max_ai_output_tokens: int = 500
    allowed_origins: tuple[str, ...] = ("http://localhost:5173",)


@lru_cache
def get_settings() -> Settings:
    origins = tuple(
        origin.strip()
        for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
        if origin.strip()
    )
    return Settings(
        data_backend=os.getenv("DATA_BACKEND", "firestore").lower(),
        firebase_service_account_json=os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON"),
        codyssey_api_key=os.getenv("CODYSSEY_API_KEY") or os.getenv("OPENAI_API_KEY"),
        codyssey_base_url=os.getenv("CODYSSEY_BASE_URL", "https://copa.codyssey.kr/v1").rstrip("/"),
        codyssey_model=os.getenv("CODYSSEY_MODEL", "gpt-5.4-mini"),
        max_ai_output_tokens=max(50, min(int(os.getenv("MAX_AI_OUTPUT_TOKENS", "500")), 1000)),
        allowed_origins=origins,
    )
