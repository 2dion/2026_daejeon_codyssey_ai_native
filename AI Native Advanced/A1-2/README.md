# 국내 여행지 추천 프로그램

Gemini API로 여행 날짜에 맞는 국내 여행지를 추천받고, Kakao Local API로 해당 지역의 맛집을 검색해 Markdown 리포트를 만드는 Python CLI 프로그램입니다.

## 준비

- Python 3.10 이상
- Gemini API 키
- Kakao Developers의 REST API 키

```bash
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
```

프로젝트 루트의 `.env`를 열어 발급받은 키를 입력합니다.

```env
GEMINI_API_KEY=발급받은_제미나이_키
KAKAO_REST_API_KEY=카카오_플랫폼_키_화면의_Default_Rest_API_Key
GEMINI_MODEL=gemini-3.5-flash-lite
```

키는 코드, README, 결과물, Git 저장소에 직접 기록하지 마세요. `.env`는 `.gitignore`에 포함되어 있습니다.

## 실행

```bash
python travel_planner.py --date "2026-10-03"
```

`-date`도 같은 방식으로 사용할 수 있습니다.

```bash
python travel_planner.py -date "2026-10-03"
```

## 보너스: 복수 지역 추천

`--multi-city`를 사용하면 Gemini가 우선순위가 있는 2~3개 지역을 추천하고, 각 지역의 맛집을 검색해 리포트를 지역별로 정리합니다.

```bash
python travel_planner.py --date "2026-10-03" --multi-city
```

## 결과 캐싱

같은 요청을 반복할 때 API 사용량을 줄이기 위해 결과를 `results/`에 캐시합니다. 캐시 기준은 **여행 날짜와 실행 모드**입니다. 따라서 같은 날짜라도 단일 지역과 복수 지역 결과는 서로 덮어쓰지 않고 별도 캐시를 사용합니다.

- 해당 모드의 JSON과 Markdown 파일이 모두 있으면 Gemini와 Kakao API를 호출하지 않고 기존 결과를 즉시 표시합니다.
- JSON만 있고 Markdown이 없으면, 저장된 추천·맛집 데이터를 재사용하고 최종 리포트만 다시 생성합니다.
- `--refresh`를 지정하면 같은 모드의 캐시를 무시하고 API를 다시 호출한 뒤 결과를 갱신합니다.

```bash
# 단일 지역 캐시 사용
python travel_planner.py --date "2026-10-03"

# 복수 지역 캐시 사용(단일 지역 캐시와 별개)
python travel_planner.py --date "2026-10-03" --multi-city

# 복수 지역 결과를 새로 생성해 갱신
python travel_planner.py --date "2026-10-03" --multi-city --refresh
```

이전 버전에서 생성된 접미사 없는 결과 파일(`YYYY-MM-DD_travel_...`)은 새 캐시로 사용하지 않습니다. 새로 실행하면 아래의 `single` 또는 `multi` 파일명이 생성됩니다.

## 결과물

단일 지역 실행하면 `results/`에 다음 파일이 생성됩니다.

- `YYYY-MM-DD_single_travel_data.json`: 1차 Gemini 추천 결과, Kakao 맛집 결과, 오류 요약
- `YYYY-MM-DD_single_travel_plan.md`: 최종 Gemini 여행 리포트

복수 지역 실행하면 아래 파일을 별도로 생성합니다.

- `YYYY-MM-DD_multi_travel_data.json`: 지역별 추천 결과, 지역별 맛집 결과, 지역별 오류 요약
- `YYYY-MM-DD_multi_travel_plan.md`: 지역별 추천 이유·날씨·행사·맛집·1일 일정이 포함된 리포트

맛집 검색이 인증·네트워크·쿼터 오류로 실패해도, 맛집을 `데이터 없음`으로 처리하고 리포트 생성은 계속합니다. Gemini가 첫 추천에서 JSON을 올바르게 반환하지 않으면 JSON 전용 요청으로 한 번만 재시도합니다.

## API 흐름

1. Gemini가 날짜를 받아 JSON(`recommended_city`, `weather`, `events`, `reason`)으로 추천합니다.
2. Kakao Local 키워드 검색 API가 `{추천 지역} 맛집`을 검색합니다.
3. Gemini가 두 데이터를 조합해 Markdown 리포트를 생성합니다.
