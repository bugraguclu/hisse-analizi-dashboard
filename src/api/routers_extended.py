"""Genişletilmiş API endpoint'leri — finansal, makro, teknik, piyasa verileri."""
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.adapters.financials import CompanyInfoAdapter, FinancialAdapter, DividendAdapter
from src.adapters.macro import MacroAdapter, ForexAdapter, IndexAdapter, CalendarAdapter
from src.adapters.technical import TechnicalAdapter, ScreenerAdapter

DB = Annotated[AsyncSession, Depends(get_db)]


# ═══════════════════════════════════════════════════════════════
#  COMPANY DATA (şirket bazlı)
# ═══════════════════════════════════════════════════════════════
company_router = APIRouter(prefix="/company", tags=["company"])


@company_router.get("/{ticker}/info")
async def get_company_info(ticker: str):
    """Şirket detay bilgileri: piyasa değeri, sektör, çalışan sayısı vb."""
    adapter = CompanyInfoAdapter(ticker.upper())
    info = await adapter.fetch_info()
    if info is None:
        raise HTTPException(status_code=404, detail=f"{ticker} bilgileri alınamadı")
    return {"ticker": ticker.upper(), "info": info}


@company_router.get("/{ticker}/holders")
async def get_major_holders(ticker: str):
    """Büyük ortaklar ve ortaklık yapısı."""
    adapter = CompanyInfoAdapter(ticker.upper())
    holders = await adapter.fetch_major_holders()
    return {"ticker": ticker.upper(), "holders": holders}


@company_router.get("/{ticker}/dividends")
async def get_dividends(ticker: str):
    """Temettü ödeme geçmişi."""
    adapter = DividendAdapter(ticker.upper())
    dividends = await adapter.fetch_dividends()
    return {"ticker": ticker.upper(), "dividends": dividends}


# ═══════════════════════════════════════════════════════════════
#  FINANCIALS (finansal tablolar)
# ═══════════════════════════════════════════════════════════════
financial_router = APIRouter(prefix="/financials", tags=["financials"])


@financial_router.get("/{ticker}")
async def get_all_financials(ticker: str, quarterly: bool = True):
    """Tüm finansal tablolar: bilanço, gelir tablosu, nakit akışı."""
    adapter = FinancialAdapter(ticker.upper())
    data = await adapter.fetch_all(quarterly=quarterly)
    return {"ticker": ticker.upper(), "period": "quarterly" if quarterly else "annual", **data}


@financial_router.get("/{ticker}/balance-sheet")
async def get_balance_sheet(ticker: str, quarterly: bool = True):
    """Bilanço."""
    adapter = FinancialAdapter(ticker.upper())
    data = await adapter.fetch_balance_sheet(quarterly=quarterly)
    return {"ticker": ticker.upper(), "statement_type": "balance_sheet", "data": data}


@financial_router.get("/{ticker}/income-statement")
async def get_income_statement(ticker: str, quarterly: bool = True):
    """Gelir tablosu."""
    adapter = FinancialAdapter(ticker.upper())
    data = await adapter.fetch_income_statement(quarterly=quarterly)
    return {"ticker": ticker.upper(), "statement_type": "income_stmt", "data": data}


@financial_router.get("/{ticker}/cashflow")
async def get_cashflow(ticker: str, quarterly: bool = True):
    """Nakit akış tablosu."""
    adapter = FinancialAdapter(ticker.upper())
    data = await adapter.fetch_cashflow(quarterly=quarterly)
    return {"ticker": ticker.upper(), "statement_type": "cashflow", "data": data}


# ═══════════════════════════════════════════════════════════════
#  TECHNICAL (teknik analiz)
# ═══════════════════════════════════════════════════════════════
technical_router = APIRouter(prefix="/technical", tags=["technical"])


@technical_router.get("/{ticker}")
async def get_all_indicators(ticker: str):
    """Tüm temel teknik göstergeler: RSI, MACD, Bollinger, SMA, EMA."""
    adapter = TechnicalAdapter(ticker.upper())
    indicators = await adapter.fetch_all_indicators()
    return {"ticker": ticker.upper(), "indicators": indicators}


@technical_router.get("/{ticker}/rsi")
async def get_rsi(ticker: str, period: int = Query(default=14, ge=5, le=50)):
    """RSI (Relative Strength Index) göstergesi."""
    adapter = TechnicalAdapter(ticker.upper())
    data = await adapter.fetch_rsi(period=period)
    return {"ticker": ticker.upper(), "indicator": "RSI", "period": period, "data": data}


