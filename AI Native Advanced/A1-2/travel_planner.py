"""Gemini와 Kakao Local API를 이용한 국내 여행지 추천 CLI."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any



ROOT_DIR = Path(__file__).resolve().parent
RESULTS_DIR = ROOT_DIR / "results"
KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"
DEFAULT_MODEL = "gemini-3.5-flash-lite"


class PlannerError(Exception):
    """사용자에게 안내할 수 있는 프로그램 오류."""


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="여행 날짜를 바탕으로 국내 여행지와 맛집을 추천합니다."
    )
    parser.add_argument(
        "-date",
        "--date",
        required=True,
        dest="travel_date",
        metavar="YYYY-MM-DD",
        help="여행 날짜",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="같은 날짜의 캐시를 무시하고 모든 API 호출을 새로 실행",
    )
    parser.add_argument(
        "--multi-city",
        action="store_true",
        help="2~3개 추천 지역별로 맛집을 검색하는 보너스 모드",
    )
    args = parser.parse_args()
    try:
        travel_date = date.fromisoformat(args.travel_date)
    except ValueError:
        parser.error("날짜는 YYYY-MM-DD 형식이어야 합니다. 예: --date 2026-10-03")
    if travel_date < date.today():
        parser.error(
            f"오늘({date.today().isoformat()}) 이전 날짜는 입력할 수 없습니다. "
            "오늘 또는 미래 날짜를 입력하세요."
        )
    return args


def load_api_keys() -> tuple[str, str]:
    dotenv_path = ROOT_DIR / ".env"
    if dotenv_path.exists():
        for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    kakao_key = os.getenv("KAKAO_REST_API_KEY", "").strip()
    missing = []
    if not gemini_key:
        missing.append("GEMINI_API_KEY")
    if not kakao_key:
        missing.append("KAKAO_REST_API_KEY")
    if missing:
        raise PlannerError(
            "API 키가 설정되지 않았습니다: "
            + ", ".join(missing)
            + "\n프로젝트 루트의 .env 파일에 API 키를 설정하세요."
        )
    return gemini_key, kakao_key


def extract_json(text: str) -> dict[str, Any]:
    """모델이 코드 펜스를 붙여도 JSON 객체만 안전하게 파싱한다."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else ""
        if cleaned.rstrip().endswith("```"):
            cleaned = cleaned.rstrip()[:-3]
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise ValueError("JSON 객체를 찾을 수 없습니다.")
    payload = json.loads(cleaned[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("JSON 객체가 아닙니다.")
    return payload


def validate_recommendation(payload: dict[str, Any], multi_city: bool = False) -> dict[str, Any]:
    required = {
        "recommended_city": str,
        "weather": str,
        "events": list,
        "reason": str,
    }
    for key, expected_type in required.items():
        if not isinstance(payload.get(key), expected_type):
            raise ValueError(f"필수 키 또는 형식이 올바르지 않습니다: {key}")
    if not all(isinstance(event, str) for event in payload["events"]):
        raise ValueError("events는 문자열 배열이어야 합니다.")
    if not 1 <= len(payload["events"]) <= 3:
        raise ValueError("events는 1~3개의 항목이어야 합니다.")
    sentence_count = len([text for text in re.split(r"[.!?]+", payload["reason"]) if text.strip()])
    if not 2 <= sentence_count <= 4:
        raise ValueError("reason은 2~4개의 완결 문장이어야 합니다.")
    if multi_city:
        cities = payload.get("recommended_cities")
        if not isinstance(cities, list) or not 2 <= len(cities) <= 3:
            raise ValueError("recommended_cities는 2~3개 지역 배열이어야 합니다.")
        if not all(isinstance(city, str) and city.strip() for city in cities):
            raise ValueError("recommended_cities는 비어 있지 않은 문자열 배열이어야 합니다.")
        if len(set(cities)) != len(cities):
            raise ValueError("recommended_cities에 중복 지역이 있습니다.")
        if payload["recommended_city"] != cities[0]:
            raise ValueError("recommended_city는 recommended_cities의 첫 번째 지역이어야 합니다.")
    recommendation = {key: payload[key] for key in required}
    if multi_city:
        recommendation["recommended_cities"] = payload["recommended_cities"]
    return recommendation


def create_gemini_client(api_key: str) -> Any:
    try:
        from google import genai
    except ImportError as error:
        raise PlannerError("필수 패키지가 없습니다. `pip install -r requirements.txt`를 실행하세요.") from error
    return genai.Client(api_key=api_key)


def generate_recommendation(
    client: Any, model: str, travel_date: str, multi_city: bool = False
) -> dict[str, Any]:
    from google.genai import types
    city_rule = (
        "recommended_city는 추천 우선순위 1위 지역 하나이고, recommended_cities는 이를 첫 항목으로 포함한 서로 다른 지역 2~3개 배열입니다."
        if multi_city
        else "recommended_city는 도시 또는 지역명 문자열 하나입니다."
    )
    city_schema = ',\n  "recommended_cities": ["제주", "강릉"]' if multi_city else ""
    prompt = f"""
역할: 당신은 국내 여행 추천 도우미입니다.
입력 날짜: {travel_date}

목표: 해당 날짜에 여행하기 좋은 국내 도시 또는 지역을 정확히 한 곳 추천합니다.
실시간 예보나 확정 행사 일정을 조회한 것처럼 말하지 말고, 해당 시기의 일반적인 계절 경향과 행사·축제 후보만 제시하세요.

출력 규칙:
1. 유효한 JSON 객체 하나만 반환합니다. JSON 앞뒤의 설명, Markdown 코드 펜스, 주석은 절대 출력하지 마세요.
2. 키는 recommended_city, weather, events, reason 네 개만 사용하세요.
3. {city_rule}
4. weather는 해당 시기의 일반적인 날씨 경향을 요약한 문자열 하나입니다. 실시간 예보 또는 확정 수치로 단정하지 마세요.
5. events는 행사·축제 후보 문자열 1~3개 배열입니다. 일정이 변동될 수 있음을 각 항목 또는 표현에 반영하세요.
6. reason은 추천 근거를 설명하는 한국어 완결 문장 정확히 2~4개입니다.

반환 형식:
{{
  "recommended_city": "제주",
  "weather": "일반적인 계절 날씨 요약",
  "events": ["행사 또는 축제 후보(일정 변동 가능)"],
  "reason": "완결 문장 2~4개"{city_schema}
}}
""".strip()

    retry_prompt = (
        prompt
        + "\n이전 응답이 검증에 실패했습니다. 키 네 개, events 1~3개, reason 2~4문장 규칙을 정확히 지켜 JSON 객체만 다시 반환하세요."
    )
    last_error: Exception | None = None
    for current_prompt in (prompt, retry_prompt):
        try:
            response = client.models.generate_content(
                model=model,
                contents=current_prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json", temperature=0.4
                ),
            )
            return validate_recommendation(extract_json(response.text or ""), multi_city)
        except Exception as error:  # API/파싱 오류 모두 1회 재시도
            last_error = error
    raise PlannerError(f"LLM 추천 JSON 생성에 실패했습니다: {last_error}")


def generate_multi_recommendations(client: Any, model: str, travel_date: str) -> list[dict[str, Any]]:
    """단일 지역 추천 스키마를 2~3개 지역에 반복 적용한다."""
    from google.genai import types

    prompt = f"""
역할: 당신은 국내 여행 추천 도우미입니다.
입력 날짜: {travel_date}

해당 날짜에 여행하기 좋은 서로 다른 국내 도시 또는 지역 2~3곳을 추천하세요. 각 지역은 독립적인 단일 지역 추천 데이터여야 합니다.
실시간 예보나 확정 행사 일정을 조회한 것처럼 말하지 말고, 계절의 일반적 경향과 행사·축제 후보만 제시하세요.

유효한 JSON 객체 하나만 반환하세요. 설명이나 Markdown 코드 펜스는 출력하지 마세요.
키는 recommendations 하나만 사용하고, recommendations는 2~3개 객체 배열입니다.
배열의 각 객체는 recommended_city, weather, events, reason 네 키를 반드시 가져야 합니다.
- recommended_city: 비어 있지 않은 지역명 문자열
- weather: 해당 지역의 일반적인 계절 날씨 요약 문자열
- events: 해당 지역 행사·축제 후보 문자열 1~3개 배열(일정 변동 가능성을 반영)
- reason: 해당 지역 추천 근거를 설명하는 한국어 완결 문장 2~4개

반환 형식:
{{
  "recommendations": [
    {{
      "recommended_city": "경주",
      "weather": "일반적인 계절 날씨 요약",
      "events": ["행사 또는 축제 후보(일정 변동 가능)"],
      "reason": "완결 문장 2~4개"
    }}
  ]
}}
""".strip()
    retry_prompt = prompt + "\n이전 응답이 검증에 실패했습니다. 지역별 스키마를 정확히 지켜 JSON 객체만 다시 반환하세요."
    last_error: Exception | None = None
    for current_prompt in (prompt, retry_prompt):
        try:
            response = client.models.generate_content(
                model=model,
                contents=current_prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json", temperature=0.4
                ),
            )
            payload = extract_json(response.text or "")
            recommendations = payload.get("recommendations")
            if not isinstance(recommendations, list) or not 2 <= len(recommendations) <= 3:
                raise ValueError("recommendations는 2~3개 지역 배열이어야 합니다.")
            validated = [validate_recommendation(item) for item in recommendations]
            cities = [item["recommended_city"] for item in validated]
            if len(set(cities)) != len(cities):
                raise ValueError("추천 지역이 중복되었습니다.")
            return validated
        except Exception as error:
            last_error = error
    raise PlannerError(f"LLM 복수 지역 추천 JSON 생성에 실패했습니다: {last_error}")


