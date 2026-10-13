import json
import logging
from typing import Dict, Any, List
from gemini_service import call_gemini_agent, extract_json_from_response

def run_naming_agent(brief: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    [Agent 1: Naming Specialist]
    브랜드 브리프(산업, 타깃, 키워드, 톤앤매너, 경쟁사 등)를 분석하여
    독창적이고 기억에 남는 브랜드 네이밍 후보 2개를 기획합니다.
    """
    industry = brief.get("industry") or brief.get("domain", "친환경 비즈니스")
    target = brief.get("target") or brief.get("target_audience", "2030 세대")
    keywords = brief.get("keywords") or brief.get("core_values", ["지속가능성", "품질"])
    tone = brief.get("tone", "신뢰감 있고 모던한")
    competitors = brief.get("competitors", [])
    notes = brief.get("notes") or brief.get("description", "")

    keywords_str = ", ".join(keywords) if isinstance(keywords, list) else str(keywords)
    competitors_str = ", ".join(competitors) if isinstance(competitors, list) else str(competitors)

    context = f"""
    - 산업/분야: {industry}
    - 타깃 고객: {target}
    - 핵심 키워드: {keywords_str}
    - 톤앤매너: {tone}
    - 주요 경쟁사: {competitors_str}
    - 추가 정보 및 브랜드 메모: {notes}
    """

    instructions = """
    주어진 브리프를 깊이 있게 분석하여, 경쟁사와 차별화되면서 타깃 고객의 마음에 강한 울림을 주는 브랜드 네이밍 후보 2개를 제안하세요.
    - 한글명과 영문명을 함께 표기할 것
    - 네이밍에 담긴 철학과 어원, 타깃과의 연결성을 설득력 있게 설명할 것
    """

    schema_desc = """
    [
        {
            "name": "브랜드 한글명 (예: 순수담)",
            "english_name": "브랜드 영문명 (예: Soonsoodam)",
            "reason": "네이밍 선정 이유 및 브랜드 철학/컨셉 설명",
            "keywords": ["연상키워드1", "연상키워드2"]
        },
        {
            "name": "두 번째 브랜드 한글명",
            "english_name": "두 번째 영문명",
            "reason": "선정 이유 및 컨셉",
            "keywords": ["연상키워드1", "연상키워드2"]
        }
    ]
    """

    default_result = [
        {
            "name": "순수그린",
            "english_name": "PureGreen",
            "reason": f"{industry} 분야에서 {target}을 위한 자연 친화적 가치를 담은 네이밍",
            "keywords": ["자연", "순수", "신뢰"]
        },
        {
            "name": "보타닉베라",
            "english_name": "BotanicVera",
            "reason": "식물성 성분의 진정성과 진실함을 상징하는 프리미엄 네이밍",
            "keywords": ["비건", "생명력", "클린"]
        }
    ]

    res_text = call_gemini_agent(
        agent_role="Brand Naming Specialist (브랜드 네이밍 전문가)",
        instructions=instructions,
        context=context,
        response_schema_desc=schema_desc
    )

    if not res_text:
        return default_result

    try:
        parsed = extract_json_from_response(res_text)
        if isinstance(parsed, list) and len(parsed) > 0:
            return parsed
        elif isinstance(parsed, dict) and "namings" in parsed:
            return parsed["namings"]
        return default_result
    except Exception as e:
        logging.warning(f"[Naming Agent 파싱 오류]: {e}")
        return default_result

# 하위 호환성을 위한 함수
def generate_brand_name(brand_info: dict) -> dict:
    candidates = run_naming_agent(brand_info)
    return candidates[0] if candidates else {}
