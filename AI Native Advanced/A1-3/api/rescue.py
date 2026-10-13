"""
api/rescue.py — 상황 기반 Git 수습 계획 생성 (기획서 3장 / 6장)

Vercel Serverless Function (Python). 요청마다 실행되고 응답 후 종료되는 무상태 구조다.
API 키는 이 파일 안에서만 os.environ으로 읽는다. 프론트엔드나 응답에는 절대 포함하지 않는다.

의존성 없이 표준 라이브러리(urllib)만으로 Gemini REST API를 호출한다.
"""

import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

# ---------------------------------------------------------------- 상수

GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)
# 무료 등급 한도가 가장 여유로운 Flash 계열 (기획서 5.1절).
#
# 모델은 조용히 은퇴한다. 처음에 gemini-2.5-flash 로 고정했더니 배포 후
# "This model is no longer available to new users" 404 가 떴다.
# 그때 원인을 못 찾은 이유는 서버가 상류 오류를 감추기만 하고 로그를 남기지
# 않아서였다. 지금은 502가 나면 상태 코드와 본문을 런타임 로그에 남기고,
# 404면 쓸 수 있는 모델 목록까지 함께 찍는다 (_log_upstream_error 참고).
#
# 버전을 바꾸려면 코드를 고치지 말고 GEMINI_MODEL 환경 변수로 덮어쓴다.
#
# Lite 를 쓰는 이유: 이 작업은 정해진 스키마의 칸을 채우는 일이다.
# thinkingLevel 을 minimal 로 둔 것도 같은 이유다. 무료 등급 한도가 더 넉넉하고
# 응답도 빨라 20초 타임아웃에 여유가 생긴다.
DEFAULT_MODEL = "gemini-3.5-flash-lite"
REQUEST_TIMEOUT = 18                 # 프론트 타임아웃(20초)보다 짧게 둔다

MAX_SITUATION = 1000
MIN_SITUATION = 5
MAX_COMMAND = 300
MAX_LONG_FIELD = 1000
MAX_STEPS = 8

# 프론트(js/graph-templates.js)와 반드시 같은 목록이어야 한다.
ALLOWED_TEMPLATES = {
    "amend-add-file",
    "amend-message",
    "restore-staged",
    "restore-worktree",
    "revert-pushed",
    "reset-soft",
    "non-fast-forward",
    "fetch-updates-origin",
    "wrong-branch",
    "none",
}

ALLOWED_AREAS = {"work", "staging", "local", "origin-tracking", "remote"}

# ---------------------------------------------------------------- 명령어 검사
#
# 이 서비스는 "복사해서 터미널에 붙여넣으세요"가 전부다. 사용자는 그렇게 하도록
# 길들여진다. 그러니 사람이 실행할 문자열이 가장 엄격해야 하는데, 영역·위험도·
# 템플릿만 허용 목록으로 막고 cmd 는 길이만 자르고 있었다.
#
# 입력 네 칸(상황·실행한 명령·오류 메시지·status 결과)은 그대로 프롬프트에 들어간다.
# 누가 인젝션 문구가 섞인 텍스트를 "이거 붙여넣어 봐" 하고 건네면 모델이 엉뚱한
# 명령을 첫 단계로 내놓을 수 있고, 화면에는 얌전한 <code> 로 보인다.
# 위험 게이트도 방어가 못 된다. 게이트를 여는 위험도를 정하는 것이 같은 모델이라
# "안전"으로 내놓으면 그냥 열린다.

# 자리 표시자. git switch <브랜치> 처럼 꺾쇠를 정상적으로 쓴다.
# 셸에서는 리다이렉션 기호이므로, 먼저 걷어낸 뒤 나머지에서 꺾쇠를 금지한다.
PLACEHOLDER_RE = re.compile(r"<[^<>\s;|&$`\\]{1,40}>")

