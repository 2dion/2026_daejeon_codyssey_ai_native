import os
import sys
import json
import logging
import argparse
from typing import Dict, Any

# Windows 콘솔 인코딩 대응
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from step2_name import run_naming_agent
from step3_slogan import run_slogan_agent
from step4_palette import run_palette_agent
from step5_image import generate_brand_identity_board

def find_input_file(specified_path: str = None) -> str:
    """터미널에서 지정된 파일 또는 기본 브리프 파일의 경로를 탐색합니다."""
    if specified_path and os.path.exists(specified_path):
        return specified_path

    # 기본 탐색 후보들
    default_candidates = [
        "brief.json",
        os.path.join("input", "brief.json"),
        os.path.join("input", "brand_source.json")
    ]
    for path in default_candidates:
        if os.path.exists(path):
            return path

    if specified_path:
        raise FileNotFoundError(f"입력 파일 '{specified_path}'을(를) 찾을 수 없습니다.")
    else:
        raise FileNotFoundError("기본 입력 파일(brief.json 또는 input/brand_source.json)을 찾을 수 없습니다.")

def normalize_brief(raw_data: Dict[str, Any]) -> Dict[str, Any]:
    """다양한 형식의 브리프 JSON 키를 표준화합니다."""
    industry = raw_data.get("industry") or raw_data.get("domain") or "친환경 비즈니스"
    target = raw_data.get("target") or raw_data.get("target_audience") or "20-30대"
    
    keywords = raw_data.get("keywords") or raw_data.get("core_values") or []
    if isinstance(keywords, str):
        keywords = [k.strip() for k in keywords.split(",")]
        
    tone = raw_data.get("tone") or "신뢰감 있고 모던한"
    competitors = raw_data.get("competitors") or []
    if isinstance(competitors, str):
        competitors = [c.strip() for c in competitors.split(",")]
        
    notes = raw_data.get("notes") or raw_data.get("description") or ""

    return {
        "industry": industry,
        "target": target,
        "keywords": keywords,
        "tone": tone,
        "competitors": competitors,
        "notes": notes
    }

def run_multi_agent_pipeline(input_path: str, output_dir: str = "output"):
    """
    LLM 멀티 에이전트 시스템을 실행하여 브리프 분석부터 최종 산출물 생성까지 수행합니다.
    """
    print("\n" + "=" * 65)
    print(" [LLM Multi-Agent Brand Identity Pipeline] 시작")
    print("=" * 65)

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # 1. Step 1: 브리프 파일 로드
    print(f"\n[Step 1] 브리프 데이터 로드: {input_path}")
    with open(input_path, "r", encoding="utf-8") as f:
        raw_brief = json.load(f)
    
    brief = normalize_brief(raw_brief)
    print(f"  * 산업/분야 : {brief['industry']}")
    print(f"  * 타깃 고객 : {brief['target']}")
    print(f"  * 핵심 키워드 : {', '.join(brief['keywords']) if brief['keywords'] else 'N/A'}")
    print(f"  * 톤앤매너   : {brief['tone']}")
    if brief['competitors']:
        print(f"  * 경쟁사     : {', '.join(brief['competitors'])}")

    # 2. Step 2: Naming Agent 실행
    print("\n" + "-" * 65)
    print("[Step 2] Naming Specialist Agent 호출 중...")
    namings = run_naming_agent(brief)
    primary_naming = namings[0] if namings else {
        "name": "에코베라", "english_name": "EcoVera", "reason": "자연 친화적 브랜드"
    }
    
    print(f"  -> 선정된 메인 브랜드명: {primary_naming.get('name')} ({primary_naming.get('english_name')})")
    print(f"     컨셉 및 이유: {primary_naming.get('reason')}")
    if len(namings) > 1:
        alt_naming = namings[1]
        print(f"  -> 서브 후보 브랜드명: {alt_naming.get('name')} ({alt_naming.get('english_name')})")

    # 3. Step 3: Slogan & Storytelling Agent 실행
    print("\n" + "-" * 65)
    print("[Step 3] Slogan & Storytelling Agent 호출 중...")
    slogan_info = run_slogan_agent(brief, primary_naming)
    print(f"  -> 메인 슬로건 : \"{slogan_info.get('main_slogan')}\"")
    print(f"  -> 서브 슬로건 : {slogan_info.get('sub_slogan')}")
    print(f"  -> 브랜드 스토리 : {slogan_info.get('brand_story')}")

    # 4. Step 4: Color Palette Agent 실행
    print("\n" + "-" * 65)
    print("[Step 4] Color Palette & Visual Strategist Agent 호출 중...")
    palette_info = run_palette_agent(brief, primary_naming, slogan_info)
    main_c = palette_info.get("main", {})
    print(f"  -> 메인 컬러 : {main_c.get('hex')} ({main_c.get('name')})")
    print(f"     의미 : {main_c.get('meaning')}")
    
    sub_c_list = palette_info.get("sub", [])
    for idx, sub_c in enumerate(sub_c_list, 1):
        if isinstance(sub_c, dict):
            print(f"  -> 서브 컬러 {idx}: {sub_c.get('hex')} ({sub_c.get('name')}) - {sub_c.get('meaning')}")
    if palette_info.get("mood_description"):
        print(f"  -> 컬러 무드 : {palette_info.get('mood_description')}")

    # 5. Step 5: Visual Board Generation Agent 실행
    print("\n" + "-" * 65)
    print("[Step 5] Visual Identity Board Rendering Agent 실행 중...")
    
    brand_aggregate_data = {
        "name": primary_naming.get("name"),
        "english_name": primary_naming.get("english_name"),
        "reason": primary_naming.get("reason"),
        "industry": brief["industry"],
        "target": brief["target"],
        "tone": brief["tone"],
        "keywords": brief["keywords"],
        "slogan_info": slogan_info,
        "color_palette": palette_info
    }

    image_bytes = generate_brand_identity_board(brand_aggregate_data)
    print(f"  -> 브랜드 시각화 보드 이미지 생성 완료 ({len(image_bytes)} bytes)")

    # 6. Step 6: 통합 결과 저장
    print("\n" + "-" * 65)
    print("[Step 6] 산출물 저장 중...")

    final_result_data = {
        "brief": brief,
        "selected_naming": primary_naming,
        "all_naming_candidates": namings,
        "slogan_and_story": slogan_info,
        "color_palette": palette_info
    }

    json_path = os.path.join(output_dir, "brand_result.json")
    img_path = os.path.join(output_dir, "brand_identity.png")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(final_result_data, f, indent=4, ensure_ascii=False)

    with open(img_path, "wb") as f:
        f.write(image_bytes)

    print(f"  [OK] JSON 결과 파일: {json_path}")
    print(f"  [OK] 이미지 결과 파일: {img_path}")
    print("\n" + "=" * 65)
    print(" [LLM Multi-Agent Brand Pipeline] 실행이 성공적으로 완료되었습니다!")
    print("=" * 65 + "\n")

def main():
    parser = argparse.ArgumentParser(description="LLM Multi-Agent Brand Identity Pipeline")
    parser.add_argument("brief_file", nargs="?", default=None, help="브리프 JSON 파일 경로 (예: brief.json)")
    parser.add_argument("--output", "-o", default="output", help="산출물 저장 디렉토리 (기본값: output)")

    args = parser.parse_args()

    try:
        input_file = find_input_file(args.brief_file)
        run_multi_agent_pipeline(input_file, args.output)
    except Exception as e:
        print(f"\n[오류 발생]: {e}", file=sys.stderr)
        sys.exit(1)


#====================================

if __name__ == "__main__":
    main()

#====================================