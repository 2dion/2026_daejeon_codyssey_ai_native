import json
import logging
from typing import Dict, Any
from gemini_service import call_gemini_agent, extract_json_from_response

def run_slogan_agent(brief: Dict[str, Any], naming_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    [Agent 2: Creative Copywriter & Brand Storyteller]
    확정된 브랜드명과 브리프 정보를 전달받아,
    마음을 사로잡는 메인 슬로건, 서브 슬로건, 브랜드 스토리를 도출합니다.
    """
    brand_name = naming_data.get("name", "브랜드")
    english_name = naming_data.get("english_name", "")
    naming_reason = naming_data.get("reason", "")
    
    industry = brief.get("industry") or brief.get("domain", "")
    target = brief.get("target") or brief.get("target_audience", "")
    tone = brief.get("tone", "따뜻하고 감성적인")
    notes = brief.get("notes") or brief.get("description", "")
    keywords = brief.get("keywords") or brief.get("core_values", [])
    keywords_str = ", ".join(keywords) if isinstance(keywords, list) else str(keywords)

    context = f"""
    - 브랜드명: {brand_name} ({english_name})
    - 네이밍 컨셉 및 이유: {naming_reason}
    - 산업 분야: {industry}
    - 타깃 고객: {target}
    - 톤앤매너: {tone}
    - 핵심 키워드: {keywords_str}
    - 브랜드 메모: {notes}
    """

    instructions = """
    주어진 브랜드명과 컨셉에 어울리는 감각적이고 기억하기 쉬운 슬로건과 브랜드 스토리를 작성하세요.
    1. 메인 슬로건: 브랜드의 핵심 가치를 압축한 1줄 카피 (10~20자 내외)
    2. 서브 슬로건: 실천적 가치와 차별점을 보여주는 보조 카피
    3. 브랜드 스토리: 타깃 고객에게 전하는 진정성 있는 2~3문장의 짧은 스토리
    """

    schema_desc = """
    {
        "main_slogan": "감각적인 메인 슬로건 (예: 피부가 숨 쉬는 자연의 순수한 약속)",
        "sub_slogan": "서브 슬로건 (예: 지속 가능한 내일을 위한 클린 뷰티 루틴)",
        "brand_story": "브랜드가 세상에 전하고자 하는 가치를 담은 2~3문장의 감성 스토리",
        "core_message": "브랜드의 궁극적인 핵심 메시지 1문장"
    }
    """

    default_result = {
        "main_slogan": f"자연 그대로의 순수함, {brand_name}",
        "sub_slogan": "지속 가능한 아름다움을 전하는 일상의 동반자",
        "brand_story": f"{brand_name}은 자연과 사람이 조화롭게 공존하는 건강한 라이프스타일을 제안합니다. 정직한 성분과 지속 가능한 방식으로 당신의 일상에 순수한 생명력을 채워드립니다.",
        "core_message": "순수한 자연의 생명력으로 완성하는 건강한 아름다움"
    }

    res_text = call_gemini_agent(
        agent_role="Brand Copywriter & Storyteller (브랜드 카피라이터)",
        instructions=instructions,
        context=context,
        response_schema_desc=schema_desc
    )

    if not res_text:
        return default_result

    try:
        parsed = extract_json_from_response(res_text)
        if isinstance(parsed, dict) and "main_slogan" in parsed:
            return parsed
        return default_result
    except Exception as e:
        logging.warning(f"[Slogan Agent 파싱 오류]: {e}")
        return default_result

# 하위 호환성을 위한 함수
def generate_slogan(brand_name: str, brand_info: dict) -> str:
    res = run_slogan_agent(brand_info, {"name": brand_name})
    return res.get("main_slogan", f"자연과 함께하는 {brand_name}")
