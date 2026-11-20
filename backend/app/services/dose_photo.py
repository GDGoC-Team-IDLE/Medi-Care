"""복약 인증 사진 분석: Gemini 가 사진에서 약봉투의 시간 표시와 알약의 색·모양을 뽑습니다.

AI 에게는 보이는 특징만 적게 하고 "맞다/틀리다"는 묻지 않습니다.
비교와 최종 판정은 서버(routers/verifications.py, services/pill_appearance.py)가 합니다.
"""

from dataclasses import dataclass
from typing import Any

from app.core.config import get_settings
from app.enums import Slot
from app.services.gemini import generate_json
from app.services.pill_appearance import COLORS, SHAPES, Appearance, normalize_color, normalize_shape

IMAGE_PROBLEMS = (
    "NONE",
    "BLURRY",
    "TOO_DARK",
    "GLARE",
    "PILLS_OVERLAPPING",
    "PILLS_CUT_OFF",
    "NO_PILLS",
    "OTHER",
)

PROMPT = """\
이 사진은 어르신이 복약 인증을 위해 찍은 사진입니다. 뜯은 약봉투 1개와, 그 봉투에서 꺼낸 알약이 함께 찍혀 있어야 합니다.
사진에 보이는 것만 그대로 적으세요. 어떤 약인지 추측하거나, 맞게 먹는지 판단하지 마세요.

1. bag_time_text: 약봉투에 인쇄되거나 적힌 복용 시간 글자를 그대로 적습니다 (예: "아침", "점심 식후 30분", "취침전").
   여러 시간이 함께 인쇄되어 있고 그중 하나에만 체크·색·동그라미 표시가 있으면 표시된 것을 적습니다. 보이지 않으면 빈 문자열.
2. bag_time: bag_time_text 를 다음 중 하나로 고릅니다.
   - MORNING: 아침, 조식
   - LUNCH: 점심, 중식
   - DINNER: 저녁, 석식
   - BEDTIME: 취침 전, 자기 전
   - UNKNOWN: 봉투가 안 보이거나, 글자가 가려지거나 흐려 확실히 읽을 수 없거나, 어느 시간인지 정할 수 없음
3. pills: 봉투 밖으로 꺼낸 알약을 한 알씩 따로 적습니다. 봉투 안에 남아 있는 알약은 적지 않습니다.
   - colors: 알약 겉면의 색. 한 가지 색이면 1개, 캡슐처럼 두 부분의 색이 다르면 2개. 각인·글자·분할선의 색은 무시합니다.
   - shape: 위에서 본 모양. 캡슐은 장방형으로 적습니다.
   - certain: 그 알약의 색과 모양을 확실히 알아볼 수 있으면 true. 가려지거나, 흐리거나, 빛 반사나 그림자 때문에
     비슷한 색(예: 흰색과 투명, 노란색과 주황색) 중 어느 쪽인지 애매하면 false.
4. image_problem: 알약의 개수·색·모양을 확인하는 데 방해되는 가장 큰 문제 하나. 문제가 없으면 NONE.
   - BLURRY: 흔들리거나 초점이 안 맞음
   - TOO_DARK: 너무 어두움
   - GLARE: 빛 반사가 심함
   - PILLS_OVERLAPPING: 알약이 겹치거나 붙어 있어 개수를 확실히 셀 수 없음
   - PILLS_CUT_OFF: 알약 일부가 사진 밖으로 잘림
   - NO_PILLS: 꺼낸 알약이 보이지 않음
   - OTHER: 그 밖의 문제
"""

RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "bag_time_text": {"type": "string"},
        "bag_time": {"type": "string", "enum": [*(s.value for s in Slot), "UNKNOWN"]},
        "pills": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "colors": {
                        "type": "array",
                        "items": {"type": "string", "enum": list(COLORS)},
                        "minItems": 1,
                        "maxItems": 2,
                    },
                    "shape": {"type": "string", "enum": list(SHAPES)},
                    "certain": {"type": "boolean"},
                },
                "required": ["colors", "shape", "certain"],
            },
        },
        "image_problem": {"type": "string", "enum": list(IMAGE_PROBLEMS)},
    },
    "required": ["bag_time_text", "bag_time", "pills", "image_problem"],
}


@dataclass(frozen=True)
class DetectedPill:
    look: Appearance | None  # 색·모양 값이 목록에 없으면 None
    certain: bool


@dataclass(frozen=True)
class PhotoAnalysis:
    bag_time: Slot | None  # 시간 표시를 읽지 못하면 None
    pills: tuple[DetectedPill, ...]
    image_problem: str
    raw: dict[str, Any]  # Gemini 응답 원본 (dose_logs.ai_json 에 저장)

    @property
    def pills_unclear(self) -> bool:
        """알약 개수를 믿을 수 없는지 (→ RETAKE)"""
        return self.image_problem != "NONE" or not self.pills

    @property
    def looks_unclear(self) -> bool:
        """색·모양을 확실히 알아보지 못한 알약이 있는지 (→ 색·모양 대조만 UNKNOWN, 판정은 그대로)"""
        return any(not p.certain or p.look is None for p in self.pills)

    @property
    def looks(self) -> list[Appearance]:
        return [p.look for p in self.pills if p.look is not None]


def _parse_pill(raw: Any) -> DetectedPill:
    if not isinstance(raw, dict):
        return DetectedPill(look=None, certain=False)
    raw_colors = raw.get("colors")
    names = raw_colors if isinstance(raw_colors, list) else [raw_colors]
    colors = [normalize_color(c) for c in names]
    shape = normalize_shape(raw.get("shape"))
    look = None
    if shape and colors and None not in colors and len(colors) <= 2:
        look = Appearance(tuple(dict.fromkeys(c for c in colors if c)), shape)
    return DetectedPill(look=look, certain=raw.get("certain") is True)


def parse_analysis(raw: dict[str, Any]) -> PhotoAnalysis:
    """Gemini 응답을 검사해 PhotoAnalysis 로 바꿉니다. 이상한 값은 '확인 불가'로 처리합니다."""
    try:
        bag_time: Slot | None = Slot(raw.get("bag_time"))
    except ValueError:
        bag_time = None

    raw_pills = raw.get("pills")
    pills = tuple(_parse_pill(p) for p in raw_pills) if isinstance(raw_pills, list) else ()

    problem = raw.get("image_problem")
    image_problem = problem if problem in IMAGE_PROBLEMS else "OTHER"
    return PhotoAnalysis(bag_time=bag_time, pills=pills, image_problem=image_problem, raw=raw)


def analyze_dose_photo(image: bytes, mime_type: str) -> PhotoAnalysis:
    """사진을 Gemini 로 분석합니다. 실패하면 GeminiUnavailableError."""
    raw = generate_json(image=image, mime_type=mime_type, prompt=PROMPT, schema=RESPONSE_SCHEMA)
    return parse_analysis({**raw, "model": get_settings().gemini_model})
