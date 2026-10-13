import io
import os
from typing import Dict, Any, List
from PIL import Image, ImageDraw, ImageFont

def _get_font(font_names: list, size: int):
    """시스템 폰트 목록 중 사용 가능한 폰트를 로드합니다."""
    font_dir = r"C:\Windows\Fonts"
    for name in font_names:
        font_path = os.path.join(font_dir, name)
        if os.path.exists(font_path):
            try:
                return ImageFont.truetype(font_path, size)
            except Exception:
                continue
    try:
        return ImageFont.load_default()
    except Exception:
        return None

def _wrap_text(text: str, font, max_width: int, draw: ImageDraw.ImageDraw) -> list:
    """텍스트를 박스 너비에 맞추어 자동 줄바꿈합니다."""
    if not text:
        return []
    words = text.split(" ")
    lines = []
    current_line = ""

    for word in words:
        test_line = f"{current_line} {word}".strip()
        bbox = draw.textbbox((0, 0), test_line, font=font)
        w = bbox[2] - bbox[0]
        if w <= max_width:
            current_line = test_line
        else:
            if current_line:
                lines.append(current_line)
            current_line = word
    if current_line:
        lines.append(current_line)
    return lines

def _hex_to_rgb(hex_str: str, default=(46, 90, 68)) -> tuple:
    """HEX 색상 코드를 RGB 튜플로 변환합니다."""
    if not hex_str or not isinstance(hex_str, str):
        return default
    hex_clean = hex_str.strip().lstrip("#")
    if len(hex_clean) == 3:
        hex_clean = "".join([c * 2 for c in hex_clean])
    if len(hex_clean) != 6:
        return default
    try:
        return tuple(int(hex_clean[i:i+2], 16) for i in (0, 2, 4))
    except ValueError:
        return default