def search_restaurants(kakao_key: str, city: str) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    errors: list[dict[str, str]] = []
    try:
        import requests
    except ImportError:
        return [], [
            {
                "step": "place_search",
                "type": "DEPENDENCY_ERROR",
                "message": "requests 패키지가 없습니다. pip install -r requirements.txt를 실행하세요.",
            }
        ]
    try:
        response = requests.get(
            KAKAO_KEYWORD_URL,
            headers={"Authorization": f"KakaoAK {kakao_key}"},
            params={"query": f"{city} 맛집", "size": 5},
            timeout=10,
        )
        response.raise_for_status()
        documents = response.json().get("documents", [])
        places = [
            {
                "name": item.get("place_name", ""),
                "address": item.get("road_address_name") or item.get("address_name", ""),
                "category": item.get("category_name", ""),
                "url": item.get("place_url", ""),
                "x": float(item["x"]) if item.get("x") else None,
                "y": float(item["y"]) if item.get("y") else None,
            }
            for item in documents
        ]
        if not places:
            errors.append(
                {
                    "step": "place_search",
                    "type": "EMPTY_RESULT",
                    "message": f"0 results for query={city} 맛집",
                }
            )
        return places, errors
    except requests.HTTPError as error:
        status = error.response.status_code if error.response is not None else "unknown"
        errors.append({"step": "place_search", "type": "HTTP_ERROR", "message": f"HTTP {status}"})
    except (requests.RequestException, ValueError) as error:
        errors.append({"step": "place_search", "type": "REQUEST_ERROR", "message": str(error)})
    return [], errors


