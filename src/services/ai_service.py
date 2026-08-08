"""AI analiz raporu servisi.

Generate-Once modeli:
1. Hisse verisi anlik goruntusu (snapshot) toplanir — fiyat serisi, canli temel
   gostergeler, teknik sinyaller, finansal oranlar (4 donem), KAP olaylari ve
   makro baglam (politika faizi, enflasyon, USD/TRY)
2. Snapshot'in SHA-256 ozeti hesaplanir
3. DB'de ayni hash'li rapor varsa aninda dondurulur (<1sn, LLM maliyeti yok)
4. Yoksa secili LLM (Gemini/Claude) cagirilir ve sonuc hash ile kaydedilir

Snapshot bilincli olarak zengin tutulur: model her iddiasini bu JSON'daki
verilere dayandirmak ve kanit gostermek zorundadir (bkz. prompts/report_tr.md).
"""

from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any, AsyncIterator

import structlog
from sqlalchemy import desc, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.llm import LLMResult, get_llm_client
from src.adapters.fundamentals import get_fast_info
from src.adapters.macro import get_fx_rates, get_inflation, get_policy_rate
from src.adapters.technical import get_ta_signals
from src.db.models import AIReport, Company, FinancialRatio, NormalizedEvent, PriceData

logger = structlog.get_logger(__name__)

_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "report_tr.md"
_system_prompt_cache: str | None = None

_PRICE_HISTORY_DAYS = 30
_RATIO_PERIODS = 4
_EVENT_COUNT = 10


def get_system_prompt() -> str:
    global _system_prompt_cache
    if _system_prompt_cache is None:
        _system_prompt_cache = _PROMPT_PATH.read_text(encoding="utf-8")
    return _system_prompt_cache


def _to_jsonable(value: Any) -> Any:
    """Decimal/date gibi tipleri JSON'a cevirir."""
    if isinstance(value, dict):
        return {k: _to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(v) for v in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, (int, float, str, bool)) or value is None:
        return value
    return str(value)


