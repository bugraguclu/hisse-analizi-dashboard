"""Turkish names for TradingView economic-calendar events (TradingView publishes English only).

Where the names come from, in order:

1. ``TITLES`` in :mod:`economic_calendar_titles_data`: pairs harvested from doviz.com, the
   previous (Turkish) source, by ``scripts/harvest_calendar_titles.py``. The two sources'
   events are paired when they share country, Istanbul day and time and their released /
   previous values agree (:func:`pair_titles`), so every entry is a name doviz.com itself
   printed for that event.
2. ``MANUAL``: a short hand-kept list for releases a harvest could not pair.
3. A known base name plus the English qualifiers of the title: "GDP Growth Rate QoQ Adv"
   → base "GDP Growth Rate" (learned from "GDP Growth Rate YoY") + "(Çeyreklik) (Öncü)".
4. Patterns that doviz.com names consistently: speeches, PMIs, auctions, press
   conferences, meeting minutes, rate decisions, plus a small holiday glossary.

Anything else returns ``None`` and the UI shows the English name.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from src.adapters.economic_calendar_titles_data import IMPORTANCE, TITLES

ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")

# Trailing English qualifiers → the parenthesized Turkish ones doviz.com appends, in the
# same order ("Unit Labour Costs QoQ Final" ↔ "Birim İşgücü Maliyetleri (Çeyreklik) (Final)").
# Multi-word qualifiers first so "3rd Est" wins over a bare "Est".
QUALIFIERS: tuple[tuple[str, str], ...] = (
    ("3rd Est", "3. Tahmin"),
    ("2nd Est", "2. Tahmin"),
    ("YoY", "Yıllık"),
    ("MoM", "Aylık"),
    ("QoQ", "Çeyreklik"),
    ("WoW", "Haftalık"),
    ("Prel", "Öncü"),
    ("Flash", "Öncü"),
    ("Adv", "Öncü"),
    ("Final", "Final"),
    ("s.a.", "Mevsimsellikten Arındırılmış"),
    ("s.a", "Mevsimsellikten Arındırılmış"),
    ("YTD", "YBB"),
    ("Annualized", "Yıllıklandırılmış"),
)
_QUALIFIER_TR = dict(QUALIFIERS)
_TR_QUALIFIERS = frozenset(_QUALIFIER_TR.values())
_TR_QUALIFIER_RE = re.compile(r"\s*\(([^()]*)\)\s*$")


def _clean(text: str) -> str:
    return " ".join(text.split())


def split_qualifiers(title_en: str) -> tuple[str, list[str]]:
    """``"GDP Growth Rate QoQ Adv"`` → ``("GDP Growth Rate", ["QoQ", "Adv"])``."""
    base = _clean(title_en)
    found: list[str] = []
    while True:
        for qualifier, _ in QUALIFIERS:
            if base.endswith(f" {qualifier}"):
                base = base[: -len(qualifier) - 1].rstrip()
                found.insert(0, qualifier)
                break
        else:
            return base, found


def split_turkish_qualifiers(title_tr: str) -> tuple[str, list[str]]:
    """``"Birim İşgücü Maliyetleri (Çeyreklik) (Final)"`` → ``("Birim İşgücü Maliyetleri", ["Çeyreklik", "Final"])``."""
    base = _clean(title_tr)
    found: list[str] = []
    while (match := _TR_QUALIFIER_RE.search(base)) and match.group(1).strip() in _TR_QUALIFIERS:
        found.insert(0, match.group(1).strip())
        base = base[: match.start()].rstrip()
    return base, found


def _learn_bases(titles: Mapping[str, str]) -> dict[str, str]:
    """Base names whose qualifiers line up on both sides, most frequent Turkish base first."""
    votes: dict[str, Counter[str]] = defaultdict(Counter)
    for title_en, title_tr in titles.items():
        base_en, qualifiers_en = split_qualifiers(title_en)
        base_tr, qualifiers_tr = split_turkish_qualifiers(title_tr)
        if base_en and base_tr and [_QUALIFIER_TR[q] for q in qualifiers_en] == qualifiers_tr:
            votes[base_en][base_tr] += 1
    return {base: counter.most_common(1)[0][0] for base, counter in votes.items()}


_BASES = _learn_bases(TITLES)

# ---------------------------------------------------------------------------
# Patterns (applied to the base name, qualifiers are appended afterwards)
# ---------------------------------------------------------------------------

_BANKS = r"Fed|FOMC|ECB|BoE|BOE|BoJ|BOJ|RBA|RBNZ|BoC|BOC|SNB|TCMB|CBRT|BCB|CBR|PBoC|PBOC|RBI|BoK|BOK|Riksbank|Norges Bank|Bundesbank|Buba"
_ROLES = {
    "Chair": "Başkanı",
    "President": "Başkanı",
    "Gov": "Başkanı",
    "Governor": "Başkanı",
    "Vice Chair": "Başkan Yardımcısı",
    "Vice President": "Başkan Yardımcısı",
    "Deputy Gov": "Başkan Yardımcısı",
    "Deputy Governor": "Başkan Yardımcısı",
}
_SPEECH_RE = re.compile(
    rf"^(?P<bank>{_BANKS})(?: (?P<role>{'|'.join(sorted(_ROLES, key=len, reverse=True))}))? (?P<name>[^\s].*) Speech$"
)
_PMI_KINDS = {
    "Manufacturing": "İmalat",
    "Services": "Hizmetler",
    "Composite": "Bileşik",
    "Construction": "İnşaat",
    "Non-Manufacturing": "İmalat Dışı",
    "Non Manufacturing": "İmalat Dışı",
    "General": "Genel",
}
_PMI_ISSUERS = {"Istanbul Chamber of Industry": "İstanbul Sanayi Odası (İSO)"}
_PMI_RE = re.compile(rf"^(?P<issuer>.*?)\s*(?P<kind>{'|'.join(sorted(_PMI_KINDS, key=len, reverse=True))})? ?PMI$")
_TENORS = {"Year": "Yıllık", "Month": "Aylık", "Week": "Haftalık"}
_INSTRUMENTS = {
    "Note": "Tahvil",
    "Bond": "Tahvil",
    "Bill": "Bono",
    "KTB": "KTB Tahvil",
    "FRN": "FRN (Değişken Faizli Tahvil)",
    "BTP Short Term": "BTP Kısa Vadeli",
}
_TENOR_AUCTION_RE = re.compile(r"^(?P<n>\d+)-(?P<unit>Year|Month|Week) (?P<instrument>.+) Auctions?$")
_AUCTION_RE = re.compile(r"^(?P<instrument>.+) Auctions?$")
_PRESS_RE = re.compile(rf"^(?P<who>(?:{_BANKS})(?: [A-Z][\w&-]*)?) Press Conference$")
_MINUTES_RE = re.compile(rf"^(?P<who>{_BANKS}) (?:Meeting )?Minutes$")
_DECISION_RE = re.compile(r"^(?:(?P<bank>[A-Z][\w&.]*) )?Interest Rate Decision$")
_MEETINGS = {"ECOFIN": "ECOFIN", "Eurogroup": "Eurogroup", "OPEC": "OPEC", "OPEC+": "OPEC+", "G7": "G7", "G20": "G20"}

# Hand-kept names for releases doviz.com did not pair in a harvest (value-less, or not in its
# month). Base names: qualifiers compose ("Tokyo CPI YoY" → "Tokyo TÜFE (Yıllık)"). A
# harvested name for the same title wins.
MANUAL: dict[str, str] = {
    "Fed Beige Book": "Fed Bej Kitap",
    "Personal Spending": "Kişisel Harcamalar",
    "Real Personal Spending": "Reel Kişisel Harcamalar",
    "Personal Income": "Kişisel Gelir",
    "GfK Consumer Confidence": "GfK Tüketici Güveni",
    "Loan Prime Rate 1Y": "Kredi Ana Faiz Oranı (1 Yıl)",
    "Loan Prime Rate 5Y": "Kredi Ana Faiz Oranı (5 Yıl)",
    "Tokyo CPI": "Tokyo TÜFE",
    "Tokyo Core CPI": "Tokyo Çekirdek TÜFE",
    "Tokyo CPI Ex Food and Energy": "Tokyo TÜFE (Gıda ve Enerji Hariç)",
    "Inflation Rate Ex-Food and Energy": "Enflasyon Oranı (Gıda ve Enerji Hariç)",
    "Bavaria CPI": "Bavyera TÜFE",
    "North Rhine Westphalia CPI": "Kuzey Ren-Vestfalya TÜFE",
    "Saxony CPI": "Saksonya TÜFE",
    "Baden Wuerttemberg CPI": "Baden-Württemberg TÜFE",
    "Brandenburg CPI": "Brandenburg TÜFE",
    "Hesse CPI": "Hessen TÜFE",
    "RBA Trimmed Mean CPI": "RBA Düzenlenmiş Ortalama TÜFE",
    "RBA Weighted Median CPI": "RBA Ağırlıklı Medyan TÜFE",
    "Lloyds House Price Index": "Lloyds Konut Fiyat Endeksi",
    "CPI Common": "Ortak TÜFE",
    "IGP-10 Inflation": "IGP-10 Enflasyonu",
    "TD-MI Inflation Gauge": "TD-MI Enflasyon Göstergesi",
    "Balance of Trade Yuan": "Dış Ticaret Dengesi (Yuan)",
    "Cash Reserve Ratio": "Nakit Rezerv Oranı",
    "BoJ Summary of Opinions": "BoJ Görüşler Özeti",
    "ECB Monetary Policy Meeting Accounts": "ECB Para Politikası Toplantı Tutanakları",
    "Summary of the Key Rate Discussion": "Politika Faizi Tartışmasının Özeti",
    "Jackson Hole Symposium": "Jackson Hole Sempozyumu",
    "National People's Congress": "Ulusal Halk Kongresi",
    "Housing Credit": "Konut Kredisi",
    "Jobs/applications ratio": "İş/Başvuru Oranı",
    "NY Fed Bill Purchases 1 to 4 months": "NY Fed Bono Alımları (1-4 Ay)",
    "NY Fed Bill Purchases 4 to 12 months": "NY Fed Bono Alımları (4-12 Ay)",
    "Loan Officer Survey": "Kredi Yetkilileri Anketi",
    "Treasury Refunding Announcement": "Hazine Borçlanma Duyurusu",
    "Treasury Refunding Financing Estimates": "Hazine Borçlanma Finansman Tahminleri",
    "Early Close Bond Market": "Tahvil Piyasası Erken Kapanış",
    "BCB National Monetary Council Meeting": "BCB Ulusal Para Konseyi Toplantısı",
    "FOMC Minutes": "FOMC Toplantı Tutanakları",
    "FOMC Economic Projections": "FOMC Ekonomik Projeksiyonları",
    "MPC Meeting Summary": "PPK Toplantı Özeti",
    "MPC Meeting Minutes": "PPK Toplantı Tutanakları",
    "Inflation Report": "Enflasyon Raporu",
    "Wage Price Index": "Ücret Fiyat Endeksi",
    "Labour Productivity": "İşgücü Verimliliği",
    "Home Loans": "Konut Kredileri",
    "Real Consumer Spending": "Reel Tüketici Harcamaları",
    "Senior Loan Officer Survey": "Kıdemli Kredi Yetkilileri Anketi",
    "Bundesbank Monthly Report": "Bundesbank Aylık Raporu",
    "Total Household Debt": "Toplam Hanehalkı Borcu",
    "Non Farm Payrolls Annual Revision": "Tarım Dışı İstihdam Yıllık Revizyonu",
    "Private Capital Expenditure": "Özel Sermaye Harcamaları",
    "Fed Chair Powell Testimony": "Fed Başkanı Powell'ın Kongre Sunumu",
    "Chicago PMI": "Chicago PMI",
}

# Holidays and one-off days TradingView lists as all-day events.
HOLIDAYS: dict[str, str] = {
    "Labor Day": "İşçi Bayramı",
    "Labour Day": "İşçi Bayramı",
    "Labour and Solidarity Day": "Emek ve Dayanışma Günü",
    "Independence Day": "Bağımsızlık Günü",
    "Columbus Day": "Kolomb Günü",
    "Thanksgiving Day": "Şükran Günü",
    "Christmas Day": "Noel",
    "Christmas Eve": "Noel Arifesi",
    "New Year's Day": "Yılbaşı",
    "New Year's Eve": "Yılbaşı Arifesi",
    "Good Friday": "Kutsal Cuma",
    "Easter Monday": "Paskalya Pazartesisi",
    "Whit Monday": "Pentekost Pazartesisi",
    "Ascension Day": "Göğe Yükseliş Günü",
    "Memorial Day": "Anma Günü",
    "Presidents' Day": "Başkanlar Günü",
    "Martin Luther King Jr. Day": "Martin Luther King Günü",
    "German Unity Day": "Alman Birliği Günü",
    "Mid-Autumn Festival": "Ay Festivali",
    "National Day Golden Week": "Ulusal Gün Tatili (Altın Hafta)",
    "National Day": "Ulusal Gün",
    "Spring Festival": "Çin Yeni Yılı",
    "Chinese New Year": "Çin Yeni Yılı",
    "Dragon Boat Festival": "Ejderha Teknesi Festivali",
    "Autumnal Equinox Day": "Sonbahar Ekinoksu Tatili",
    "Respect for the Aged Day": "Yaşlılara Saygı Günü",
    "Health and Sports Day": "Spor Günü",
    "National Foundation Day": "Ulusal Kuruluş Günü",
    "Hangeul Proclamation Day": "Hangıl Günü",
    "Republic Day": "Cumhuriyet Bayramı",
    "Victory Day": "Zafer Bayramı",
    "Ramadan Feast": "Ramazan Bayramı",
    "Eid al-Fitr": "Ramazan Bayramı",
    "Sacrifice Feast": "Kurban Bayramı",
    "Eid al-Adha": "Kurban Bayramı",
    "Democracy and National Unity Day": "Demokrasi ve Millî Birlik Günü",
    "National Sovereignty and Children's Day": "Ulusal Egemenlik ve Çocuk Bayramı",
    "Bank Holiday": "Banka Tatili",
    "UN General Assembly": "BM Genel Kurulu",
    "BRICS Summit": "BRICS Zirvesi",
    "G20 Summit": "G20 Zirvesi",
    "G7 Summit": "G7 Zirvesi",
    "Parliamentary Election": "Parlamento Seçimi",
    "General Elections": "Genel Seçimler",
    "Presidential Election": "Cumhurbaşkanlığı Seçimi",
    "Assumption of Mary": "Meryem Ana'nın Göğe Kabulü",
    "All Saints' Day": "Azizler Günü",
    "Swiss National Day": "İsviçre Ulusal Günü",
    "Early May Bank Holiday": "Mayıs Başı Banka Tatili",
    "Spring Bank Holiday": "Bahar Banka Tatili",
    "Summer Bank Holiday": "Yaz Banka Tatili",
    "Late Summer Bank Holiday": "Yaz Sonu Banka Tatili",
    "Civic Holiday": "Sivil Tatil",
    "Mountain Day": "Dağ Günü",
    "Culture Day": "Kültür Günü",
    "Labour Thanksgiving Day": "Emek Şükran Günü",
    "Veterans Day": "Gaziler Günü",
    "Remembrance Day": "Anma Günü",
    "Chuseok": "Chuseok (Hasat Bayramı)",
}


def _speech(base: str) -> str | None:
    match = _SPEECH_RE.match(base)
    if not match:
        return None
    role = f"{_ROLES[match['role']]} " if match["role"] else ""
    return f"{match['bank']} {role}{match['name']} Konuşması"


def _pmi(base: str) -> str | None:
    match = _PMI_RE.match(base)
    if not match or not (match["issuer"] or match["kind"]):
        return None
    issuer = _PMI_ISSUERS.get(match["issuer"], match["issuer"])
    return " ".join(part for part in (issuer, _PMI_KINDS.get(match["kind"] or "", ""), "PMI") if part)


def _instrument(name: str) -> str:
    if name in _INSTRUMENTS:
        return _INSTRUMENTS[name]
    # UK gilts, as doviz.com names them: "Treasury Gilt 2049" → "Hazine Gilt 2049".
    return name.replace("Index-linked Treasury Gilt", "Endeksli Hazine Gilt").replace("Treasury Gilt", "Hazine Gilt")


def _auction(base: str) -> str | None:
    if match := _TENOR_AUCTION_RE.match(base):
        return f"{match['n']} {_TENORS[match['unit']]} {_instrument(match['instrument'])} İhalesi"
    if match := _AUCTION_RE.match(base):
        return f"{_instrument(match['instrument'])} İhalesi"
    return None


def _institution(base: str) -> str | None:
    if match := _DECISION_RE.match(base):
        return f"{match['bank']} Faiz Kararı" if match["bank"] else "Faiz Kararı"
    if match := _PRESS_RE.match(base):
        return f"{match['who']} Basın Toplantısı"
    if match := _MINUTES_RE.match(base):
        return f"{match['who']} Toplantı Tutanakları"
    if base.endswith(" Meeting") and (who := base[: -len(" Meeting")]) in _MEETINGS:
        return f"{_MEETINGS[who]} Toplantısı"
    return None


_RULES: tuple[Callable[[str], str | None], ...] = (_speech, _pmi, _auction, _institution)


def _translate_base(base: str) -> str | None:
    if hit := TITLES.get(base) or _BASES.get(base) or MANUAL.get(base) or HOLIDAYS.get(base):
        return hit
    for rule in _RULES:
        if result := rule(base):
            return result
    return None


def translate_title(title_en: str) -> str | None:
    """Turkish name of a TradingView event, or ``None`` when none is known."""
    title = _clean(title_en)
    if not title:
        return None
    if hit := TITLES.get(title) or MANUAL.get(title) or HOLIDAYS.get(title):
        return hit
    base, qualifiers = split_qualifiers(title)
    if not qualifiers:
        return _translate_base(title)
    translated = _translate_base(base)
    if not translated:
        return None
    return translated + "".join(f" ({_QUALIFIER_TR[q]})" for q in qualifiers)


def learned_importance(country: str, title_en: str) -> str | None:
    """doviz.com's importance for this event (``low`` / ``mid`` / ``high``), when paired."""
    return IMPORTANCE.get(f"{country}|{_clean(title_en)}")


