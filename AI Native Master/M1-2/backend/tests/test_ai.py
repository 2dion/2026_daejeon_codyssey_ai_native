import asyncio
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.services.ai import AIServiceError, generate_advice


def test_ai_uses_configured_output_budget(monkeypatch):
    captured = {}

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=self)

        async def create(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="소비를 잘 관리하고 있습니다."), finish_reason="stop")],
                usage=SimpleNamespace(prompt_tokens=100, completion_tokens=25, total_tokens=125),
            )

    monkeypatch.setattr("app.services.ai.AsyncOpenAI", FakeClient)
    result = asyncio.run(
        generate_advice(
            Settings(codyssey_api_key="test-key", max_ai_output_tokens=300),
            "소비 습관을 평가해줘",
            {"expense_total": 100_000},
            [],
        )
    )

    assert result.answer == "소비를 잘 관리하고 있습니다."
    assert captured["max_tokens"] == 300
    assert "reasoning_effort" not in captured
    assert "verbosity" not in captured


def test_empty_ai_answer_is_reported_as_error(monkeypatch):
    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=self)

        async def create(self, **kwargs):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=""), finish_reason="length")],
                usage=SimpleNamespace(prompt_tokens=100, completion_tokens=300, total_tokens=400),
            )

    monkeypatch.setattr("app.services.ai.AsyncOpenAI", FakeClient)

    with pytest.raises(AIServiceError, match="출력 한도"):
        asyncio.run(
            generate_advice(
                Settings(codyssey_api_key="test-key", max_ai_output_tokens=300),
                "소비 습관을 평가해줘",
                {"expense_total": 100_000},
                [],
            )
        )
