"""알약 색·모양 정규화와 비교 규칙.

식약처 낱알식별 정보(drug_info.pill_json)와 사진 분석 결과를 같은 이름으로 맞춘 뒤,
"맞다/다르다"는 AI 가 아니라 여기 규칙으로 서버가 정합니다.

- 색·모양이 서로 구별되는 약은 약마다 개수를 확인합니다.
  아예 안 보이거나 모자라면 MISSING, 등록되지 않은 색·모양이 보이면 UNEXPECTED.
- 색·모양이 같은 약끼리는 한 묶음으로 보고 묶음 전체 개수만 확인합니다 (COUNT_ONLY).
- 식약처 정보가 없는 약은 어떤 모양인지 모르므로, 그 개수만큼은 처음 보는 알약이 있어도 경고하지 않습니다.
"""

import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

from app.enums import AppearanceStatus

# 식약처 COLOR_CLASS1/2 값 → 응답에 쓰는 색 이름. 사진 분석도 오른쪽 이름 중에서만 고릅니다.
MFDS_COLORS = {
    "하양": "흰색",
    "노랑": "노란색",
    "주황": "주황색",
    "분홍": "분홍색",
    "빨강": "빨간색",
    "갈색": "갈색",
    "연두": "연두색",
    "초록": "초록색",
    "청록": "청록색",
    "파랑": "파란색",
    "남색": "남색",
    "자주": "자주색",
    "보라": "보라색",
    "회색": "회색",
    "검정": "검정색",
    "투명": "투명",
}
COLORS = tuple(MFDS_COLORS.values())

# 식약처 DRUG_SHAPE 값 그대로. 캡슐은 식약처와 같이 장방형으로 봅니다.
SHAPES = ("원형", "타원형", "장방형", "반원형", "삼각형", "사각형", "마름모형", "오각형", "육각형", "팔각형", "기타")
UNKNOWN_SHAPE = "기타"


def normalize_color(raw: Any) -> str | None:
    value = str(raw or "").strip()
    if value in MFDS_COLORS:
        return MFDS_COLORS[value]
    return value if value in COLORS else None


def normalize_shape(raw: Any) -> str | None:
    value = str(raw or "").strip()
    return value if value in SHAPES else None


@dataclass(frozen=True)
class Appearance:
    colors: tuple[str, ...]  # 1~2개 (두 색 캡슐은 2개)
    shape: str

    @property
    def color(self) -> str:
        return "/".join(self.colors)


def compatible(a: Appearance, b: Appearance) -> bool:
    """같은 모양으로 볼 수 있는지. 두 색 캡슐에서 한 색만 보인 경우도 같다고 봅니다."""
    if a.shape != b.shape:
        return False
    ca, cb = set(a.colors), set(b.colors)
    return bool(ca & cb) and (ca <= cb or cb <= ca)


def _get(data: dict[str, Any], key: str) -> Any:
    """대소문자를 가리지 않고 키를 찾습니다 (식약처 원본은 대문자 키)."""
    for k, v in data.items():
        if isinstance(k, str) and k.upper() == key:
            return v
    return None


def _first_pill_item(data: Any) -> dict[str, Any] | None:
    """pill_json 원본에서 낱알 정보 항목 하나를 찾습니다 (항목 하나 / 목록 / API 응답 전체 모두 허용)."""
    if isinstance(data, list):
        for entry in data:
            if (found := _first_pill_item(entry)) is not None:
                return found
        return None
    if not isinstance(data, dict):
        return None
    if _get(data, "DRUG_SHAPE") is not None or _get(data, "COLOR_CLASS1") is not None:
        return data
    for key in ("BODY", "ITEMS", "ITEM"):
        if (inner := _get(data, key)) is not None:
            return _first_pill_item(inner)
    return None