def compute_snapshot_hash(snapshot: dict) -> str:
    canonical = json.dumps(_to_jsonable(snapshot), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _pct(new: float, old: float) -> float | None:
    if old == 0:
        return None
    return round((new - old) / old * 100, 2)


def _scalars_only(d: Any) -> dict:
    """Sadece skaler alanlari birakir (token butcesini korur)."""
    if not isinstance(d, dict):
        return {}
    return {
        k: v
        for k, v in d.items()
        if isinstance(v, (int, float, str, bool)) and v is not None and str(v).lower() != "nan"
    }


async def _price_block(session: AsyncSession, ticker: str) -> dict[str, Any]:
    prices_res = await session.execute(
        select(PriceData)
        .where(PriceData.ticker == ticker)
        .order_by(desc(PriceData.trading_date))
        .limit(_PRICE_HISTORY_DAYS)
    )
    prices = list(prices_res.scalars().all())
    if not prices:
        return {}

    latest = prices[0]
    closes = [float(p.close) for p in prices if p.close is not None]
    block: dict[str, Any] = {
        "son_islem_gunu": latest.trading_date,
        "kapanis": latest.close,
        "acilis": latest.open,
        "yuksek": latest.high,
        "dusuk": latest.low,
        "hacim": latest.volume,
    }
    if len(closes) > 1:
        block["gunluk_degisim_yuzde"] = _pct(closes[0], closes[1])
    if len(closes) > 5:
        block["haftalik_degisim_yuzde"] = _pct(closes[0], closes[5])
    if len(closes) >= 21:
        block["aylik_degisim_yuzde"] = _pct(closes[0], closes[20])
    # Gunluk seri (eski -> yeni): olay-fiyat iliskisi kurabilmesi icin
    block["gunluk_seri"] = [
        {"tarih": p.trading_date, "kapanis": p.close, "hacim": p.volume}
        for p in reversed(prices)
    ]
    return block


async def _ratios_block(session: AsyncSession, company: Company) -> list[dict[str, Any]]:
    ratios_res = await session.execute(
        select(FinancialRatio)
        .where(FinancialRatio.company_id == company.id)
        .order_by(desc(FinancialRatio.period))
        .limit(_RATIO_PERIODS)
    )
    out: list[dict[str, Any]] = []
    for ratio in ratios_res.scalars().all():
        row = {
            "donem": ratio.period,
            "roe": ratio.roe,
            "roa": ratio.roa,
            "net_marj": ratio.net_margin,
            "brut_marj": ratio.gross_margin,
            "favok_marj": ratio.ebitda_margin,
            "borc_ozkaynak": ratio.debt_to_equity,
            "cari_oran": ratio.current_ratio,
            "net_borc_favok": ratio.net_debt_ebitda,
        }
        out.append({k: v for k, v in row.items() if v is not None})
    return out


async def _events_block(session: AsyncSession, company: Company) -> list[dict[str, Any]]:
    events_res = await session.execute(
        select(NormalizedEvent)
        .where(NormalizedEvent.company_id == company.id)
        .order_by(desc(NormalizedEvent.published_at))
        .limit(_EVENT_COUNT)
    )
    return [
        {
            "baslik": e.title,
            "tarih": e.published_at,
            "kategori": str(e.category.value) if e.category else None,
            "onem": str(e.severity.value) if e.severity else None,
        }
        for e in events_res.scalars().all()
    ]


async def _macro_block() -> dict[str, Any]:
    """Makro baglam — TTL cache'li adapter'lar, hata durumunda bos birakilir."""
    block: dict[str, Any] = {}
    try:
        pr = await get_policy_rate()
        if pr.get("policy_rate"):
            block["tcmb_politika_faizi"] = pr["policy_rate"]
    except Exception as e:
        logger.warning("ai_snapshot_macro_policy_error", error=str(e))
    try:
        inf = await get_inflation()
        if inf.get("latest"):
            block["enflasyon"] = _scalars_only(inf["latest"])
    except Exception as e:
        logger.warning("ai_snapshot_macro_inflation_error", error=str(e))
    try:
        fx = await get_fx_rates("USD")
        hist = fx.get("history") or []
        if hist:
            last = hist[-1]
            first = hist[0]
            usd: dict[str, Any] = {"son": _scalars_only(last)}
            lc = last.get("Close") or last.get("close")
            fc = first.get("Close") or first.get("close")
            if lc and fc:
                usd["aylik_degisim_yuzde"] = _pct(float(lc), float(fc))
            block["usd_try"] = usd
    except Exception as e:
        logger.warning("ai_snapshot_macro_fx_error", error=str(e))
    return block


async def build_snapshot(session: AsyncSession, company: Company) -> dict:
    """Rapor girdisi: DB + canli adapter'lardan zengin JSON anlik goruntusu."""
    ticker = company.ticker

    price_block = await _price_block(session, ticker)

    # Canli temel gostergeler (piyasa degeri, F/K, 52 hafta araligi vb.)
    fast = await get_fast_info(ticker)
    fast_block = _scalars_only(fast.get("fast_info", {}))

    # Teknik sinyaller (canli, borsapy)
    signals = await get_ta_signals(ticker)
    signals_block = signals.get("signals", {}) if isinstance(signals, dict) else {}

    ratios_block = await _ratios_block(session, company)
    events_block = await _events_block(session, company)
    macro_block = await _macro_block()

    # Son 48 saatin web haberleri (duygu/etki etiketli) — haber degisince
    # snapshot hash'i de degisir ve rapor otomatik yenilenir
    from src.services.news_service import news_summary_for_snapshot

    news_block = await news_summary_for_snapshot(session, company, hours=48)

    return _to_jsonable(
        {
            "hisse": ticker,
            "sirket": company.display_name,
            "fiyat": price_block,
            "canli_temel_gostergeler": fast_block,
            "teknik_sinyaller": signals_block,
            "finansal_oranlar_donemsel": ratios_block,
            "son_kap_olaylari": events_block,
            "son_web_haberleri": news_block,
            "makro_baglam": macro_block,
        }
    )


def _user_content(snapshot: dict) -> str:
    return (
        "Asagidaki JSON verisine dayanarak analiz raporunu yaz. Unutma: her iddiani "
        "bu JSON'daki somut bir degere dayandir ve kanitini goster.\n\n```json\n"
        + json.dumps(snapshot, ensure_ascii=False, indent=2)
        + "\n```"
    )


async def _get_company(session: AsyncSession, ticker: str) -> Company | None:
    res = await session.execute(select(Company).where(Company.ticker == ticker))
    return res.scalar_one_or_none()


async def _find_cached(session: AsyncSession, content_hash: str) -> AIReport | None:
    res = await session.execute(select(AIReport).where(AIReport.content_hash == content_hash))
    return res.scalar_one_or_none()


async def _save_report(
    session: AsyncSession,
    company: Company,
    content_hash: str,
    snapshot: dict,
    result: LLMResult,
) -> None:
    if not result.text.strip():
        logger.warning("ai_report_empty_not_saved", ticker=company.ticker, hash=content_hash[:12])
        return
    stmt = (
        pg_insert(AIReport)
        .values(
            id=uuid.uuid4(),
            company_id=company.id,
            content_hash=content_hash,
            report_text=result.text,
            model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            input_data_json=snapshot,
        )
        .on_conflict_do_nothing(index_elements=["content_hash"])
    )
    await session.execute(stmt)
    await session.commit()


async def get_or_generate_report(
    session: AsyncSession, ticker: str, force: bool = False
) -> dict:
    """Cache'ten rapor dondurur; yoksa (veya force ise) LLM ile uretir."""
    company = await _get_company(session, ticker)
    if company is None:
        raise LookupError(f"{ticker} veritabaninda bulunamadi")

    snapshot = await build_snapshot(session, company)
    content_hash = compute_snapshot_hash(snapshot)

    if not force:
        cached = await _find_cached(session, content_hash)
        if cached:
            return {
                "ticker": ticker,
                "report": cached.report_text,
                "generated_at": cached.generated_at.isoformat(),
                "cached": True,
                "model": cached.model,
                "input_hash": content_hash,
            }

    llm = get_llm_client()
    result = await llm.generate(get_system_prompt(), _user_content(snapshot))
    await _save_report(session, company, content_hash, snapshot, result)
    logger.info("ai_report_generated", ticker=ticker, hash=content_hash[:12], cost_usd=round(result.cost_usd, 4))
    return {
        "ticker": ticker,
        "report": result.text,
        "generated_at": None,
        "cached": False,
        "model": result.model,
        "input_hash": content_hash,
    }


async def stream_report(session: AsyncSession, ticker: str) -> AsyncIterator[dict]:
    """SSE icin olay akisi: {'event': ..., 'data': ...} sozlukleri yield eder."""
    company = await _get_company(session, ticker)
    if company is None:
        yield {"event": "error", "data": f"{ticker} veritabaninda bulunamadi"}
        return

    snapshot = await build_snapshot(session, company)
    content_hash = compute_snapshot_hash(snapshot)

    cached = await _find_cached(session, content_hash)
    if cached:
        yield {"event": "cached", "data": cached.report_text}
        yield {"event": "done", "data": ""}
        return

    llm = get_llm_client()
    final: LLMResult | None = None
    async for chunk in llm.generate_stream(get_system_prompt(), _user_content(snapshot)):
        if isinstance(chunk, LLMResult):
            final = chunk
        else:
            yield {"event": "delta", "data": chunk}

    if final is not None:
        await _save_report(session, company, content_hash, snapshot, final)
        logger.info("ai_report_streamed", ticker=ticker, hash=content_hash[:12])
    yield {"event": "done", "data": ""}
