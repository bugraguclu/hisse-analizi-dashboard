"""Input limits, investment-advice detection and untrusted-text handling."""

from __future__ import annotations

import re
import unicodedata

from src.services.event_service import fold_turkish

MAX_QUESTION_CHARS = 500
MAX_HISTORY_TURNS = 6
MAX_HISTORY_CHARS = 2000
MAX_WATCHLIST_TICKERS = 40
MAX_PATH_CHARS = 200

DISCLAIMER = {
    "tr": "Yatırım tavsiyesi değildir. Yanıtlar yalnızca Hisse Analizi'ndeki verilere dayanır ve hata içerebilir; kaynakları kontrol edin.",
    "en": "Not investment advice. Answers rely only on Hisse Analizi's data and may contain mistakes; check the sources.",
    "fr": "Ceci n'est pas un conseil en investissement. Les réponses reposent uniquement sur les données de Hisse Analizi et peuvent contenir des erreurs ; vérifiez les sources.",
}

ADVICE_REFUSAL = {
    "tr": (
        "Al, sat veya tut önerisi veremem; fiyat tahmini de yapmam. Bu bir yatırım tavsiyesi olur ve "
        "Hisse Analizi yatırım danışmanlığı yapmaz.\n\n"
        "Bunun yerine verileri açıklayabilirim, örneğin:\n"
        "- \"{ticker} için F/K ve PD/DD nasıl hesaplandı?\"\n"
        "- \"{ticker} için son bilanço ne söylüyor?\"\n"
        "- \"{ticker} için son KAP bildirimleri neler?\""
    ),
    "en": (
        "I can't give buy, sell or hold recommendations or price predictions; that would be investment advice, "
        "and Hisse Analizi does not provide it.\n\n"
        "I can explain the data instead, for example:\n"
        "- \"How were {ticker}'s P/E and P/B calculated?\"\n"
        "- \"What does {ticker}'s latest balance sheet say?\"\n"
        "- \"What are {ticker}'s latest KAP disclosures?\""
    ),
    "fr": (
        "Je ne peux pas recommander d'acheter, de vendre ou de conserver un titre, ni prévoir un cours : ce serait "
        "un conseil en investissement, que Hisse Analizi ne fournit pas.\n\n"
        "Je peux en revanche expliquer les données, par exemple :\n"
        "- « Comment le PER et le C/VC de {ticker} sont-ils calculés ? »\n"
        "- « Que dit le dernier bilan de {ticker} ? »\n"
        "- « Quelles sont les dernières publications KAP de {ticker} ? »"
    ),
}

# Matched on fold_turkish() text (lower case, Turkish diacritics removed).
_ADVICE_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"\b(almali|satmali|tutmali|eklemeli|girmeli|cikmali|yatirim yapmali)\s*(mi|mı|miyim|miyiz|yim)?\b",
        r"\b(alinir|satilir|alinmali|satilmali|tutulmali|toplanir) ?mi\b",
        r"\b(alayim|satayim|tutayim|alsam|satsam|girsem|cikayim) ?(mi|mı)?\b",
        r"\b(al|sat|tut) (mi|mı)\b",
        r"\bhangi hisse(yi|leri|ler)? (al|sat|tavsiye|oner)",
        r"\b(tavsiye|oneri|onerir) (eder misin|edermisin|verir misin|misin|var mi)\b",
        r"\b(hisse|hisseyi|hisseleri)? ?(onerir misin|tavsiye eder misin)\b",
        r"\b(yukselir|duser|ucar|coker|yukselecek|dusecek) (mi|mı)\b",
        r"\bne kadar (yukselir|duser|yukselecek|dusecek)\b",
        r"\bkac (tl|lira) ?(olur|olacak)\b",
        r"\bfiyati? (ne|kac) (olur|olacak)\b",
        r"\bfiyat tahmin",
        r"\bshould i (buy|sell|hold|invest)\b",
        r"\b(is|are) \w+ (a )?(good|great|bad) (buy|investment|stock to buy)\b",
        r"\bwill \w+ (go up|go down|rise|fall|drop|climb)\b",
        r"\b(recommend|suggest) (a |any |which )?(stock|share)s?\b",
        r"\bprice (prediction|forecast)\b",
        r"\b(dois-je|devrais-je|faut-il) (acheter|vendre|garder)\b",
        r"\b(va|vont)-t?-?(il|elle|ils|elles) (monter|baisser)\b",
    )
)

_CONTROL_RE = re.compile(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]")
_SPACE_RE = re.compile(r"[ \t]+")
_TICKER_RE = re.compile(r"^[A-Z0-9]{2,10}$")


def is_advice_request(question: str) -> bool:
    """Explicit buy/sell/hold or price-prediction requests (answered with a fixed refusal)."""
    folded = fold_turkish(question)
    return any(pattern.search(folded) for pattern in _ADVICE_PATTERNS)


def clean_user_text(text: str, limit: int) -> str:
    """Normalise user input: NFC, no control/bidi characters, bounded length."""
    text = unicodedata.normalize("NFC", text or "")
    text = _CONTROL_RE.sub("", text)
    text = _SPACE_RE.sub(" ", text).strip()
    return text[:limit]


def untrusted(text: str | None, limit: int = 400) -> str | None:
    """Third-party text (KAP titles/summaries, news) as inert data for the model.

    Square brackets are replaced so the text cannot fake ``[n]`` citation markers;
    control characters and newlines are dropped; the length is capped.
    """
    if not text:
        return None
    text = unicodedata.normalize("NFC", str(text))
    text = _CONTROL_RE.sub(" ", text).replace("\r", " ").replace("\n", " ")
    text = text.replace("[", "(").replace("]", ")").replace("<", "‹").replace(">", "›")
    text = _SPACE_RE.sub(" ", text).strip()
    return text[: limit - 1] + "…" if len(text) > limit else text


def valid_tickers(values: list[str] | None, limit: int = MAX_WATCHLIST_TICKERS) -> list[str]:
    out: list[str] = []
    for value in values or []:
        ticker = (value or "").strip().upper()
        if _TICKER_RE.fullmatch(ticker) and ticker not in out:
            out.append(ticker)
        if len(out) >= limit:
            break
    return out