# 붙여넣었을 때 다른 명령을 실행시킬 수 있는 글자들
SHELL_METACHARS = ";|&$`\\\n\r<>"

# git 자신이 외부 명령을 실행하는 통로. `git ` 으로 시작해도 이건 막아야 한다.
GIT_EXEC_OPTIONS = (
    "--upload-pack", "--receive-pack", "--exec",
    "sshcommand", "core.pager", "core.editor", "gpg.program", "alias.",
    "filter.", "difftool", "mergetool",
)

# git 의 전역 옵션 -c / --config-env 는 하위 명령 앞에만 온다.
#   git -c core.pager='sh -c id' log   ← 막아야 하는 것
#   git switch -c <브랜치>              ← 새 작업본 만들기. 막으면 안 된다
# 그냥 "-c " 를 substring 으로 찾으면 둘을 구분하지 못한다.
GIT_GLOBAL_CONFIG_RE = re.compile(r"^git\s+(-c|--config-env)\b")


class UnsafeCommand(Exception):
    pass


def assert_safe_command(cmd):
    """AI가 내놓은 명령어 한 줄이 붙여넣어도 되는 것인지 본다.

    통과 조건은 좁게 잡는다. 이 서비스가 안내하는 것은 git 명령뿐이고,
    넓히면 넓힌 만큼 그대로 공격면이 된다.
    """
    if not cmd.startswith("git ") and cmd != "git":
        raise UnsafeCommand("git 명령이 아님: %r" % cmd[:80])

    stripped = PLACEHOLDER_RE.sub("", cmd)
    for ch in SHELL_METACHARS:
        if ch in stripped:
            raise UnsafeCommand("셸 특수문자 %r 포함: %r" % (ch, cmd[:80]))

    lowered = cmd.lower()
    if GIT_GLOBAL_CONFIG_RE.match(lowered):
        raise UnsafeCommand("git 전역 설정 주입: %r" % cmd[:80])
    for opt in GIT_EXEC_OPTIONS:
        if opt in lowered:
            raise UnsafeCommand("실행 통로 옵션 %r 포함: %r" % (opt, cmd[:80]))

ALLOWED_RISK = {"안전", "주의", "위험"}
ALLOWED_WHERE = {"local", "저장소관계", "네트워크인증", "github정책", "판단불가"}

SECRET_PATTERNS = [
    # github_pat_ 는 gh[pousr]_ 에 걸리지 않는다. GitHub이 fine-grained 토큰을
    # 기본으로 밀고 있어 이 형태가 더 흔해질 것이므로 따로 잡는다.
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{16,}"),
    re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"),
    re.compile(r"AIza[0-9A-Za-z_\-]{20,}"),
    # Google 이 발급하는 새 형식. AIza 패턴에 걸리지 않는다.
    # 지금 이 서비스가 쓰는 키부터 이 형태라, 사용자가 자기 Gemini 키를
    # 폼에 붙여넣으면 그대로 AI 로 넘어가고 있었다.
    re.compile(r"\bAQ\.[A-Za-z0-9_\-]{20,}"),
    re.compile(r"glpat-[0-9A-Za-z_\-]{16,}"),
    re.compile(r"xox[baprs]-[0-9A-Za-z\-]{10,}"),
    re.compile(r"https?://[^\s:@]+:[^\s@]+@"),
]

# ---------------------------------------------------------------- 프롬프트

