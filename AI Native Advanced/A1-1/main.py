"""콘솔 기반 나만의 프롬프트 관리 프로그램."""

import json
from pathlib import Path

CATEGORIES = ["텍스트 생성", "이미지 생성", "영상 생성", "페르소나", "자동화", "기타"]
DATA_FILE = Path(__file__).with_name("prompts.json")
EXPORT_DIR = Path(__file__).with_name("exports")

DEFAULT_PROMPTS = [
    {
        "title": "블로그 글 작성 도우미",
        "content": "당신은 10년 경력의 전문 블로거입니다. 주어진 주제에 맞는 SEO 친화적인 블로그 글을 작성해주세요.",
        "category": "텍스트 생성",
        "favorite": False,
        "usage_count": 0,
    },
    {
        "title": "제품 썸네일 생성",
        "content": "제품의 핵심 장점을 한눈에 보여주는 깔끔하고 세련된 광고용 썸네일 이미지를 만들어주세요.",
        "category": "이미지 생성",
        "favorite": False,
        "usage_count": 0,
    },
    {
        "title": "IT 컨설턴트 페르소나",
        "content": "당신은 실무 경험이 풍부한 IT 컨설턴트입니다. 초보자도 이해할 수 있게 근거와 함께 조언해주세요.",
        "category": "페르소나",
        "favorite": True,
        "usage_count": 0,
    },
]

prompts = []


def load_prompts():
    """JSON 파일의 프롬프트를 불러오고, 없으면 기본 데이터를 사용한다."""
    if not DATA_FILE.exists():
        return [prompt.copy() for prompt in DEFAULT_PROMPTS]

    try:
        with DATA_FILE.open("r", encoding="utf-8") as file:
            saved_prompts = json.load(file)
        if isinstance(saved_prompts, list):
            for prompt in saved_prompts:
                prompt.setdefault("usage_count", 0)
            return saved_prompts
    except (json.JSONDecodeError, OSError):
        print("저장된 데이터를 읽을 수 없어 기본 데이터를 사용합니다.")

    return [prompt.copy() for prompt in DEFAULT_PROMPTS]


def save_prompts():
    """현재 프롬프트 목록을 JSON 파일에 저장한다."""
    with DATA_FILE.open("w", encoding="utf-8") as file:
        json.dump(prompts, file, ensure_ascii=False, indent=2)


def show_menu():
    """프로그램의 주 메뉴를 출력한다."""
    print("\n=== 나만의 프롬프트 관리 ===")
    print("1. 프롬프트 추가")
    print("2. 프롬프트 목록")
    print("3. 카테고리별 조회")
    print("4. 프롬프트 검색")
    print("5. 프롬프트 상세 보기")
    print("6. 즐겨찾기 관리")
    print("7. 즐겨찾기 목록")
    print("8. Markdown으로 내보내기")
    print("9. 프롬프트 수정")
    print("10. 프롬프트 삭제")
    print("11. 조회수 Top 목록")
    print("0. 종료")


def show_list():
    """저장된 프롬프트를 번호와 함께 출력한다."""
    print("\n=== 프롬프트 목록 ===")

    if not prompts:
        print("저장된 프롬프트가 없습니다.")
        return

    for index, prompt in enumerate(prompts, start=1):
        favorite_mark = " ⭐" if prompt["favorite"] else ""
        print(f"{index}. [{prompt['category']}] {prompt['title']}{favorite_mark}")

    print(f"\n총 {len(prompts)}개의 프롬프트")


def get_required_input(label):
    """빈 값이 아닌 입력을 받을 때까지 반복한다."""
    while True:
        value = input(f"{label}: ").strip()
        if value:
            return value
        print("입력값은 비워둘 수 없습니다. 다시 입력해주세요.")


def select_category():
    """미리 정의된 카테고리 또는 직접 입력한 카테고리를 반환한다."""
    print("\n카테고리 선택:")
    for index, category in enumerate(CATEGORIES, start=1):
        print(f"{index}) {category}")
    print("0) 직접 입력")

    while True:
        selection = input("선택: ").strip()
        if selection == "0":
            return get_required_input("카테고리")
        if selection.isdigit() and 1 <= int(selection) <= len(CATEGORIES):
            return CATEGORIES[int(selection) - 1]
        print("올바른 카테고리 번호를 입력해주세요.")