def create_report(
    client: Any,
    model: str,
    travel_date: str,
    recommendation: dict[str, Any],
    places: list[dict[str, Any]],
    errors: list[dict[str, str]],
) -> str:
    source = json.dumps(
        {"recommendation": recommendation, "restaurants": places, "errors": errors},
        ensure_ascii=False,
        indent=2,
    )
    multi_city = recommendation.get("recommended_cities")
    city_report_rule = (
        "- recommendation.recommended_cities의 모든 지역을 추천 지역에 순서대로 씁니다.\n"
        "- 맛집 추천은 각 도시를 `### 도시명` 소제목으로 나눠 정리합니다. 각 맛집의 city 값으로 도시를 구분하세요.\n"
        "- 1일 일정 제안은 recommended_city(첫 번째 우선 추천 지역)를 기준으로 작성합니다."
        if multi_city
        else "- recommendation.recommended_city를 추천 지역에 그대로 씁니다."
    )
    prompt = f"""
역할: 당신은 국내 여행 리포트 작성 도우미입니다.
아래 입력 데이터만 근거로 한국어 Markdown 리포트를 작성하세요. 입력에 없는 정확한 운영시간, 가격, 확정 축제 일정, 장소 정보는 만들어내지 마세요.

필수 형식과 작성 규칙:
# {travel_date} 국내 여행 추천 리포트

## 추천 지역
{city_report_rule}

## 추천 이유
- recommendation.reason을 2~4문장으로 요약합니다.

## 날씨 요약
- recommendation.weather를 반영하고, 일반적인 계절 경향임을 유지합니다.

## 행사/축제
- recommendation.events의 모든 항목을 글머리표로 씁니다.
- 행사 일정은 변동될 수 있음을 한 줄로 안내합니다.

## 맛집 추천
- restaurants가 비어 있으면 정확히 `- 데이터 없음 (장소 검색 결과 없음)`이라고 씁니다.
- restaurants가 있으면 각 항목을 `- 이름 — 주소 (카테고리)` 형식으로 모두 씁니다. URL이 있으면 Markdown 링크를 덧붙입니다.

## 1일 일정 제안
- 이 섹션은 절대로 `데이터 없음`으로 쓰지 않습니다.
- 오전, 오후, 저녁의 글머리표 세 개를 반드시 작성합니다.
- recommendation.reason에 언급된 관광·산책 요소와 recommendation.events의 후보를 활용합니다.
- restaurants가 2곳 이상이면, 서로 다른 맛집 2곳 이상을 오후와 저녁 일정에 배치합니다.
- restaurants가 1곳이면 그 맛집을 한 번만 사용하고, 다른 식사 시간에는 `식사 장소는 현지에서 확인`이라고 씁니다.
- restaurants가 없으면 두 식사 시간 모두 `식사 장소는 현지에서 확인`이라고 씁니다.

## 오류 요약(errors)
- errors가 빈 배열이면 `- 없음`이라고 씁니다.
- errors가 있으면 각 오류를 `- [step/type] message` 형식으로 모두 씁니다.

입력 데이터:
{source}
""".strip()
    try:
        response = client.models.generate_content(model=model, contents=prompt)
        report = (response.text or "").strip()
        if not report:
            raise ValueError("빈 리포트가 반환되었습니다.")
        return report
    except Exception as error:
        raise PlannerError(f"최종 리포트 생성에 실패했습니다: {error}") from error