# ---------------------------------------------------------------------------
# Pairing (used by scripts/harvest_calendar_titles.py)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TitlePair:
    country: str
    title_en: str
    title_tr: str
    importance: str
    by_value: bool


def _tv_slot(event: Mapping[str, Any]) -> tuple[str, str, str] | None:
    try:
        when = datetime.fromisoformat(str(event["date"]).replace("Z", "+00:00")).astimezone(ISTANBUL_TZ)
    except (KeyError, ValueError):
        return None
    return str(event.get("country") or "").upper(), when.date().isoformat(), when.strftime("%H:%M")


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _close(a: float | None, b: float | None) -> bool | None:
    """``None`` when either side is missing (no evidence either way)."""
    if a is None or b is None:
        return None
    return abs(a - b) <= max(0.0051, abs(b) * 0.002)


def _anchors(title: str) -> set[str]:
    return {token for token in re.split(r"[\s()/,:]+", title) if len(token) >= 2}


# Named by the patterns above, never guessed from a lone same-time neighbour.
_PATTERN_ONLY_RE = re.compile(r"(?: Speech| PMI(?: Final| Flash| Prel)?| Auction)$")


def pair_titles(doviz_rows: Iterable[Mapping[str, Any]], tv_events: Iterable[Mapping[str, Any]]) -> list[TitlePair]:
    """Pair doviz.com rows with TradingView events of the same release.

    Pass 1: same country, Istanbul day and time, and every value both sides publish
    (previous, actual) agrees — exactly one candidate. Pass 2: at a slot where exactly one
    event of each source is left unpaired, pair them when their names share a token
    ("Fed Beige Book" ↔ "Fed Bej Kitap"); speeches, PMIs and auctions are left to the
    patterns.
    """
    slots: dict[tuple[str, str, str], list[Mapping[str, Any]]] = defaultdict(list)
    for event in tv_events:
        if (slot := _tv_slot(event)) and event.get("title"):
            slots[slot].append(event)

    rows_by_slot: dict[tuple[str, str, str], list[Mapping[str, Any]]] = defaultdict(list)
    for row in doviz_rows:
        if row.get("Time") and row.get("title"):
            rows_by_slot[(str(row["country_code"]), str(row["Date"]), str(row["Time"]))].append(row)

    pairs: list[TitlePair] = []
    for slot, rows in rows_by_slot.items():
        events = slots.get(slot, [])
        used_events: set[int] = set()
        unpaired_rows: list[Mapping[str, Any]] = []
        for row in rows:
            previous, actual = _number(row.get("previous_value")), _number(row.get("actual_value"))
            hits = []
            for index, event in enumerate(events):
                checks = [
                    c
                    for c in (_close(previous, _number(event.get("previous"))), _close(actual, _number(event.get("actual"))))
                    if c is not None
                ]
                if checks and all(checks):
                    hits.append(index)
            if len(hits) == 1 and hits[0] not in used_events:
                used_events.add(hits[0])
                event = events[hits[0]]
                pairs.append(TitlePair(slot[0], _clean(str(event["title"])), _clean(str(row["title"])), str(row["Importance"]), True))
            else:
                unpaired_rows.append(row)
        left = [event for index, event in enumerate(events) if index not in used_events]
        if len(unpaired_rows) == 1 and len(left) == 1:
            row, event = unpaired_rows[0], left[0]
            title_en, title_tr = _clean(str(event["title"])), _clean(str(row["title"]))
            if not _PATTERN_ONLY_RE.search(title_en) and _anchors(title_en) & _anchors(title_tr):
                pairs.append(TitlePair(slot[0], title_en, title_tr, str(row["Importance"]), False))
    return pairs


def harvest(pairs: Iterable[TitlePair]) -> tuple[dict[str, str], dict[str, str]]:
    """Majority vote per English name (titles) and per country + name (importance)."""
    titles: dict[str, Counter[str]] = defaultdict(Counter)
    importance: dict[str, Counter[str]] = defaultdict(Counter)
    for pair in pairs:
        # A value-matched pair outvotes a same-slot guess.
        titles[pair.title_en][pair.title_tr] += 3 if pair.by_value else 1
        importance[f"{pair.country}|{pair.title_en}"][pair.importance] += 1
    return (
        {title: votes.most_common(1)[0][0] for title, votes in titles.items()},
        {key: votes.most_common(1)[0][0] for key, votes in importance.items()},
    )
