"""Genişletilmiş modeller — finansal tablolar, makro veriler, teknik göstergeler."""
import uuid
from datetime import datetime, date
from decimal import Decimal

from sqlalchemy import (
    Column, String, Boolean, Integer, Float, Text,
    DateTime, Date, ForeignKey, UniqueConstraint, Index,
    Enum as SAEnum, Numeric,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from src.db.models import Base


# ─── Şirket Detay Bilgileri ─────────────────────────────────────
class CompanyDetail(Base):
    """Ticker.info → piyasa değeri, sektör, özet bilgi, çalışan sayısı vb."""
    __tablename__ = "company_details"
    __table_args__ = (
        UniqueConstraint("company_id", name="uq_company_details_company"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    market_cap = Column(Numeric(20, 2), nullable=True)
    enterprise_value = Column(Numeric(20, 2), nullable=True)
    sector = Column(String(200), nullable=True)
    industry = Column(String(200), nullable=True)
    website = Column(String(500), nullable=True)
    summary = Column(Text, nullable=True)
    employee_count = Column(Integer, nullable=True)
    pe_ratio = Column(Numeric(12, 4), nullable=True)
    pb_ratio = Column(Numeric(12, 4), nullable=True)
    dividend_yield = Column(Numeric(8, 4), nullable=True)
    beta = Column(Numeric(8, 4), nullable=True)
    fifty_two_week_high = Column(Numeric(12, 4), nullable=True)
    fifty_two_week_low = Column(Numeric(12, 4), nullable=True)
    avg_volume = Column(Float, nullable=True)
    raw_info_json = Column(JSONB, nullable=True)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


# ─── Finansal Tablolar ──────────────────────────────────────────
class FinancialStatement(Base):
    """Ticker.balance_sheet, income_stmt, cashflow → bilanço, gelir tablosu, nakit akışı."""
    __tablename__ = "financial_statements"
    __table_args__ = (
        UniqueConstraint("company_id", "statement_type", "period_end_date", "period_type",
                         name="uq_financial_stmt_unique"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    statement_type = Column(String(50), nullable=False)  # balance_sheet, income_stmt, cashflow
    period_type = Column(String(20), nullable=False)  # quarterly, annual
    period_end_date = Column(Date, nullable=False)
    data_json = Column(JSONB, nullable=False)  # tüm satırlar {key: value} formatında
    currency = Column(String(10), default="TRY", nullable=False)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ─── Finansal Oranlar ────────────────────────────────────────────
class FinancialRatio(Base):
    """Hesaplanan oranlar: F/K, PD/DD, ROE, ROA, Net Borç/FAVÖK vb."""
    __tablename__ = "financial_ratios"
    __table_args__ = (
        UniqueConstraint("company_id", "period_end_date", name="uq_financial_ratio_unique"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    period_end_date = Column(Date, nullable=False)
    pe_ratio = Column(Numeric(12, 4), nullable=True)         # Fiyat / Kazanç
    pb_ratio = Column(Numeric(12, 4), nullable=True)         # Piyasa Değeri / Defter Değeri
    ps_ratio = Column(Numeric(12, 4), nullable=True)         # Fiyat / Satış
    roe = Column(Numeric(8, 4), nullable=True)               # Özkaynak Kârlılığı
    roa = Column(Numeric(8, 4), nullable=True)               # Aktif Kârlılığı
    current_ratio = Column(Numeric(8, 4), nullable=True)     # Cari Oran
    debt_to_equity = Column(Numeric(8, 4), nullable=True)    # Borç / Özkaynak
    net_margin = Column(Numeric(8, 4), nullable=True)        # Net Kâr Marjı
    gross_margin = Column(Numeric(8, 4), nullable=True)      # Brüt Kâr Marjı
    ebitda_margin = Column(Numeric(8, 4), nullable=True)     # FAVÖK Marjı
    net_debt_ebitda = Column(Numeric(8, 4), nullable=True)   # Net Borç / FAVÖK
    raw_ratios_json = Column(JSONB, nullable=True)
    calculated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ─── Temettü Geçmişi ────────────────────────────────────────────
class Dividend(Base):
    """Ticker.dividends → temettü ödeme geçmişi."""
    __tablename__ = "dividends"
    __table_args__ = (
        UniqueConstraint("company_id", "ex_date", name="uq_dividend_unique"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    ex_date = Column(Date, nullable=False)
    payment_date = Column(Date, nullable=True)
    amount = Column(Numeric(12, 4), nullable=False)
    currency = Column(String(10), default="TRY", nullable=False)
    dividend_type = Column(String(50), nullable=True)  # cash, stock
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ─── Büyük Ortaklar ─────────────────────────────────────────────
class MajorHolder(Base):
    """Ticker.major_holders → ortaklık yapısı."""
    __tablename__ = "major_holders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    holder_name = Column(String(500), nullable=False)
    share_percentage = Column(Numeric(8, 4), nullable=True)
    share_count = Column(Float, nullable=True)
    holder_type = Column(String(100), nullable=True)  # institutional, insider, public
    data_json = Column(JSONB, nullable=True)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ─── Teknik Göstergeler ─────────────────────────────────────────
class TechnicalIndicator(Base):
    """technical.py → RSI, MACD, Bollinger, SMA, EMA vb."""
    __tablename__ = "technical_indicators"
    __table_args__ = (
        UniqueConstraint("company_id", "indicator_name", "trading_date",
                         name="uq_technical_indicator_unique"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    ticker = Column(String(20), nullable=False)
    indicator_name = Column(String(50), nullable=False)  # RSI, MACD, SMA_50, EMA_20, BBANDS
    trading_date = Column(Date, nullable=False)
    value = Column(Numeric(16, 6), nullable=True)        # ana değer
    signal = Column(Numeric(16, 6), nullable=True)       # sinyal hattı (MACD için)
    histogram = Column(Numeric(16, 6), nullable=True)    # histogram (MACD için)
    upper_band = Column(Numeric(16, 6), nullable=True)   # üst bant (Bollinger)
    lower_band = Column(Numeric(16, 6), nullable=True)   # alt bant (Bollinger)
    interpretation = Column(String(50), nullable=True)   # BUY, SELL, HOLD, OVERBOUGHT, OVERSOLD
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ─── Makro Veriler (TCMB, Enflasyon, Politika Faizi) ────────────
class MacroIndicator(Base):
    """bp.tcmb, bp.inflation, bp.policy_rate → makroekonomik veriler."""
    __tablename__ = "macro_indicators"
    __table_args__ = (
        UniqueConstraint("indicator_type", "indicator_date", name="uq_macro_indicator_unique"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    indicator_type = Column(String(50), nullable=False)  # tcmb_rate, inflation, policy_rate
    indicator_name = Column(String(200), nullable=False)
    indicator_date = Column(Date, nullable=False)
    value = Column(Numeric(16, 6), nullable=True)
    unit = Column(String(20), nullable=True)  # %, TRY, USD
    data_json = Column(JSONB, nullable=True)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ─── Döviz Kurları ───────────────────────────────────────────────
class ForexRate(Base):
    """bp.fx → USD/TRY, EUR/TRY vb."""
    __tablename__ = "forex_rates"
    __table_args__ = (
        UniqueConstraint("pair", "rate_date", name="uq_forex_rate_unique"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pair = Column(String(20), nullable=False)  # USDTRY, EURTRY, GBPTRY
    rate_date = Column(Date, nullable=False)
    buy_rate = Column(Numeric(12, 6), nullable=True)
    sell_rate = Column(Numeric(12, 6), nullable=True)
    close_rate = Column(Numeric(12, 6), nullable=True)
    data_json = Column(JSONB, nullable=True)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ─── BIST Endeksleri ─────────────────────────────────────────────
class IndexData(Base):
    """bp.Index → XU100, XU030, XBANK vb."""
    __tablename__ = "index_data"
    __table_args__ = (
        UniqueConstraint("index_code", "trading_date", name="uq_index_data_unique"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    index_code = Column(String(20), nullable=False)  # XU100, XU030, XBANK
    index_name = Column(String(200), nullable=True)
    trading_date = Column(Date, nullable=False)
    open = Column(Numeric(12, 4), nullable=True)
    high = Column(Numeric(12, 4), nullable=True)
    low = Column(Numeric(12, 4), nullable=True)
    close = Column(Numeric(12, 4), nullable=True)
    volume = Column(Float, nullable=True)
    change_pct = Column(Numeric(8, 4), nullable=True)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ─── Ekonomik Takvim ─────────────────────────────────────────────
class EconomicCalendarEvent(Base):
    """bp.economic_calendar → ekonomik olaylar ve göstergeler."""
    __tablename__ = "economic_calendar"
    __table_args__ = (
        UniqueConstraint("event_name", "event_date", name="uq_eco_calendar_unique"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_date = Column(DateTime(timezone=True), nullable=False)
    event_name = Column(String(500), nullable=False)
    country = Column(String(50), default="TR", nullable=False)
    importance = Column(String(20), nullable=True)  # low, medium, high
    actual = Column(String(50), nullable=True)
    forecast = Column(String(50), nullable=True)
    previous = Column(String(50), nullable=True)
    data_json = Column(JSONB, nullable=True)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# ─── Screener Sonuçları (Anlık Görüntü) ─────────────────────────
class ScreenerSnapshot(Base):
    """screener.py → hisse tarama sonuçları."""
    __tablename__ = "screener_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    snapshot_date = Column(Date, nullable=False)
    filter_criteria = Column(JSONB, nullable=True)  # {"pe_lt": 10, "roe_gt": 15}
    results_json = Column(JSONB, nullable=False)    # full screener results
    result_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
