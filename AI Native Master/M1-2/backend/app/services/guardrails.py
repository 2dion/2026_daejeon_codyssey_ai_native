from __future__ import annotations

import re


_INJECTION_PATTERNS = (
    re.compile(r"(이전|앞선|위의).{0,16}(지시|명령|규칙).{0,16}(무시|잊어|따르지)", re.IGNORECASE),
    re.compile(r"(시스템|개발자).{0,12}(프롬프트|메시지|지침).{0,16}(출력|공개|보여|알려)", re.IGNORECASE),
    re.compile(r"\b(ignore|disregard|forget)\b.{0,24}\b(previous|above|system|developer)\b.{0,24}\b(instruction|prompt|message)s?\b", re.IGNORECASE),
    re.compile(r"\b(jailbreak|developer mode|do anything now)\b", re.IGNORECASE),
    re.compile(r"\b(role|역할)\s*[:=]\s*(system|developer|시스템|개발자)\b", re.IGNORECASE),
)

_FINANCE_TERMS = (
    "소비", "지출", "수입", "소득", "돈", "금액", "거래", "결제", "카드", "현금",
    "예산", "저축", "절약", "생활비", "재정", "재무", "잔액", "월세", "주거비",
    "식비", "카페", "간식", "교통비", "교육비", "취업비", "면접비", "자격증비",
    "통신비", "구독료", "의류비", "의료비", "여가비", "고정비", "필수소비",
    "선택소비", "엥겔", "소비성향", "카테고리", "거래내역", "가계부",
)
_PERIOD_PATTERN = re.compile(r"(20\d{2}[년./ -]*)?(1[0-2]|0?[1-9])월|이번\s*달|지난\s*달|최근|전체\s*기간")
_PERIOD_ANALYSIS_TERMS = ("어때", "평가", "분석", "비교", "흐름", "추세", "늘", "줄")
_CONTEXT_FOLLOWUP_PATTERNS = (
    re.compile(r"^(왜|그럼|그러면|그건|이건|더\s*자세히)[?!.\s]*$"),
    re.compile(r"(어떻게\s*(줄|아끼|개선)|비교해|더\s*알려|구체적으로)"),
)

OUT_OF_SCOPE_MESSAGE = "내돈비서는 소비·수입·예산 등 개인 재정 데이터에 관한 질문만 답변할 수 있습니다."


def prompt_injection_response(message: str) -> str | None:
    normalized = " ".join(message.split())
    if any(pattern.search(normalized) for pattern in _INJECTION_PATTERNS):
        return "보안상 시스템 지침을 변경하거나 공개하는 요청은 처리할 수 없습니다. 소비 데이터에 관한 질문을 해주세요."
    return None


def out_of_scope_response(message: str, has_conversation_context: bool = False) -> str | None:
    normalized = " ".join(message.lower().split())
    compact = normalized.replace(" ", "")
    if any(term in compact for term in _FINANCE_TERMS):
        return None
    if _PERIOD_PATTERN.search(normalized) and any(term in compact for term in _PERIOD_ANALYSIS_TERMS):
        return None
    if has_conversation_context and any(pattern.search(normalized) for pattern in _CONTEXT_FOLLOWUP_PATTERNS):
        return None
    return OUT_OF_SCOPE_MESSAGE
