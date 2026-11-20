from collections.abc import Iterator
from dataclasses import dataclass

from app.models import PrescriptionDrug

CONCOMITANT = "CONCOMITANT_CONTRAINDICATION"
MFDS_TYPES = {
    "병용금기": CONCOMITANT,
    "특정연령대금기": "AGE_CONTRAINDICATION",
    "임부금기": "PREGNANCY_CONTRAINDICATION",
    "노인주의": "ELDERLY_CAUTION",
    "용량주의": "DOSAGE_CAUTION",
    "투여기간주의": "DURATION_CAUTION",
    "서방정분할주의": "EXTENDED_RELEASE_SPLITTING_CAUTION",
}
EASY_MESSAGES = {
    CONCOMITANT: "이 두 약은 함께 드시면 안 되는 조합으로 지정되어 있어요. 의사나 약사에게 꼭 확인해 주세요.",
}


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


def active_dur_warnings(drugs: list[PrescriptionDrug]) -> list[DurWarning]:
    names = {_name_key(drug.drug_name): drug.drug_name for drug in drugs}
    items = {drug.item_seq: drug.drug_name for drug in drugs if drug.item_seq}
    for drug in drugs:
        if drug.drug_info:
            names.setdefault(_name_key(drug.drug_info.item_name), drug.drug_name)

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
                if not isinstance(listed, list) or entry.get("source", "MFDS_DUR") != "MFDS_DUR":
                    continue
                involved = [names.get(_name_key(_text(name))) for name in listed]
            else:
                type_name = _text(entry.get("TYPE_NAME")).replace(" ", "")
                kind = MFDS_TYPES.get(type_name, "")
                if not type_name and entry.get("MIXTURE_ITEM_SEQ"):
                    kind = CONCOMITANT
                original = _text(entry.get("PROHBT_CONTENT"))
                easy = EASY_MESSAGES.get(
                    kind, "식약처에서 안내한 주의사항이에요. 해당되는지 의사나 약사에게 확인해 주세요."
                )
                item_seq = str(entry.get("ITEM_SEQ") or drug.item_seq)
                involved = [items.get(item_seq)]
                if kind == CONCOMITANT:
                    other_seq = str(entry.get("MIXTURE_ITEM_SEQ") or "")
                    if other_seq == item_seq:
                        continue
                    involved.append(items.get(other_seq))

            if not kind or not original or not easy or not involved or None in involved:
                continue
            if kind == CONCOMITANT and len(involved) != 2:
                continue
            matched = [name for name in involved if name is not None]
            key = (kind, tuple(sorted(matched)), original)
            warnings.setdefault(key, DurWarning(kind, matched, original, easy))

    return list(warnings.values())