@technical_router.get("/{ticker}/macd")
async def get_macd(ticker: str):
    """MACD göstergesi (line, signal, histogram)."""
    adapter = TechnicalAdapter(ticker.upper())
    data = await adapter.fetch_macd()
    return {"ticker": ticker.upper(), "indicator": "MACD", "data": data}


@technical_router.get("/{ticker}/bollinger")
async def get_bollinger(ticker: str, period: int = Query(default=20, ge=5, le=50)):
    """Bollinger Bands (upper, middle, lower)."""
    adapter = TechnicalAdapter(ticker.upper())
    data = await adapter.fetch_bollinger(period=period)
    return {"ticker": ticker.upper(), "indicator": "BBANDS", "period": period, "data": data}


@technical_router.get("/{ticker}/sma")
async def get_sma(ticker: str, period: int = Query(default=50, ge=5, le=500)):
    """SMA (Simple Moving Average) göstergesi."""
    adapter = TechnicalAdapter(ticker.upper())
    data = await adapter.fetch_sma(period=period)
    return {"ticker": ticker.upper(), "indicator": "SMA", "period": period, "data": data}


@technical_router.get("/{ticker}/ema")
async def get_ema(ticker: str, period: int = Query(default=20, ge=5, le=500)):
    """EMA (Exponential Moving Average) göstergesi."""
    adapter = TechnicalAdapter(ticker.upper())
    data = await adapter.fetch_ema(period=period)
    return {"ticker": ticker.upper(), "indicator": "EMA", "period": period, "data": data}


# ═══════════════════════════════════════════════════════════════
#  MACRO (makroekonomik veriler)
# ═══════════════════════════════════════════════════════════════
macro_router = APIRouter(prefix="/macro", tags=["macro"])


@macro_router.get("/tcmb")
async def get_tcmb_rates():
    """TCMB faiz oranları ve kur verileri."""
    adapter = MacroAdapter()
    data = await adapter.fetch_tcmb_rates()
    return {"source": "TCMB", "data": data}


@macro_router.get("/inflation")
async def get_inflation():
    """Enflasyon verileri (TÜFE, ÜFE)."""
    adapter = MacroAdapter()
    data = await adapter.fetch_inflation()
    return {"source": "TUIK", "data": data}


@macro_router.get("/policy-rate")
async def get_policy_rate():
    """TCMB politika faiz oranı."""
    adapter = MacroAdapter()
    data = await adapter.fetch_policy_rate()
    return {"source": "TCMB", "data": data}


# ═══════════════════════════════════════════════════════════════
#  MARKET (piyasa verileri)
# ═══════════════════════════════════════════════════════════════
market_router = APIRouter(prefix="/market", tags=["market"])


@market_router.get("/fx")
async def get_forex_rates():
    """Döviz kurları: USD/TRY, EUR/TRY vb."""
    adapter = ForexAdapter()
    rates = await adapter.fetch_rates()
    return {"source": "doviz.com", "rates": rates}


@market_router.get("/indices")
async def get_all_indices():
    """Ana BIST endeksleri: XU100, XU030, XBANK, XUSIN, XHOLD."""
    adapter = IndexAdapter()
    data = await adapter.fetch_all_indices()
    return {"indices": data}


@market_router.get("/indices/{index_code}")
async def get_index(index_code: str, period: str = "1ay"):
    """Tek endeks verisi."""
    adapter = IndexAdapter()
    data = await adapter.fetch_index(index_code.upper(), period=period)
    return {"index_code": index_code.upper(), "period": period, "data": data}


@market_router.get("/calendar")
async def get_economic_calendar():
    """Ekonomik takvim."""
    adapter = CalendarAdapter()
    events = await adapter.fetch_calendar()
    return {"events": events}


# ═══════════════════════════════════════════════════════════════
#  SCREENER (hisse tarama)
# ═══════════════════════════════════════════════════════════════
screener_router = APIRouter(prefix="/screener", tags=["screener"])


@screener_router.get("/scan")
async def screen_stocks(
    pe_lt: float | None = None,
    pe_gt: float | None = None,
    roe_gt: float | None = None,
    market_cap_gt: float | None = None,
    volume_gt: float | None = None,
):
    """Hisse tarama — filtrelere göre sonuçlar."""
    filters = {}
    if pe_lt is not None:
        filters["pe_lt"] = pe_lt
    if pe_gt is not None:
        filters["pe_gt"] = pe_gt
    if roe_gt is not None:
        filters["roe_gt"] = roe_gt
    if market_cap_gt is not None:
        filters["market_cap_gt"] = market_cap_gt
    if volume_gt is not None:
        filters["volume_gt"] = volume_gt

    adapter = ScreenerAdapter()
    results = await adapter.screen(filters if filters else None)
    return {"filters": filters, "count": len(results), "results": results}