SYSTEM_PROMPT = """당신은 Git 입문자를 돕는 한국어 도우미 "커밋구조대"입니다.
사용자가 겪은 상황을 읽고, 수습 명령어와 그 명령이 바꾸는 영역을 함께 설명합니다.

반드시 지켜야 할 규칙입니다.

1. 첫 단계는 항상 `git status`입니다. 사용자가 상황을 잘못 설명했을 가능성을 이 단계가 걸러줍니다.
2. `checkout`이 아니라 `switch` / `restore`를 제시합니다.
   - 브랜치 이동: `git switch <브랜치>` (생성 후 이동은 `git switch -c <브랜치>`)
   - add 취소: `git restore --staged <파일>`
   - 마지막 커밋 상태로 파일 되돌리기: `git restore --source=HEAD -- <파일>`
   - 주의: `git restore <파일>`의 기본 소스는 HEAD가 아니라 index(스테이징)입니다.
     이미 add한 파일에 이 명령을 쓰면 아무 일도 없는 것처럼 보입니다. 필요하면 이 함정을 주의사항에 적으세요.
3. 기본 브랜치는 `main`으로 가정합니다. 사용자가 `master`라고 명시한 경우만 예외입니다.
4. 이미 원격에 올라간 커밋은 `revert`로 처리합니다. `reset`이나 강제 푸시를 권하지 않습니다.
   push 여부가 `unknown`이면 먼저 확인 방법(`git log --oneline origin/main..main`)을 안내하고,
   확정 전에는 되돌릴 수 없는 명령을 제안하지 않습니다.
5. 각 명령마다 변경영역과 유지영역을 모두 적습니다. "무엇이 바뀌지 않는가"가 초보자에게 더 중요합니다.
   영역 값은 정확히 이 다섯 가지만 씁니다: work(작업 폴더), staging(스테이징), local(로컬 main),
   origin-tracking(로컬에 있는 origin/main 기록), remote(GitHub의 main).
   - `git fetch`는 origin-tracking만 바꿉니다. work와 local은 바꾸지 않습니다.
   - `git commit`은 remote를 절대 바꾸지 않습니다.
   - `git push`는 remote와 origin-tracking을 함께 바꿉니다.
6. 확인된 사실과 추정을 구분합니다. 사용자가 입력하지 않은 정보는 절대 확정으로 서술하지 않습니다.
   상황요약은 "~로 보입니다" 어투를 씁니다.
7. 커밋 ID나 그래프를 직접 만들지 않습니다. 그래프가 필요하면 아래 목록에서 하나를 고르고,
   맞는 것이 없으면 반드시 "none"을 반환합니다.
   amend-add-file, amend-message, restore-staged, restore-worktree, revert-pushed,
   reset-soft, non-fast-forward, fetch-updates-origin, wrong-branch, none
8. `git reflog`를 안내할 때는 "이동하거나 삭제된 커밋"을 찾는 데 유용하지만
   한 번도 커밋하지 않은 파일 변경은 복구해주지 못한다는 점을 함께 적습니다.
9. 되돌릴 수 없는 명령(`reset --hard`, 강제 푸시, `clean -fd` 등)이 포함되면 위험도를 "위험"으로 둡니다.
10. Git과 무관한 질문이면 관련없음을 true로 두고 나머지는 비웁니다.

설명은 초보자가 읽는다고 가정하고 짧고 구체적으로 씁니다. 명령어는 최대 8단계까지만 제시합니다."""

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "관련없음": {"type": "boolean"},
        "상황요약": {"type": "string"},
        "근거구분": {
            "type": "object",
            "properties": {
                "확인됨": {"type": "array", "items": {"type": "string"}},
                "추정": {"type": "array", "items": {"type": "string"}},
                "추가확인": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["확인됨", "추정", "추가확인"],
        },
        "위험도": {"type": "string", "enum": ["안전", "주의", "위험"]},
        "오류위치": {
            "type": "string",
            "enum": ["local", "저장소관계", "네트워크인증", "github정책", "판단불가"],
        },
        "명령어": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "cmd": {"type": "string"},
                    "설명": {"type": "string"},
                    "변경영역": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["work", "staging", "local", "origin-tracking", "remote"],
                        },
                    },
                    "유지영역": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["work", "staging", "local", "origin-tracking", "remote"],
                        },
                    },
                },
                "required": ["cmd", "설명", "변경영역", "유지영역"],
            },
        },
        "주의사항": {"type": "array", "items": {"type": "string"}},
        "그래프템플릿": {
            "type": "string",
            "enum": sorted(ALLOWED_TEMPLATES),
        },
    },
    "required": [
        "관련없음",
        "상황요약",
        "근거구분",
        "위험도",
        "오류위치",
        "명령어",
        "주의사항",
        "그래프템플릿",
    ],
}

