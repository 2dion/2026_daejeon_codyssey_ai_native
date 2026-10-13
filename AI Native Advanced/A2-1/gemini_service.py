import os
import json
import logging
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

load_dotenv()

# 우선 순위 모델 목록 (안정성 및 속도 최적화)
CANDIDATE_MODELS = [
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-flash-latest',
    'gemini-3.7-flash'
]

def get_gemini_client():
    """
    Gemini API 키를 확인하고 Client 객체를 생성하여 반환합니다.
    """
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return None
    try:
        from google import genai
        return genai.Client(api_key=api_key)
    except ImportError:
        return None

def extract_json_from_response(text: str) -> Any:
    """Gemini 응답 문자열에서 마크다운 코드블록을 제거하고 순수 JSON 객체로 파싱합니다."""
    text_clean = text.strip()
    if text_clean.startswith("```"):
        text_clean = text_clean.split("```")[1]
        if text_clean.startswith("json"):
            text_clean = text_clean[4:]
        text_clean = text_clean.strip()
    return json.loads(text_clean)

def call_gemini_agent(
    agent_role: str,
    instructions: str,
    context: str,
    response_schema_desc: Optional[str] = None
) -> Optional[str]:
    """
    특정 에이전트의 역할과 지시사항(System Prompt)을 부여하여 Gemini 모델을 호출합니다.
    """
    client = get_gemini_client()
    if not client:
        logging.warning("Gemini Client를 초기화할 수 없습니다. (API Key 확인 필요)")
        return None

    full_prompt = f"""
[에이전트 역할: {agent_role}]
당신은 최고의 전문성을 가진 {agent_role}입니다. 아래 지시사항과 컨텍스트를 분석하여 최선의 결과를 도출하세요.

[지시사항]
{instructions}

[입력 컨텍스트]
{context}
"""
    if response_schema_desc:
        full_prompt += f"""
[응답 형식 가이드]
반드시 다른 설명 없이 아래 JSON 포맷에 정확히 맞춰서 순수 JSON 문자열만 출력해 주세요.
{response_schema_desc}
"""

    last_error = None
    for model_name in CANDIDATE_MODELS:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=full_prompt,
            )
            if response and response.text:
                return response.text
        except Exception as e:
            last_error = e
            logging.warning(f"[{agent_role} - {model_name} 호출 실패, 다음 모델로 재시도]: {e}")
            continue

    logging.error(f"[{agent_role}] 모든 Gemini 모델 호출 실패: {last_error}")
    return None
