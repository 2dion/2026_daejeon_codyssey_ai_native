# 2026 대전 코디세이 · AI Native

코디세이 AI Native 과정에서 수행한 과제와 프로젝트를 모은 학습 저장소입니다. LLM 비교와 콘텐츠 제작, 업무 자동화, Python·API 활용, 웹 서비스 개발, 데이터 분석과 AI 상담 서비스까지 **Basic → Advanced → Master** 단계별 결과물을 정리합니다.

각 과제 폴더에는 보고서, 소스 코드, 이미지·영상 또는 실행 결과가 들어 있습니다. 과제별 상세 설명과 실행 방법은 아래 문서를 참고하세요.

## 과제 목록

### AI Native Basic

| 과제 | 주제 | 주요 내용 | 문서 |
|---|---|---|---|
| B1-1 | LLM 기반 업무 자동화 | 일본 숙소 문의 이메일 작성 과업을 이용한 LLM 모델 비교·선정 | [비교 보고서](AI%20Native%20Basic/B1-1/B1-1.md) |
| B1-2 | 생성형 AI 영상 제작 | MINI Cooper Electric 브랜드 영상의 스토리보드·씬별 프롬프트·제작 결과 | [스토리보드](AI%20Native%20Basic/B1-2/B1-2.md) |
| B1-3 | 업무 자동화 도구 비교 | Make·Zapier로 Google Sheets의 새 행을 감지하고 키워드에 따라 Discord 알림 분기 | [구현 보고서](AI%20Native%20Basic/B1-3/README.md) |
| B2-1 | AI 기반 UI/UX 디자인 | Term Cafe 주문 앱의 화면 시안, 프롬프트 개선 기록과 HTML 결과물 | [작업 로그](AI%20Native%20Basic/B2-1/README.md) |

### AI Native Advanced

| 과제 | 프로젝트 | 주요 내용 | 문서 |
|---|---|---|---|
| A1-1 | 나만의 프롬프트 관리 | Python 콘솔에서 프롬프트 등록·검색·즐겨찾기, JSON 저장과 Markdown 내보내기 | [README](AI%20Native%20Advanced/A1-1/README.md) |
| A1-2 | 국내 여행지 추천 프로그램 | Gemini로 여행지를 추천하고 Kakao Local로 맛집을 검색해 여행 리포트 생성 | [README](AI%20Native%20Advanced/A1-2/README.md) |
| A1-3 | 커밋구조대 · Commit Rescue | Git 개념 시각화, 상황별 AI 문제 해결 안내와 브라우저 Git 실습실 | [README](AI%20Native%20Advanced/A1-3/README.md) |
| A2-1 | AI 브랜드 아이덴티티 생성기 | 브리프를 바탕으로 네이밍·슬로건·스토리·컬러를 순차 생성하고 PNG 브랜드 보드 제작 | [README](AI%20Native%20Advanced/A2-1/README.md) |

### AI Native Master

| 과제 | 프로젝트 | 주요 내용 | 문서 |
|---|---|---|---|
| M1-1 | 타슈 대여소 자전거 부족 분석 | 대전 공영자전거 대여 이력 정제, 대여소·시간별 분석, 예측과 대시보드 | [README](AI%20Native%20Master/M1-1/README.md) · [최종 리포트](AI%20Native%20Master/M1-1/REPORT.md) |
| M1-2 | 내돈비서 | 가상 소비 데이터 관리, 소비 지표·그래프, 데이터에 근거한 AI 상담과 대화 저장 | [README](AI%20Native%20Master/M1-2/README.md) |

## 폴더 구조

```text
2026_daejeon_codyssey_ai_native/
├── README.md
├── AI Native Basic/
│   ├── B1-1/     # LLM 모델 비교 보고서
│   ├── B1-2/     # 영상 스토리보드와 MP4 결과물
│   ├── B1-3/     # Make·Zapier 자동화 비교 보고서
│   └── B2-1/     # 카페 주문 앱 UI/UX 시안과 HTML
├── AI Native Advanced/
│   ├── A1-1/     # 프롬프트 관리 CLI
│   ├── A1-2/     # 여행지 추천 CLI
│   ├── A1-3/     # 커밋구조대 웹 서비스
│   └── A2-1/     # 브랜드 아이덴티티 생성 파이프라인
└── AI Native Master/
    ├── M1-1/     # 타슈 데이터 분석·리포트·대시보드
    └── M1-2/     # 내돈비서 프론트엔드·백엔드·데이터
```

