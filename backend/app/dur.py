from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from app.models import PrescriptionDrug

CONCOMITANT = "CONCOMITANT_CONTRAINDICATION"
DUPLICATE = "DUPLICATE_EFFICACY"
MFDS_TYPES = {
    "병용금기": CONCOMITANT,
    "특정연령대금기": "AGE_CONTRAINDICATION",
    "임부금기": "PREGNANCY_CONTRAINDICATION",
    "노인주의": "ELDERLY_CAUTION",
    "용량주의": "DOSAGE_CAUTION",
    "투여기간주의": "DURATION_CAUTION",
    "서방정분할주의": "EXTENDED_RELEASE_SPLITTING_CAUTION",
    "효능군중복": DUPLICATE,
}
# 쉬운 문장 뒤에 서버가 항상 붙이는 안내 (Gemini 는 쓰지 않음)
CLOSING = "의사나 약사에게 확인해 주세요."


@dataclass(frozen=True)
class DurWarning:
    type: str
    drugs: list[str]
    original_message: str
    easy_message: str
    source: str = "MFDS_DUR"


def _entries(cache: object) -> Iterator[dict]:
    if isinstance(cache, list):
        for entry in cache:
            yield from _entries(entry)
    elif isinstance(cache, dict):
        if "type" in cache or "TYPE_NAME" in cache or "MIXTURE_ITEM_SEQ" in cache:
            yield cache
        else:
            for key in ("response", "body", "items", "item", "dur_warnings"):
                if key in cache:
                    yield from _entries(cache[key])


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _name_key(name: str) -> str:
    return " ".join(name.split()).casefold()


def easy_key(kind: str, item_seqs: Iterable[str]) -> str:
    """drug_info.dur_json["easy_messages"] 의 키: (경고 종류, 약, 상대 약) 의 품목기준코드.

    약 순서와 관계없이 같은 경우는 같은 키라서, 한 번 만든 문장이 항상 다시 나옵니다.
    """
    return "|".join([kind, *sorted(set(item_seqs))])


def with_closing(text: str) -> str:
    text = text.strip()
    return f"{text}{'' if text.endswith(('.', '!', '?')) else '.'} {CLOSING}"


def cached_easy_messages(drugs: list[PrescriptionDrug]) -> dict[str, str]:
    cache: dict[str, str] = {}
    for drug in drugs:
        dur = drug.drug_info.dur_json if drug.drug_info else None
        if isinstance(dur, dict) and isinstance(dur.get("easy_messages"), dict):
            cache.update(dur["easy_messages"])
    return cache


def active_dur_warnings(drugs: list[PrescriptionDrug]) -> list[DurWarning]:
    return [warning for warning, _ in dur_warnings_with_seqs(drugs)]


def dur_warnings_with_seqs(drugs: list[PrescriptionDrug]) -> list[tuple[DurWarning, tuple[str, ...] | None]]:
    """경고와 관련 약의 품목기준코드. 쉬운 문장이 이미 들어 있는 형식의 경고는 품목기준코드가 None 입니다.

    식약처 원본은 같은 (경고 종류, 약, 상대 약) 을 경고 하나로 합치고 원문을 이어 붙입니다.
    쉬운 문장은 캐시에 있으면 그 문장, 없으면 식약처 원문을 쓰고 뒤에 CLOSING 을 붙입니다.
    """
    names = {_name_key(drug.drug_name): drug.drug_name for drug in drugs}
    items = {drug.item_seq: drug.drug_name for drug in drugs if drug.item_seq}
    for drug in drugs:
        if drug.drug_info:
            names.setdefault(_name_key(drug.drug_info.item_name), drug.drug_name)

    easy_cache = cached_easy_messages(drugs)
    # 효능군중복: (효능군, 계열) 별로 모은 뒤 서로 다른 품목이 2개 이상이면 경고합니다.
    duplicates: dict[tuple[str, str], dict[str, tuple[str, str]]] = {}
    # (종류, 약 이름들) → (약 이름, 품목기준코드, 원문)
    found: dict[tuple[str, tuple[str, ...]], tuple[list[str], set[str], set[str]]] = {}
    warnings: dict[tuple[str, tuple[str, ...], str], DurWarning] = {}
    for drug in drugs:
        if not drug.drug_info:
            continue
        for entry in _entries(drug.drug_info.dur_json):
            if "type" in entry:
                kind = _text(entry["type"])
                original = _text(entry.get("original_message"))
                easy = _text(entry.get("easy_message"))
                listed = entry.get("drugs")
                if not isinstance(listed, list) or not easy or entry.get("source", "MFDS_DUR") != "MFDS_DUR":
                    continue
                involved = [names.get(_name_key(_text(name))) for name in listed]
                seqs = None
            else:
                type_name = _text(entry.get("TYPE_NAME")).replace(" ", "")
                kind = MFDS_TYPES.get(type_name, "")
                if not type_name and entry.get("MIXTURE_ITEM_SEQ"):
                    kind = CONCOMITANT
                original = _text(entry.get("PROHBT_CONTENT"))
                if not original and type_name and kind != DUPLICATE:
                    # 노인주의는 식약처 원문(PROHBT_CONTENT)이 비어 있는 경우가 많아 대상 성분 이름으로 대신합니다.
                    ingredient = _text(entry.get("INGR_NAME"))
                    original = f"{type_name} 대상 성분: {ingredient}" if ingredient else f"{type_name} 대상 의약품"
                item_seq = str(entry.get("ITEM_SEQ") or drug.item_seq)
                involved = [items.get(item_seq)]
                seqs = [item_seq]
                if kind == DUPLICATE:
                    group = (_text(entry.get("EFFECT_NAME")), _text(entry.get("SERS_NAME")))
                    if group[0] and involved[0] is not None:
                        duplicates.setdefault(group, {}).setdefault(item_seq, (involved[0], original))
                    continue
                if kind == CONCOMITANT:
                    other_seq = str(entry.get("MIXTURE_ITEM_SEQ") or "")
                    if other_seq == item_seq:
                        continue
                    involved.append(items.get(other_seq))
                    seqs.append(other_seq)

            if not kind or not original or not involved or None in involved:
                continue
            if kind == CONCOMITANT and len(involved) != 2:
                continue
            matched = [name for name in involved if name is not None]
            if seqs is not None:
                _, found_seqs, originals = found.setdefault((kind, tuple(sorted(matched))), (matched, set(), set()))
                found_seqs.update(seqs)
                originals.add(original)
                continue
            key = (kind, tuple(sorted(matched)), original)
            warnings.setdefault(key, DurWarning(kind, matched, original, easy))

    for (effect, series), members in duplicates.items():
        if len(members) < 2:
            continue
        matched = [name for name, _ in members.values()]
        original = next((text for _, text in members.values() if text), "") or (
            f"효능군중복: {effect}" + (f" ({series})" if series else "")
        )
        _, found_seqs, originals = found.setdefault((DUPLICATE, tuple(sorted(matched))), (matched, set(), set()))
        found_seqs.update(members)
        originals.add(original)

    result: list[tuple[DurWarning, tuple[str, ...] | None]] = [(warning, None) for warning in warnings.values()]
    for (kind, _), (matched, found_seqs, originals) in found.items():
        original = "; ".join(sorted(originals))
        easy = easy_cache.get(easy_key(kind, found_seqs)) or original
        result.append((DurWarning(kind, matched, original, with_closing(easy)), tuple(sorted(found_seqs))))
    return result
