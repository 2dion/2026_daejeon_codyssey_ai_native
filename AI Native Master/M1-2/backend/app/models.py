from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

TransactionType = Literal["income", "expense"]
IncomeCategory = Literal["아르바이트", "용돈"]
ExpenseCategory = Literal[
    "주거",
    "식비",
    "카페·간식",
    "교통",
    "교육·취업",
    "통신",
    "구독",
    "생활",
    "의류",
    "의료",
    "여가",
]
Category = Literal[
    "아르바이트",
    "용돈",
    "주거",
    "식비",
    "카페·간식",
    "교통",
    "교육·취업",
    "통신",
    "구독",
    "생활",
    "의류",
    "의료",
    "여가",
]

INCOME_CATEGORIES = {"아르바이트", "용돈"}
EXPENSE_CATEGORIES = {
    "주거",
    "식비",
    "카페·간식",
    "교통",
    "교육·취업",
    "통신",
    "구독",
    "생활",
    "의류",
    "의료",
    "여가",
}


class TransactionInput(BaseModel):
    date: date
    value: int = Field(gt=0, le=1_000_000_000)
    memo: str = Field(min_length=1, max_length=200)
    type: TransactionType
    category: Category
    is_fixed: bool = False
    is_essential: bool = False

    @model_validator(mode="after")
    def validate_category_for_type(self) -> "TransactionInput":
        if self.type == "income" and self.category not in INCOME_CATEGORIES:
            raise ValueError("수입에는 아르바이트 또는 용돈 카테고리만 사용할 수 있습니다.")
        if self.type == "expense" and self.category not in EXPENSE_CATEGORIES:
            raise ValueError("지출에는 소비 카테고리를 사용해야 합니다.")
        if self.type == "income" and (self.is_fixed or self.is_essential):
            raise ValueError("수입의 고정비·필수소비 값은 false여야 합니다.")
        return self


class TransactionResponse(TransactionInput):
    id: str
    created_at: str
    updated_at: str


class TokenUsage(BaseModel):
    ai_calls: int = 0
    prompt_tokens: int | None = 0
    completion_tokens: int | None = 0
    total_tokens: int | None = 0
    measurement: Literal["not_used", "provider", "estimated", "unavailable"] = "not_used"


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=10_000)
    created_at: str | None = None
    source: Literal["local", "ai"] | None = None
    token_usage: TokenUsage | None = None


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=100)
    messages: list[Message] = Field(min_length=1, max_length=200)


class ConversationResponse(BaseModel):
    id: str
    title: str
    messages: list[Message]
    created_at: str
    updated_at: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    conversation_id: str | None = None


class ChatResponse(BaseModel):
    answer: str
    conversation_id: str
    source: Literal["local", "ai"]
    token_usage: TokenUsage