PUSH_LABEL = {"yes": "예, 이미 push했습니다", "no": "아니요, 아직 push하지 않았습니다",
              "unknown": "모르겠습니다"}
LEVEL_LABEL = {"beginner": "완전 처음 (용어부터 풀어서 설명해주세요)",
               "intermediate": "기본은 압니다 (add/commit/push는 써봤습니다)"}


def build_user_prompt(data):
    lines = ["[어떤 상황인가요]", data["situation"]]

    if data["executedCommand"]:
        lines += ["", "[실행한 명령]", data["executedCommand"]]
    if data["errorMessage"]:
        lines += ["", "[오류 메시지]", data["errorMessage"]]
    if data["statusOutput"]:
        lines += ["", "[git status 결과]", data["statusOutput"]]

    lines += ["", "[이미 push했나요]", PUSH_LABEL.get(data["alreadyPushed"], "모르겠습니다")]
    lines += ["", "[설명 수준]", LEVEL_LABEL.get(data["level"], LEVEL_LABEL["beginner"])]
    lines += [
        "",
        "위 정보만으로 판단하세요. 적혀 있지 않은 것은 추정으로 표시하고, "
        "확인이 필요한 것은 추가확인에 넣으세요.",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- 검증 / 정규화

class InvalidInput(Exception):
    pass


def clean_str(value, limit):
    if value is None:
        return ""
    if not isinstance(value, str):
        raise InvalidInput("입력 형식이 올바르지 않습니다.")
    return value.strip()[:limit]


def parse_request(raw):
    try:
        body = json.loads(raw.decode("utf-8"))
    except Exception:
        raise InvalidInput("요청 형식이 올바르지 않습니다.")
    if not isinstance(body, dict):
        raise InvalidInput("요청 형식이 올바르지 않습니다.")

    situation = clean_str(body.get("situation"), MAX_SITUATION + 1)
    if len(situation) < MIN_SITUATION:
        raise InvalidInput("상황 설명이 너무 짧습니다. 조금만 더 자세히 적어주세요.")
    if len(situation) > MAX_SITUATION:
        raise InvalidInput("1,000자 이내로 줄여주세요.")

    data = {
        "situation": situation,
        "executedCommand": clean_str(body.get("executedCommand"), MAX_COMMAND),
        "errorMessage": clean_str(body.get("errorMessage"), MAX_LONG_FIELD),
        "statusOutput": clean_str(body.get("statusOutput"), MAX_LONG_FIELD),
        "alreadyPushed": body.get("alreadyPushed") if body.get("alreadyPushed") in PUSH_LABEL else "unknown",
        "level": body.get("level") if body.get("level") in LEVEL_LABEL else "beginner",
    }

    joined = "\n".join(
        [data["situation"], data["executedCommand"], data["errorMessage"], data["statusOutput"]]
    )
    for pattern in SECRET_PATTERNS:
        if pattern.search(joined):
            raise InvalidInput("API 키나 토큰으로 보이는 값이 있습니다. 지우고 보내주세요.")

    return data


def normalize_response(payload):
    """AI 응답을 화면이 신뢰할 수 있는 형태로 정규화한다.

    허용 목록에 없는 값은 조용히 안전한 기본값으로 바꾼다.
    (기획서 6장: 그래프템플릿이 목록에 없으면 서버가 none으로 치환한다.)
    """
    if not isinstance(payload, dict):
        raise ValueError("dict가 아님")

    if payload.get("관련없음") is True:
        return {
            "관련없음": True,
            "상황요약": "",
            "근거구분": {"확인됨": [], "추정": [], "추가확인": []},
            "위험도": "안전",
            "오류위치": "판단불가",
            "명령어": [],
            "주의사항": [],
            "그래프템플릿": "none",
        }

    def str_list(value, limit=8):
        if not isinstance(value, list):
            return []
        return [str(v).strip() for v in value if isinstance(v, (str, int, float))][:limit]

    evidence = payload.get("근거구분") or {}
    if not isinstance(evidence, dict):
        evidence = {}

    steps = []
    for raw_step in (payload.get("명령어") or [])[:MAX_STEPS]:
        if not isinstance(raw_step, dict):
            continue
        cmd = str(raw_step.get("cmd", "")).strip()
        if not cmd:
            continue
        # 걸리면 그 단계만 빼지 않고 응답 전체를 버린다.
        # 1번을 빼고 2·3번만 남기면 순서가 끊긴 계획이 되는데,
        # 그 상태로 실행하는 쪽이 더 위험하다.
        assert_safe_command(cmd)
        changed = [a for a in (raw_step.get("변경영역") or []) if a in ALLOWED_AREAS]
        kept = [a for a in (raw_step.get("유지영역") or []) if a in ALLOWED_AREAS and a not in changed]
        steps.append(
            {
                "cmd": cmd[:200],
                "설명": str(raw_step.get("설명", "")).strip()[:400],
                "변경영역": changed,
                "유지영역": kept,
            }
        )

    template = payload.get("그래프템플릿")
    if template not in ALLOWED_TEMPLATES:
        template = "none"

    risk = payload.get("위험도")
    if risk not in ALLOWED_RISK:
        risk = "주의"

    where = payload.get("오류위치")
    if where not in ALLOWED_WHERE:
        where = "판단불가"

    return {
        "관련없음": False,
        "상황요약": str(payload.get("상황요약", "")).strip()[:300],
        "근거구분": {
            "확인됨": str_list(evidence.get("확인됨")),
            "추정": str_list(evidence.get("추정")),
            "추가확인": str_list(evidence.get("추가확인")),
        },
        "위험도": risk,
        "오류위치": where,
        "명령어": steps,
        "주의사항": str_list(payload.get("주의사항"), limit=5),
        "그래프템플릿": template,
    }


# ---------------------------------------------------------------- Gemini 호출

class UpstreamError(Exception):
    def __init__(self, status, code, message, retry_after=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.retry_after = retry_after


def _safe_read(exc):
    """HTTPError 본문을 안전하게 읽는다. 읽지 못해도 예외를 던지지 않는다."""
    try:
        return exc.read().decode("utf-8", "replace")[:500]
    except Exception:
        return "(본문을 읽지 못함)"


def _log_upstream_error(status, body, model):
    """Vercel 런타임 로그로만 나간다. 사용자 응답에는 절대 포함하지 않는다."""
    key = os.environ.get("GEMINI_API_KEY") or ""
    if key:
        body = body.replace(key, "***")   # 혹시라도 본문에 키가 반향되면 가린다
    print("[gemini] status=%s model=%s body=%s" % (status, model, body), flush=True)
    if status == 404:
        print("[gemini] 사용 가능한 모델: %s" % _list_models(), flush=True)


def _list_models():
    """404(모델 없음)일 때만 호출한다. 이 키로 쓸 수 있는 모델 이름을 로그에 남긴다."""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return "(키 없음)"
    try:
        req = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
            headers={"x-goog-api-key": key},
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode("utf-8"))
        names = [
            m.get("name", "").replace("models/", "")
            for m in data.get("models", [])
            if "generateContent" in (m.get("supportedGenerationMethods") or [])
        ]
        return ", ".join(sorted(names)) or "(없음)"
    except Exception as exc:
        return "조회 실패: %r" % (exc,)


def _extract_text(parsed):
    """응답에서 진짜 답변 텍스트만 꺼낸다.

    parts[0] 을 그대로 쓰면 안 된다. Gemini 3 계열은 사고 과정(thought) 파트를
    먼저 넣기 때문에, 첫 파트를 집으면 JSON이 아닌 것을 파싱하게 된다.
    """
    candidates = parsed.get("candidates") or []
    if not candidates:
        raise ValueError("candidates 없음: %s" % json.dumps(parsed, ensure_ascii=False)[:300])

    first = candidates[0]
    parts = (first.get("content") or {}).get("parts") or []
    for part in parts:
        if part.get("thought"):        # 사고 과정 파트는 건너뛴다
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            return text

    raise ValueError(
        "본문 파트 없음 (finishReason=%s, parts=%d)"
        % (first.get("finishReason"), len(parts))
    )


def _log_parse_error(raw, exc, model):
    """응답 형식이 어긋났을 때만 로그를 남긴다. 사용자 응답에는 포함하지 않는다."""
    key = os.environ.get("GEMINI_API_KEY") or ""
    snippet = raw if isinstance(raw, str) else str(raw)
    if key:
        snippet = snippet.replace(key, "***")
    finish = "?"
    try:
        finish = (json.loads(snippet).get("candidates") or [{}])[0].get("finishReason", "?")
    except Exception:
        pass
    print("[gemini] parse_error model=%s finishReason=%s reason=%r raw=%s"
          % (model, finish, exc, snippet[:700]), flush=True)


def call_gemini(user_prompt):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        # 키가 없는 것은 서버 설정 문제다. 원인을 사용자에게 노출하지 않는다.
        raise UpstreamError(500, "SERVER_ERROR", "일시적인 문제가 발생했습니다.")

    # `.get(키, 기본값)`은 환경 변수가 **빈 문자열**일 때 기본값을 쓰지 않는다.
    # .env.example 을 그대로 복사하면 GEMINI_MODEL 이 빈 값이 되므로 반드시 or 로 받는다.
    model = os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL
    url = GEMINI_ENDPOINT.format(model=model)

    request_body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            # 2048로는 모자란다. Gemini 3 계열은 사고(thinking) 토큰이 출력 예산을
            # 같이 깎아서, JSON이 완성되기 전에 잘리고 파싱이 실패한다.
            "maxOutputTokens": 8192,
            # 이 작업은 정해진 스키마를 채우는 일이라 긴 사고가 필요 없다.
            # 사고를 줄이면 예산도 아끼고 응답도 빨라진다 (타임아웃 20초 안에 들어와야 한다).
            #
            # thinkingBudget 이 아니라 thinkingLevel 이다. Gemini 3 계열에서 표기가
            # 바뀌었고, flash 는 옛 표기를 아직 받아주지만 flash-lite 는 거부한다.
            #   thinkingBudget: 0  → flash OK / flash-lite 400 INVALID_ARGUMENT
            #   thinkingLevel: minimal → 둘 다 OK
            # 모델만 lite 로 바꿨을 때 이것 때문에 502가 났다. 400 본문에는 어느
            # 필드가 문제인지 안 적혀 있어서 파라미터를 하나씩 빼며 찾아야 했다.
            "thinkingConfig": {"thinkingLevel": "minimal"},
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }

    request = urllib.request.Request(
        url,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,   # 키를 URL 쿼리에 넣지 않는다
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        # 사용자에게는 원인을 감추되, 서버 로그에는 남긴다.
        # 로그가 없으면 502가 떴을 때 키 문제인지 모델명 문제인지 스키마 문제인지
        # 구분할 방법이 전혀 없다. API 키는 절대 로그에 남기지 않는다.
        _log_upstream_error(exc.code, _safe_read(exc), model)
        if exc.code == 429:
            raise UpstreamError(429, "RATE_LIMITED", "지금 이용자가 많습니다.", retry_after=30)
        # 상류의 오류 코드와 본문을 그대로 전달하지 않는다
        raise UpstreamError(502, "UPSTREAM_ERROR", "일시적인 문제가 발생했습니다.")
    except Exception as exc:
        _log_upstream_error("network", repr(exc)[:300], model)
        raise UpstreamError(502, "UPSTREAM_ERROR", "일시적인 문제가 발생했습니다.")

    try:
        return json.loads(_extract_text(json.loads(raw)))
    except Exception as exc:
        _log_parse_error(raw, exc, model)
        raise UpstreamError(502, "BAD_FORMAT", "결과를 불러오지 못했습니다.")


# ---------------------------------------------------------------- 핸들러

class handler(BaseHTTPRequestHandler):

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _same_origin(self):
        """이 요청이 우리 페이지에서 온 것인지 본다.

        브라우저는 GET/HEAD 가 아닌 요청에 Origin 헤더를 반드시 붙인다.
        같은 출처여도 붙는다. 반대로 curl 은 일부러 넣지 않는 한 없다.
        그래서 Origin 이 없거나 Host 와 다르면 우리 화면에서 온 요청이 아니다.

        헤더 위조로 우회는 된다. 그래도 넣는 이유는, 무료 플랜에서 방화벽
        rate limit 규칙을 하나밖에 못 걸기 때문이다. 그 한 겹으로는 하루 총량이
        묶이지 않는다. 이 검사는 Gemini 를 부르기 "전에" 끊으므로,
        아무 생각 없이 도는 스크립트가 할당량을 태우는 것을 막아준다.

        Host 와 비교하는 이유는 도메인을 코드에 박지 않기 위해서다.
        프로덕션·프리뷰·커스텀 도메인이 전부 자동으로 맞아떨어진다.
        """
        origin = (self.headers.get("Origin") or "").strip()
        if not origin:
            return False
        host = (self.headers.get("Host") or "").strip().lower()
        if not host:
            return False
        origin_host = origin.split("://", 1)[-1].split("/", 1)[0].lower()
        return origin_host == host

    def do_POST(self):
        if not self._same_origin():
            # 어디서 막혔는지 굳이 알려주지 않는다
            self._send(403, {"error": "FORBIDDEN", "message": "허용되지 않은 요청입니다."})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0

        if length <= 0 or length > 20000:
            self._send(400, {"error": "INVALID_INPUT", "message": "요청 본문이 비었거나 너무 큽니다."})
            return

        raw = self.rfile.read(length)

        try:
            data = parse_request(raw)
        except InvalidInput as exc:
            self._send(400, {"error": "INVALID_INPUT", "message": str(exc)})
            return

        try:
            ai_payload = call_gemini(build_user_prompt(data))
            result = normalize_response(ai_payload)
        except UnsafeCommand as exc:
            # 프롬프트 인젝션이 성공했을 때 여기까지 온다. 무엇이 걸렸는지는
            # 로그로만 남기고, 화면에는 결과를 아예 띄우지 않는다.
            print("[guard] 안전하지 않은 명령 차단: %s" % exc, flush=True)
            self._send(502, {
                "error": "UNSAFE_COMMAND",
                "message": "안전하지 않은 명령이 섞여 있어 결과를 보여드리지 않았습니다. "
                           "상황 설명에 다른 지시문이 섞여 있지 않은지 확인해주세요.",
            })
            return
        except UpstreamError as exc:
            payload = {"error": exc.code, "message": exc.message}
            if exc.retry_after:
                payload["retryAfter"] = exc.retry_after
            self._send(exc.status, payload)
            return
        except Exception:
            # 내부 stack trace를 노출하지 않는다
            self._send(500, {"error": "SERVER_ERROR", "message": "일시적인 문제가 발생했습니다."})
            return

        self._send(200, result)

    def do_GET(self):
        self._send(405, {"error": "METHOD_NOT_ALLOWED", "message": "POST로 요청해주세요."})