def add_prompt():
    """새 프롬프트를 입력받아 목록에 추가한다."""
    print("\n=== 프롬프트 추가 ===")
    title = get_required_input("제목")
    content = get_required_input("내용")
    category = select_category()

    prompts.append(
        {"title": title, "content": content, "category": category, "favorite": False}
    )
    save_prompts()
    print("프롬프트가 추가되었습니다!")


def show_by_category():
    """선택한 카테고리에 속하는 프롬프트만 출력한다."""
    print("\n=== 카테고리별 조회 ===")
    available_categories = sorted(set(CATEGORIES) | {prompt["category"] for prompt in prompts})
    for index, category in enumerate(available_categories, start=1):
        print(f"{index}) {category}")

    selection = input("선택: ").strip()
    if not selection.isdigit() or not 1 <= int(selection) <= len(available_categories):
        print("올바른 카테고리 번호를 입력해주세요.")
        return

    category = available_categories[int(selection) - 1]
    filtered_prompts = [prompt for prompt in prompts if prompt["category"] == category]
    if not filtered_prompts:
        print(f"{category} 카테고리에 등록된 프롬프트가 없습니다.")
        return

    print(f"\n[{category}] 카테고리 프롬프트:")
    for index, prompt in enumerate(filtered_prompts, start=1):
        favorite_mark = " ⭐" if prompt["favorite"] else ""
        print(f"{index}. {prompt['title']}{favorite_mark}")
    print(f"\n총 {len(filtered_prompts)}개의 프롬프트")


def search_prompts():
    """제목 또는 내용에 키워드가 포함된 프롬프트를 검색한다."""
    print("\n=== 프롬프트 검색 ===")
    keyword = get_required_input("검색어").lower()
    results = [
        prompt
        for prompt in prompts
        if keyword in prompt["title"].lower() or keyword in prompt["content"].lower()
    ]

    if not results:
        print("검색 결과가 없습니다.")
        return

    print("\n검색 결과:")
    for index, prompt in enumerate(results, start=1):
        favorite_mark = " ⭐" if prompt["favorite"] else ""
        print(f"{index}. [{prompt['category']}] {prompt['title']}{favorite_mark}")
    print(f"\n{len(results)}개의 프롬프트를 찾았습니다.")


def get_prompt_by_number():
    """사용자가 입력한 번호에 해당하는 프롬프트를 반환한다."""
    selection = input("번호 입력: ").strip()
    if not selection.isdigit() or not 1 <= int(selection) <= len(prompts):
        print("올바른 프롬프트 번호를 입력해주세요.")
        return None
    return prompts[int(selection) - 1]


def show_detail():
    """선택한 프롬프트의 전체 정보를 출력한다."""
    print("\n=== 프롬프트 상세 보기 ===")
    prompt = get_prompt_by_number()
    if prompt is None:
        return

    prompt["usage_count"] = prompt.get("usage_count", 0) + 1
    save_prompts()
    favorite_text = "즐겨찾기" if prompt["favorite"] else "일반"
    print(f"\n제목: {prompt['title']}")
    print(f"카테고리: {prompt['category']}")
    print(f"즐겨찾기: {favorite_text}")
    print(f"조회수: {prompt['usage_count']}")
    print(f"내용: {prompt['content']}")


def toggle_favorite():
    """선택한 프롬프트의 즐겨찾기 상태를 변경한다."""
    print("\n=== 즐겨찾기 관리 ===")
    prompt = get_prompt_by_number()
    if prompt is None:
        return

    prompt["favorite"] = not prompt["favorite"]
    save_prompts()
    state = "추가" if prompt["favorite"] else "해제"
    print(f"'{prompt['title']}' 즐겨찾기가 {state}되었습니다.")


