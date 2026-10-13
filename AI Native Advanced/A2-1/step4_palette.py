import json
import logging
from typing import Dict, Any
from gemini_service import call_gemini_agent, extract_json_from_response

def run_palette_agent(brief: Dict[str, Any], naming_data: Dict[str, Any], slogan_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    [Agent 3: Visual Identity & Color Strategist]
    브랜드명, 슬로건, 톤앤매너를 종합하여 색채 심리학과 브랜드 무드에 기반한
    최적의 컬러 팔레트(메인, 서브 2~3개, 배경/강조색)를 설계합니다.
    """
    brand_name = naming_data.get("name", "브랜드")
    english_name = naming_data.get("english_name", "")
    main_slogan = slogan_data.get("main_slogan", "")
    
    industry = brief.get("industry") or brief.get("domain", "")
    target = brief.get("target") or brief.get("target_audience", "")
    tone = brief.get("tone", "따뜻하고 신뢰감 있는")
    keywords = brief.get("keywords") or brief.get("core_values", [])
    keywords_str = ", ".join(keywords) if isinstance(keywords, list) else str(keywords)

    context = f"""
    - 브랜드명: {brand_name} ({english_name})
    - 메인 슬로건: {main_slogan}
    - 산업군: {industry}
    - 타깃층: {target}
    - 톤앤매너: {tone}
    - 키워드: {keywords_str}
    """

    instructions = """
    브랜드의 톤앤매너와 슬로건에 완벽하게 부합하는 조화롭고 세련된 컬러 시스템을 구축하세요.
    - 메인 컬러 1개: 브랜드의 핵심 정체성을 나타내는 주색상 (HEX 코드 및 영문 색상명, 선정이유)
    - 서브 컬러 2~3개: 메인 컬러를 보조하고 조화를 이루는 보조 색상들
    - 전체적인 컬러 무드 설명 포함
    """

    schema_desc = """
    {
        "main": {
            "hex": "#HEX코드 (예: #2E5A44)",
            "name": "색상 영문 이름 (예: Deep Forest Sage)",
            "meaning": "메인 컬러가 상징하는 의미 및 심리적 효과"
        },
        "sub": [
            {
                "hex": "#HEX코드 (예: #E3DAC9)",
                "name": "색상 영문 이름 (예: Soft Oat Linen)",
                "meaning": "서브 컬러의 역할 및 의미"
            },
            {
                "hex": "#HEX코드 (예: #8EA89D)",
                "name": "색상 영문 이름 (예: Muted Herb Green)",
                "meaning": "서브 컬러의 역할 및 의미"
            }
        ],
        "mood_description": "전체 컬러 팔레트가 주는 시각적 인상과 감성 요약"
    }
    """

    default_result = {
        "main": {
            "hex": "#2E5A44",
            "name": "Deep Forest Sage",
            "meaning": "자연의 깊은 생명력과 신뢰감을 전달하는 그린 톤"
        },
        "sub": [
            {
                "hex": "#E3DAC9",
                "name": "Soft Oat Linen",
                "meaning": "자연 친화적이고 따뜻하며 편안한 감성을 부여하는 뉴트럴 베이지"
            },
            {
                "hex": "#8EA89D",
                "name": "Muted Herb Green",
                "meaning": "순수함과 허브 성분의 클린 뷰티를 표현하는 은은한 그린"
            }
        ],
        "mood_description": "자연의 편안함과 신뢰를 주는 따뜻하고 정갈한 보태니컬 무드"
    }

    res_text = call_gemini_agent(
        agent_role="Visual Identity & Color Strategist (컬러 및 비주얼 전략가)",
        instructions=instructions,
        context=context,
        response_schema_desc=schema_desc
    )

    if not res_text:
        return default_result

    try:
        parsed = extract_json_from_response(res_text)
        if isinstance(parsed, dict) and "main" in parsed:
            return parsed
        return default_result
    except Exception as e:
        logging.warning(f"[Palette Agent 파싱 오류]: {e}")
        return default_result

# 하위 호환성을 위한 함수
def generate_color_palette(brand_name: str, slogan: str, brand_info: dict = None) -> dict:
    brief = brand_info or {}
    return run_palette_agent(brief, {"name": brand_name}, {"main_slogan": slogan})