def create_multi_report(
    client: Any, model: str, travel_date: str, city_results: list[dict[str, Any]]
) -> str:
    source = json.dumps(city_results, ensure_ascii=False, indent=2)
    prompt = f"""
역할: 당신은 국내 여행 리포트 작성 도우미입니다.
아래 지역별 입력 데이터만 근거로 한국어 Markdown 리포트를 작성하세요. 입력에 없는 정확한 운영시간, 가격, 확정 축제 일정, 장소 정보는 만들지 마세요.

반드시 다음 구조를 사용하세요.
# {travel_date} 국내 여행 추천 리포트 (복수 지역)

각 city_results 항목마다 아래 소제목 묶음을 한 번씩 반복하세요. 모든 추천 지역을 빠짐없이 작성해야 합니다.
## 지역: 지역명
### 추천 이유
### 날씨 요약
### 행사/축제
### 맛집 추천
### 1일 일정 제안

지역별 작성 규칙:
- 추천 이유·날씨·행사/축제는 해당 항목의 recommendation 값만 사용하세요.
- 행사/축제는 모든 항목을 글머리표로 쓰고, 일정 변동 가능성을 안내하세요.
- restaurants가 있으면 각 항목을 `- 이름 — 주소 (카테고리)` 형식으로 모두 쓰고 URL이 있으면 Markdown 링크를 덧붙이세요.
- restaurants가 비어 있으면 `- 데이터 없음 (장소 검색 결과 없음)`이라고 쓰세요.
- 1일 일정 제안은 절대로 `데이터 없음`으로 쓰지 말고, 오전·오후·저녁 글머리표 세 개를 작성하세요.
- 해당 지역 restaurants가 2곳 이상이면 서로 다른 맛집 2곳 이상을 오후와 저녁에 배치하세요. 1곳 이하이면 부족한 식사 시간에는 `식사 장소는 현지에서 확인`이라고 쓰세요.

리포트 마지막에는 다음 섹션을 한 번만 작성하세요.
## 오류 요약(errors)
- 모든 지역의 errors가 비어 있으면 `- 없음`이라고 쓰세요.
- 오류가 있으면 각 오류를 `- [지역명 | step/type] message` 형식으로 모두 쓰세요.

입력 city_results:
{source}
""".strip()
    try:
        response = client.models.generate_content(model=model, contents=prompt)
        report = (response.text or "").strip()
        if not report:
            raise ValueError("빈 리포트가 반환되었습니다.")
        return report
    except Exception as error:
        raise PlannerError(f"최종 복수 지역 리포트 생성에 실패했습니다: {error}") from error


