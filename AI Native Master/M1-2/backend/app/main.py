from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import chat, conversations, data

settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    description="취업준비생 소비 데이터를 분석하고 맞춤형 답변을 제공하는 API",
    version="1.0.0",
)

allow_all = "*" in settings.allowed_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all else list(settings.allowed_origins),
    allow_credentials=not allow_all,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(data.router)
app.include_router(conversations.router)
app.include_router(chat.router)


@app.get("/", tags=["health"])
def root():
    return {"service": "내돈비서 API", "docs": "/docs", "status": "ok"}


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "data_backend": settings.data_backend}