def show_favorites():
    """즐겨찾기로 표시된 프롬프트만 출력한다."""
    print("\n=== 즐겨찾기 목록 ===")
    favorites = [prompt for prompt in prompts if prompt["favorite"]]
    if not favorites:
        print("즐겨찾기한 프롬프트가 없습니다.")
        return

    for index, prompt in enumerate(favorites, start=1):
        print(f"{index}. [{prompt['category']}] {prompt['title']} ⭐")
    print(f"\n총 {len(favorites)}개의 즐겨찾기")


def export_to_markdown():
    """프롬프트를 카테고리별 Markdown 파일로 내보낸다."""
    print("\n=== Markdown 내보내기 ===")
    if not prompts:
        print("내보낼 프롬프트가 없습니다.")
        return

    EXPORT_DIR.mkdir(exist_ok=True)
    categories = sorted({prompt["category"] for prompt in prompts})

    for category in categories:
        category_prompts = [prompt for prompt in prompts if prompt["category"] == category]
        file_name = category.replace("/", "_") + ".md"
        file_path = EXPORT_DIR / file_name

        with file_path.open("w", encoding="utf-8") as file:
            file.write(f"# {category} 프롬프트\n\n")
            for index, prompt in enumerate(category_prompts, start=1):
                favorite_mark = " ⭐" if prompt["favorite"] else ""
                file.write(f"## {index}. {prompt['title']}{favorite_mark}\n\n")
                file.write(f"{prompt['content']}\n\n")

    print(f"{len(categories)}개 카테고리를 '{EXPORT_DIR.name}' 폴더에 내보냈습니다.")


def edit_prompt():
    """선택한 프롬프트의 제목, 내용, 카테고리를 수정한다."""
    print("\n=== 프롬프트 수정 ===")
    prompt = get_prompt_by_number()
    if prompt is None:
        return

    title = input(f"새 제목 (Enter: '{prompt['title']}' 유지): ").strip()
    content = input("새 내용 (Enter: 기존 내용 유지): ").strip()
    category = input(f"새 카테고리 (Enter: '{prompt['category']}' 유지): ").strip()

    if title:
        prompt["title"] = title
    if content:
        prompt["content"] = content
    if category:
        prompt["category"] = category
    save_prompts()
    print("프롬프트가 수정되었습니다.")


def delete_prompt():
    """선택한 프롬프트를 확인 후 삭제한다."""
    print("\n=== 프롬프트 삭제 ===")
    prompt = get_prompt_by_number()
    if prompt is None:
        return

    confirmation = input(f"'{prompt['title']}'을(를) 삭제할까요? (y/n): ").strip().lower()
    if confirmation != "y":
        print("삭제를 취소했습니다.")
        return

    prompts.remove(prompt)
    save_prompts()
    print("프롬프트가 삭제되었습니다.")


def show_top_prompts():
    """조회수가 높은 순서대로 프롬프트 목록을 출력한다."""
    print("\n=== 조회수 Top 목록 ===")
    if not prompts:
        print("저장된 프롬프트가 없습니다.")
        return

    top_prompts = sorted(prompts, key=lambda prompt: prompt.get("usage_count", 0), reverse=True)
    for index, prompt in enumerate(top_prompts, start=1):
        print(f"{index}. {prompt['title']} — 조회수 {prompt.get('usage_count', 0)}회")


def run():
    """사용자 입력에 따라 메뉴를 반복 표시한다."""
    global prompts
    prompts = load_prompts()

    while True:
        show_menu()
        choice = input("선택: ").strip()

        if choice == "0":
            print("프로그램을 종료합니다.")
            break
        if choice == "1":
            add_prompt()
            continue
        if choice == "2":
            show_list()
            continue
        if choice == "3":
            show_by_category()
            continue
        if choice == "4":
            search_prompts()
            continue
        if choice == "5":
            show_detail()
            continue
        if choice == "6":
            toggle_favorite()
            continue
        if choice == "7":
            show_favorites()
            continue
        if choice == "8":
            export_to_markdown()
            continue
        if choice == "9":
            edit_prompt()
            continue
        if choice == "10":
            delete_prompt()
            continue
        if choice == "11":
            show_top_prompts()
            continue
        print("아직 준비 중인 기능입니다. 다른 번호를 선택해주세요.")


if __name__ == "__main__":
    run()