def save_results(
    travel_date: str,
    recommendation: dict[str, Any],
    places: list[dict[str, Any]],
    errors: list[dict[str, str]],
    report: str,
    multi_city: bool = False,
) -> tuple[Path, Path]:
    RESULTS_DIR.mkdir(exist_ok=True)
    json_path, markdown_path = result_paths(travel_date, multi_city)
    raw_data = {
        "request": {"multi_city": multi_city},
        "recommendation": recommendation,
        "restaurants": places,
        "errors": errors,
    }
    json_path.write_text(json.dumps(raw_data, ensure_ascii=False, indent=2), encoding="utf-8")
    markdown_path.write_text(report + "\n", encoding="utf-8")
    return json_path, markdown_path


def save_multi_results(
    travel_date: str, city_results: list[dict[str, Any]], report: str
) -> tuple[Path, Path]:
    RESULTS_DIR.mkdir(exist_ok=True)
    json_path, markdown_path = result_paths(travel_date, multi_city=True)
    raw_data = {"request": {"multi_city": True}, "city_results": city_results}
    json_path.write_text(json.dumps(raw_data, ensure_ascii=False, indent=2), encoding="utf-8")
    markdown_path.write_text(report + "\n", encoding="utf-8")
    return json_path, markdown_path


def result_paths(travel_date: str, multi_city: bool = False) -> tuple[Path, Path]:
    """여행 날짜와 실행 모드에 대응하는 결과 경로를 반환한다."""
    mode = "multi" if multi_city else "single"
    return (
        RESULTS_DIR / f"{travel_date}_{mode}_travel_data.json",
        RESULTS_DIR / f"{travel_date}_{mode}_travel_plan.md",
    )