def appearance_from_mfds(pill_json: Any) -> Appearance | None:
    """식약처 낱알식별 정보에서 색·모양을 꺼냅니다. 정보가 없거나 모양이 '기타'면 None."""
    item = _first_pill_item(pill_json)
    if item is None:
        return None
    shape = normalize_shape(_get(item, "DRUG_SHAPE"))
    colors: list[str] = []
    for key in ("COLOR_CLASS1", "COLOR_CLASS2"):
        for part in re.split(r"[,|/]", str(_get(item, key) or "")):
            color = normalize_color(part)
            if color and color not in colors:
                colors.append(color)
    if shape is None or shape == UNKNOWN_SHAPE or not colors:
        return None
    return Appearance(tuple(colors[:2]), shape)


@dataclass(frozen=True)
class ExpectedPill:
    """이 회차에 먹어야 할 알약 1알"""

    drug_id: int
    look: Appearance | None  # 식약처 정보가 없으면 None


@dataclass(frozen=True)
class PillGap:
    look: Appearance
    count: int  # MISSING: 모자란 알 수 / UNEXPECTED: 보인 알 수
    seen: int = 0  # MISSING: 사진에서 찾은 같은 모양 알 수


@dataclass(frozen=True)
class AppearanceCheck:
    status: AppearanceStatus
    missing: tuple[PillGap, ...] = ()
    unexpected: tuple[PillGap, ...] = ()
    no_info: bool = False  # 색·모양 정보가 없는 약이 있어 개수만 확인함


@dataclass
class _Group:
    """색·모양으로 서로 구별되지 않는 알약 묶음"""

    looks: list[Appearance]  # 알 하나에 하나씩
    drugs: set[int]
    seen: int = 0

    @property
    def need(self) -> int:
        return len(self.looks)

    @property
    def label(self) -> Appearance:
        return Counter(self.looks).most_common(1)[0][0]

    def accepts(self, look: Appearance) -> bool:
        return any(compatible(look, known) for known in set(self.looks))


def compare(expected: list[ExpectedPill], detected: list[Appearance], expected_count: int) -> AppearanceCheck:
    """등록된 알약(expected)과 사진의 알약(detected)을 색·모양으로 비교합니다.

    expected_count 는 회차에 등록된 총 알 수입니다. 약 목록보다 많으면 그 차이도 '모양 모르는 약'으로 봅니다.
    """
    known = [p for p in expected if p.look is not None]
    unknown_count = (len(expected) - len(known)) + max(0, expected_count - len(expected))

    groups: list[_Group] = []
    for pill in known:
        assert pill.look is not None
        merged = _Group(looks=[pill.look], drugs={pill.drug_id})
        for group in [g for g in groups if g.accepts(pill.look)]:
            merged = _Group(looks=group.looks + merged.looks, drugs=group.drugs | merged.drugs)
            groups.remove(group)
        groups.append(merged)

    strangers: list[Appearance] = []
    for look in detected:
        candidates = [g for g in groups if g.accepts(look)]
        if not candidates:
            strangers.append(look)
            continue
        exact = [g for g in candidates if look in g.looks]
        pick = max(exact or candidates, key=lambda g: g.need - g.seen)
        pick.seen += 1

    missing = tuple(PillGap(g.label, g.need - g.seen, g.seen) for g in groups if g.seen < g.need)
    unexpected: tuple[PillGap, ...] = ()
    if len(strangers) > unknown_count:
        unexpected = tuple(PillGap(look, n) for look, n in Counter(strangers).items())

    if missing or unexpected:
        return AppearanceCheck(AppearanceStatus.MISMATCH, missing, unexpected, no_info=unknown_count > 0)
    if unknown_count > 0:
        return AppearanceCheck(AppearanceStatus.COUNT_ONLY, no_info=True)
    if any(len(g.drugs) > 1 for g in groups):
        return AppearanceCheck(AppearanceStatus.COUNT_ONLY)
    return AppearanceCheck(AppearanceStatus.MATCH)
