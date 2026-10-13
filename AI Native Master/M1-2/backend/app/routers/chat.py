from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..config import Settings, get_settings
from ..dependencies import get_repository
from ..models import ChatRequest, ChatResponse, TokenUsage
from ..repositories import Repository
from ..services.ai import AIServiceError, generate_advice
from ..services.analytics import calculate_statistics, compact_summary
from ..services.guardrails import out_of_scope_response, prompt_injection_response
from ..services.local_answers import try_local_answer

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    repository: Repository = Depends(get_repository),
    settings: Settings = Depends(get_settings),
):
    transactions = repository.list_transactions()
    if not transactions:
        raise HTTPException(status_code=400, detail="먼저 소비 데이터를 등록해주세요.")

    conversation = None
    recent_messages: list[dict] = []
    if payload.conversation_id:
        conversation = repository.get_conversation(payload.conversation_id)
        if not conversation:
            raise HTTPException(status_code=404, detail="대화를 찾을 수 없습니다.")
        recent_messages = conversation.get("messages", [])

    answer = (
        prompt_injection_response(payload.message)
        or out_of_scope_response(payload.message, bool(recent_messages))
        or try_local_answer(payload.message, transactions)
    )
    if answer is not None:
        source = "local"
        usage = TokenUsage().model_dump()
    else:
        summary = compact_summary(calculate_statistics(transactions))
        try:
            result = await generate_advice(settings, payload.message, summary, recent_messages)
        except AIServiceError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        answer = result.answer
        source = "ai"
        usage = result.token_usage

    user_message = {"role": "user", "content": payload.message, "created_at": _now(), "source": None, "token_usage": None}
    assistant_message = {
        "role": "assistant",
        "content": answer,
        "created_at": _now(),
        "source": source,
        "token_usage": usage,
    }
    if conversation:
        stored = repository.append_conversation_messages(conversation["id"], [user_message, assistant_message])
    else:
        stored = repository.create_conversation(payload.message.strip()[:40], [user_message, assistant_message])
    if not stored:
        raise HTTPException(status_code=500, detail="대화 저장에 실패했습니다.")

    return ChatResponse(
        answer=answer,
        conversation_id=stored["id"],
        source=source,
        token_usage=TokenUsage(**usage),
    )