def load_cached_data(
    travel_date: str, multi_city: bool
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, str]]] | None:
    """유효한 원본 JSON 캐시가 있을 때만 추천·맛집·오류 데이터를 반환한다."""
    json_path, _ = result_paths(travel_date, multi_city)
    if not json_path.exists():
        return None
    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        cached_multi_city = bool(payload.get("request", {}).get("multi_city", False))
        if cached_multi_city != multi_city:
            return None
        recommendation = validate_recommendation(payload["recommendation"], multi_city)
        places = payload["restaurants"]
        errors = payload["errors"]
        if not isinstance(places, list) or not all(isinstance(item, dict) for item in places):
            raise ValueError("restaurants 형식이 올바르지 않습니다.")
        if not isinstance(errors, list) or not all(isinstance(item, dict) for item in errors):
            raise ValueError("errors 형식이 올바르지 않습니다.")
        return recommendation, places, errors
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def load_cached_multi_data(travel_date: str) -> list[dict[str, Any]] | None:
    """복수 지역의 지역별 원본 데이터가 유효할 때만 반환한다."""
    json_path, _ = result_paths(travel_date, multi_city=True)
    if not json_path.exists():
        return None
    try:
        payload = json.loads(json_path.read_text(encoding="utf-8"))
        if not payload.get("request", {}).get("multi_city"):
            return None
        city_results = payload["city_results"]
        if not isinstance(city_results, list) or not 2 <= len(city_results) <= 3:
            return None
        for item in city_results:
            validate_recommendation(item["recommendation"])
            if not isinstance(item["restaurants"], list) or not isinstance(item["errors"], list):
                return None
        return city_results
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def main() -> int:
    args = parse_arguments()
    try:
        gemini_key, kakao_key = load_api_keys()
        model = os.getenv("GEMINI_MODEL", DEFAULT_MODEL)
        json_path, markdown_path = result_paths(args.travel_date, args.multi_city)

        if args.multi_city:
            cached_city_results = None if args.refresh else load_cached_multi_data(args.travel_date)
            if cached_city_results is not None and markdown_path.exists() and markdown_path.read_text(encoding="utf-8").strip():
                print("[cache] 같은 날짜의 복수 지역 결과를 찾았습니다. 외부 API 호출을 건너뜁니다.")
                print(f"완료! {markdown_path.relative_to(ROOT_DIR)} 를 확인하세요.")
                print(f"원본 데이터: {json_path.relative_to(ROOT_DIR)}")
                return 0

            client = create_gemini_client(gemini_key)
            if cached_city_results is None:
                print("[1/3] 복수 지역 추천 생성 중(Gemini)...")
                recommendations = generate_multi_recommendations(client, model, args.travel_date)
                print("  - recommended_cities: " + ", ".join(item["recommended_city"] for item in recommendations))

                print("[2/3] 지역별 맛집 검색 중(Kakao Local)...")
                cached_city_results = []
                for recommendation in recommendations:
                    city = recommendation["recommended_city"]
                    places, errors = search_restaurants(kakao_key, city)
                    cached_city_results.append(
                        {"recommendation": recommendation, "restaurants": places, "errors": errors}
                    )
                    print(f"  - {city}: 맛집 {len(places)}곳" if places else f"  - {city}: 데이터 없음")
            else:
                print("[cache] 복수 지역 원본 JSON을 재사용하고 리포트만 생성합니다.")

            print("[3/3] 지역별 최종 리포트 생성 중(Gemini)...")
            report = create_multi_report(client, model, args.travel_date, cached_city_results)
            json_path, markdown_path = save_multi_results(args.travel_date, cached_city_results, report)
            print("  - 리포트 생성 완료")
            print(f"완료! {markdown_path.relative_to(ROOT_DIR)} 를 확인하세요.")
            print(f"원본 데이터: {json_path.relative_to(ROOT_DIR)}")
            return 0

        cached_data = None if args.refresh else load_cached_data(args.travel_date, multi_city=False)

        if cached_data is not None:
            recommendation, places, errors = cached_data
            if markdown_path.exists() and markdown_path.read_text(encoding="utf-8").strip():
                print("[cache] 같은 날짜의 결과를 찾았습니다. 외부 API 호출을 건너뜁니다.")
                print(f"완료! {markdown_path.relative_to(ROOT_DIR)} 를 확인하세요.")
                print(f"원본 데이터: {json_path.relative_to(ROOT_DIR)}")
                return 0

            print("[cache] 원본 JSON을 재사용하고 리포트만 생성합니다.")
            client = create_gemini_client(gemini_key)
            print("[3/3] 최종 리포트 생성 중(Gemini)...")
            report = create_report(client, model, args.travel_date, recommendation, places, errors)
            _, markdown_path = save_results(
                args.travel_date, recommendation, places, errors, report, multi_city=False
            )
            print("  - 리포트 생성 완료")
            print(f"완료! {markdown_path.relative_to(ROOT_DIR)} 를 확인하세요.")
            print(f"원본 데이터: {json_path.relative_to(ROOT_DIR)}")
            return 0

        client = create_gemini_client(gemini_key)

        print("[1/3] 1차 추천 생성 중(Gemini)...")
        recommendation = generate_recommendation(client, model, args.travel_date)
        print(f'  - recommended_city: "{recommendation["recommended_city"]}"')

        print("[2/3] 맛집 검색 중(Kakao Local)...")
        places, errors = search_restaurants(kakao_key, recommendation["recommended_city"])
        print(f"  - 맛집 {len(places)}곳 검색 완료" if places else "  - 데이터 없음으로 계속 진행합니다.")

        print("[3/3] 최종 리포트 생성 중(Gemini)...")
        report = create_report(client, model, args.travel_date, recommendation, places, errors)
        json_path, markdown_path = save_results(
            args.travel_date, recommendation, places, errors, report, multi_city=False
        )
        print("  - 리포트 생성 완료")
        print(f"완료! {markdown_path.relative_to(ROOT_DIR)} 를 확인하세요.")
        print(f"원본 데이터: {json_path.relative_to(ROOT_DIR)}")
        return 0
    except PlannerError as error:
        print(f"오류: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
