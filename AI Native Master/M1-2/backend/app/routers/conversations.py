from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status

from ..dependencies import get_repository
from ..models import ConversationCreate, ConversationResponse
from ..repositories import Repository

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


@router.post("", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
def create_conversation(payload: ConversationCreate, repository: Repository = Depends(get_repository)):
    title = (payload.title or payload.messages[0].content[:40]).strip()
    return repository.create_conversation(title, [message.model_dump() for message in payload.messages])


@router.get("")
def list_conversations(repository: Repository = Depends(get_repository)):
    items = repository.list_conversations()
    return {"items": items, "total": len(items)}


@router.get("/{document_id}", response_model=ConversationResponse)
def get_conversation(document_id: str, repository: Repository = Depends(get_repository)):
    conversation = repository.get_conversation(document_id)
    if not conversation:
        raise HTTPException(status_code=404, detail="대화를 찾을 수 없습니다.")
    return conversation


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(document_id: str, repository: Repository = Depends(get_repository)):
    if not repository.delete_conversation(document_id):
        raise HTTPException(status_code=404, detail="대화를 찾을 수 없습니다.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