def generate_brand_identity_board(
    brand_data: Dict[str, Any]
) -> bytes:
    """
    [Agent 4: Visual Identity Rendering Agent]
    모든 에이전트들의 산출물을 집약하여 고해상도 브랜드 아이덴티티 보드 이미지를 생성합니다.
    """
    # 캔버스 크기: 1200 x 860
    width = 1200
    height = 860
    img = Image.new("RGB", (width, height), color=(246, 248, 250))
    draw = ImageDraw.Draw(img)

    # 폰트 로드
    bold_fonts = ["malgunbd.ttf", "malgun.ttf", "segoeuib.ttf", "arialbd.ttf"]
    regular_fonts = ["malgun.ttf", "segoeui.ttf", "arial.ttf"]

    f_title = _get_font(bold_fonts, 38)
    f_eng_title = _get_font(regular_fonts, 20)
    f_badge = _get_font(bold_fonts, 13)
    f_section_title = _get_font(bold_fonts, 16)
    f_slogan_main = _get_font(bold_fonts, 22)
    f_slogan_sub = _get_font(regular_fonts, 16)
    f_body = _get_font(regular_fonts, 15)
    f_chip_name = _get_font(bold_fonts, 14)
    f_chip_hex = _get_font(regular_fonts, 13)
    f_footer = _get_font(regular_fonts, 13)

    # 데이터 추출
    brand_name = brand_data.get("name", "Brand Name")
    english_name = brand_data.get("english_name", "Brand Concept")
    industry = brand_data.get("industry", "")
    target = brand_data.get("target", "")
    tone = brand_data.get("tone", "")
    keywords = brand_data.get("keywords", [])
    
    slogan_info = brand_data.get("slogan_info", {})
    main_slogan = slogan_info.get("main_slogan", "")
    sub_slogan = slogan_info.get("sub_slogan", "")
    brand_story = slogan_info.get("brand_story") or brand_data.get("reason", "")
    
    palette = brand_data.get("color_palette", {})
    main_color_info = palette.get("main", {}) if isinstance(palette.get("main"), dict) else {}
    main_hex = main_color_info.get("hex", "#2E5A44")
    main_name = main_color_info.get("name", "Primary Color")
    main_meaning = main_color_info.get("meaning", "")

    sub_colors = palette.get("sub", [])
    mood_desc = palette.get("mood_description", "")

    main_rgb = _hex_to_rgb(main_hex, default=(46, 90, 68))

    # 1. 상단 포인트 바
    draw.rectangle([0, 0, width, 8], fill=main_rgb)

    # 2. 메인 카드 박스
    margin_x = 45
    card_top = 35
    card_bottom = height - 35
    card_w = width - (margin_x * 2)

    draw.rounded_rectangle(
        [margin_x, card_top, width - margin_x, card_bottom],
        radius=16,
        fill=(255, 255, 255),
        outline=(225, 230, 238),
        width=1
    )

    # 3. 헤더 섹션 (로고 엠블럼 + 브랜드명 + 뱃지)
    icon_size = 80
    icon_x = margin_x + 40
    icon_y = card_top + 35

    # 엠블럼 심볼
    draw.rounded_rectangle(
        [icon_x, icon_y, icon_x + icon_size, icon_y + icon_size],
        radius=16,
        fill=main_rgb
    )
    initial_char = (brand_name[0] if brand_name else "B").upper()
    f_initial = _get_font(bold_fonts, 44)
    ibbox = draw.textbbox((0, 0), initial_char, font=f_initial)
    iw = ibbox[2] - ibbox[0]
    ih = ibbox[3] - ibbox[1]
    draw.text(
        (icon_x + (icon_size - iw) / 2, icon_y + (icon_size - ih) / 2 - 3),
        initial_char,
        fill=(255, 255, 255),
        font=f_initial
    )

    # 브랜드 타이틀
    title_x = icon_x + icon_size + 24
    draw.text((title_x, icon_y + 4), brand_name, fill=(22, 28, 36), font=f_title)
    draw.text((title_x, icon_y + 50), english_name, fill=(115, 128, 145), font=f_eng_title)

    # 우측 상단 메타 뱃지들 (Industry, Target, Tone)
    badges = []
    if industry:
        badges.append(f"분야: {industry}")
    if target:
        badges.append(f"타깃: {target}")
    if tone:
        badges.append(f"톤: {tone}")

    curr_badge_right = width - margin_x - 40
    badge_y = icon_y + 12
    for b_text in reversed(badges):
        b_box = draw.textbbox((0, 0), b_text, font=f_badge)
        bw = b_box[2] - b_box[0] + 20
        bh = 28
        bx = curr_badge_right - bw
        draw.rounded_rectangle([bx, badge_y, bx + bw, badge_y + bh], radius=14, fill=(242, 245, 248))
        draw.text((bx + 10, badge_y + 6), b_text, fill=(75, 85, 100), font=f_badge)
        curr_badge_right = bx - 10

    # 구분선 1
    div1_y = icon_y + icon_size + 30
    draw.line([margin_x + 40, div1_y, width - margin_x - 40, div1_y], fill=(235, 239, 245), width=1)

    # 4. 슬로건 및 브랜드 스토리 섹션
    sec1_y = div1_y + 25
    draw.text((margin_x + 40, sec1_y), "BRAND SLOGAN & STORYTELLING", fill=(140, 150, 165), font=f_section_title)

    curr_y = sec1_y + 35
    if main_slogan:
        # 슬로건 강조 박스
        s_box_h = 42
        draw.rounded_rectangle(
            [margin_x + 40, curr_y, width - margin_x - 40, curr_y + s_box_h],
            radius=8,
            fill=(248, 250, 252),
            outline=(230, 235, 242),
            width=1
        )
        draw.text((margin_x + 55, curr_y + 9), f"“ {main_slogan} ”", fill=main_rgb, font=f_slogan_main)
        curr_y += s_box_h + 15

    if sub_slogan:
        draw.text((margin_x + 45, curr_y), f"• 서브 슬로건: {sub_slogan}", fill=(65, 75, 90), font=f_slogan_sub)
        curr_y += 26

    if brand_story:
        story_lines = _wrap_text(f"• 브랜드 스토리: {brand_story}", f_body, card_w - 90, draw)
        for line in story_lines[:3]:
            draw.text((margin_x + 45, curr_y), line, fill=(90, 100, 115), font=f_body)
            curr_y += 24

    # 키워드 태그들
    if keywords:
        curr_y += 8
        draw.text((margin_x + 45, curr_y + 4), "핵심 가치 키워드:", fill=(130, 140, 155), font=f_chip_name)
        kw_x = margin_x + 180
        for kw in keywords:
            kw_text = f"#{kw}"
            k_box = draw.textbbox((0, 0), kw_text, font=f_chip_name)
            kw_w = k_box[2] - k_box[0] + 16
            draw.rounded_rectangle([kw_x, curr_y, kw_x + kw_w, curr_y + 26], radius=13, fill=(238, 243, 240))
            draw.text((kw_x + 8, curr_y + 5), kw_text, fill=main_rgb, font=f_chip_name)
            kw_x += kw_w + 10
        curr_y += 35

    # 구분선 2
    div2_y = max(curr_y + 15, sec1_y + 190)
    draw.line([margin_x + 40, div2_y, width - margin_x - 40, div2_y], fill=(235, 239, 245), width=1)

    # 5. 컬러 시스템 섹션
    sec2_y = div2_y + 25
    draw.text((margin_x + 40, sec2_y), "BRAND COLOR SYSTEM & PALETTE", fill=(140, 150, 165), font=f_section_title)

    if mood_desc:
        draw.text((margin_x + 360, sec2_y + 1), f"| {mood_desc}", fill=(110, 120, 135), font=f_body)

    chips_y = sec2_y + 35
    chip_w = 230
    chip_h = 80
    gap = 20

    all_chips = [(main_hex, main_name, "MAIN", main_meaning)]
    for sub in sub_colors:
        if isinstance(sub, dict):
            all_chips.append((sub.get("hex", "#CCCCCC"), sub.get("name", "Sub Color"), "SUB", sub.get("meaning", "")))
        elif isinstance(sub, str):
            all_chips.append((sub, "Sub Color", "SUB", ""))

    chip_start_x = margin_x + 40
    for idx, (hex_val, cname, tag, meaning) in enumerate(all_chips[:4]):
        cx = chip_start_x + idx * (chip_w + gap)
        c_rgb = _hex_to_rgb(hex_val, default=(200, 200, 200))

        # 컬러 박스
        draw.rounded_rectangle(
            [cx, chips_y, cx + chip_w, chips_y + chip_h],
            radius=10,
            fill=c_rgb,
            outline=(215, 220, 228),
            width=1
        )

        # 정보 텍스트
        info_y = chips_y + chip_h + 10
        tag_color = main_rgb if tag == "MAIN" else (115, 125, 140)
        draw.text((cx + 2, info_y), f"[{tag}] {cname}", fill=tag_color, font=f_chip_name)
        draw.text((cx + 2, info_y + 20), hex_val.upper(), fill=(140, 150, 165), font=f_chip_hex)

    # 6. 하단 푸터
    footer_y = card_bottom - 35
    draw.text(
        (margin_x + 40, footer_y),
        "Brand Identity Multi-Agent Pipeline • Orchestrated with Google Gemini AI",
        fill=(160, 170, 185),
        font=f_footer
    )

    buffer = io.BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()

# 하위 호환용 래퍼 함수
def generate_brand_image(brand_name: str, slogan: str, colors: dict, english_name: str = "", industry: str = "") -> bytes:
    data = {
        "name": brand_name,
        "english_name": english_name,
        "industry": industry,
        "slogan_info": {"main_slogan": slogan},
        "color_palette": colors
    }
    return generate_brand_identity_board(data)