## 시작하기

이 저장소는 과제별로 독립된 프로젝트를 포함합니다. 실행할 과제의 폴더로 이동한 뒤 해당 README에 따라 의존성과 환경 변수를 설정합니다. 폴더 이름에 공백이 있으므로 터미널에서 경로를 큰따옴표로 감싸세요.

### 프롬프트 관리 프로그램

저장소 루트에서 다음 명령을 실행합니다. 과제 문서 기준 Python 3.10 이상이 필요합니다.

```bash
cd "AI Native Advanced/A1-1"
python3 main.py
```

### 커밋구조대 화면과 실습실

저장소 루트에서 정적 서버를 실행한 뒤 브라우저에서 `http://localhost:3000`을 엽니다.

```bash
cd "AI Native Advanced/A1-3"
python3 -m http.server 3000
```

개념 설명과 정적 안내 카드, 실습실을 확인할 수 있습니다. AI 문제 해결 기능을 포함한 실행은 [A1-3 README](AI%20Native%20Advanced/A1-3/README.md)의 환경 변수와 Vercel 설정을 따릅니다.

### 분석 결과와 다른 프로젝트

- **타슈 분석 결과:** [최종 리포트](AI%20Native%20Master/M1-1/REPORT.md), [용어집](AI%20Native%20Master/M1-1/GLOSSARY.md), [대시보드 HTML](AI%20Native%20Master/M1-1/dashboard.html)을 참고합니다. 원본 데이터 준비와 분석 재현 절차는 M1-1 README에 정리되어 있습니다.
- **여행지 추천:** A1-2 README에 따라 의존성을 설치하고 Gemini·Kakao API 키를 설정합니다. 결과는 해당 폴더의 `results/`에 저장됩니다.
- **브랜드 생성:** A2-1 README에 따라 패키지와 브랜드 브리프를 준비합니다. 결과는 해당 폴더의 `output/`에 저장됩니다.
- **내돈비서:** M1-2 README에 따라 백엔드와 프론트엔드를 각각 실행합니다. Firestore 없이 확인할 때는 메모리 저장소 모드를 사용할 수 있습니다.

## 주요 기술과 도구

| 영역 | 사용 기술·도구 |
|---|---|
| 생성형 AI | Google Gemini, Codyssey OpenAI 호환 API, 이미지·영상 생성 도구 |
| 업무 자동화·디자인 | Make, Zapier, Google Sheets, Discord, Figma Make |
| 프로그래밍·웹 | Python, HTML, CSS, JavaScript, FastAPI, Uvicorn |
| 데이터·시각화 | pandas, Jupyter Notebook, Matplotlib, Pillow, JSON·CSV·Parquet |
| 외부 서비스·배포 | Kakao Local API, Firebase Firestore, Vercel, Render |

## 환경 설정과 데이터 안내

- API 키와 서비스 계정 정보는 각 프로젝트의 환경 변수 또는 로컬 `.env`로 설정합니다. 실제 키를 코드나 문서에 기록하지 않습니다.
- 외부 API가 필요한 프로젝트는 실행 환경과 키 설정에 따라 동작이 달라집니다. 필요한 변수와 실행 조건은 과제별 README를 확인하세요.
- M1-1의 대용량 원본 대여 이력 CSV는 저장소에 포함되지 않으며, 분석을 재현하려면 별도로 준비해야 합니다. 결측·중복 등 데이터 제약도 M1-1 README에 정리되어 있습니다.
- M1-2의 거래 데이터는 **과제용 가상 데이터**입니다. 데이터 구성은 [데이터 안내](AI%20Native%20Master/M1-2/data/README.md)를 참고하세요.
- Basic의 보고서에 담긴 모델 비교와 도구 사용 기록은 해당 과제를 수행한 당시의 결과입니다.
