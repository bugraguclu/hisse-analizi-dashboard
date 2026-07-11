"""AI analiz raporu servisi.

Generate-Once modeli:
1. Hisse verisi anlik goruntusu (snapshot) toplanir: fiyat, teknik sinyaller, oranlar, KAP olaylari
2. Snapshot'in SHA-256 ozeti hesaplanir
3. DB'de ayni hash'li rapor varsa aninda dondurulur (<1sn, LLM maliyeti yok)
4. Yoksa Claude cagirilir ve sonuc hash ile birlikte kaydedilir
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

from src.adapters.llm import LLMResult, llm_client
from src.adapters.technical import get_ta_signals
from src.db.models import AIReport, Company, FinancialRatio, NormalizedEvent, PriceData

logger = structlog.get_logger(__name__)

_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "report_tr.md"
_system_prompt_cache: str | None = None


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


async def build_snapshot(session: AsyncSession, company: Company) -> dict:
    """Rapor girdisi: DB + canli teknik sinyallerden JSON anlik goruntusu."""
    ticker = company.ticker

    # Fiyat: son 5 gunluk kapanis (degisim hesabi icin)
    prices_res = await session.execute(
        select(PriceData)
        .where(PriceData.ticker == ticker)
        .order_by(desc(PriceData.trading_date))
        .limit(5)
    )
    prices = list(prices_res.scalars().all())
    price_block: dict[str, Any] = {}
    if prices:
        latest = prices[0]
        price_block = {
            "tarih": latest.trading_date,
            "kapanis": latest.close,
            "acilis": latest.open,
            "yuksek": latest.high,
            "dusuk": latest.low,
            "hacim": latest.volume,
        }
        if len(prices) > 1 and prices[1].close and latest.close:
            prev = float(prices[1].close)
            if prev != 0:
                price_block["gunluk_degisim_yuzde"] = round(
                    (float(latest.close) - prev) / prev * 100, 2
                )

    # Teknik sinyaller (canli, borsapy)
    signals = await get_ta_signals(ticker)
    signals_block = signals.get("signals", {}) if isinstance(signals, dict) else {}

    # Finansal oranlar: en guncel donem
    ratios_res = await session.execute(
        select(FinancialRatio)
        .where(FinancialRatio.company_id == company.id)
        .order_by(desc(FinancialRatio.period))
        .limit(1)
    )
    ratio = ratios_res.scalar_one_or_none()
    ratios_block: dict[str, Any] = {}
    if ratio:
        ratios_block = {
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
        ratios_block = {k: v for k, v in ratios_block.items() if v is not None}

    # Son KAP olaylari (5 adet)
    events_res = await session.execute(
        select(NormalizedEvent)
        .where(NormalizedEvent.company_id == company.id)
        .order_by(desc(NormalizedEvent.published_at))
        .limit(5)
    )
    events_block = [
        {"baslik": e.title, "tarih": e.published_at, "kategori": str(e.category.value) if e.category else None}
        for e in events_res.scalars().all()
    ]

    return _to_jsonable(
        {
            "hisse": ticker,
            "sirket": company.display_name,
            "fiyat": price_block,
            "teknik_sinyaller": signals_block,
            "finansal_oranlar": ratios_block,
            "son_kap_olaylari": events_block,
        }
    )


def _user_content(snapshot: dict) -> str:
    return (
        "Asagidaki JSON verisine dayanarak analiz raporunu yaz:\n\n```json\n"
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
    """Cache'ten rapor dondurur; yoksa (veya force ise) Claude ile uretir."""
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

    result = await llm_client.generate(get_system_prompt(), _user_content(snapshot))
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

    final: LLMResult | None = None
    async for chunk in llm_client.generate_stream(get_system_prompt(), _user_content(snapshot)):
        if isinstance(chunk, LLMResult):
            final = chunk
        else:
            yield {"event": "delta", "data": chunk}

    if final is not None:
        await _save_report(session, company, content_hash, snapshot, final)
        logger.info("ai_report_streamed", ticker=ticker, hash=content_hash[:12])
    yield {"event": "done", "data": ""}
