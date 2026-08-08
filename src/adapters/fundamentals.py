"""Temel analiz adaptoru — sirket bilgileri, finansallar, temettular, ortaklik yapisi.

Uses shared TTL cache (300s) and asyncio.to_thread for sync borsapy calls.
"""

import math
import re
from urllib.parse import urljoin

import structlog

from src.adapters.utils import (
    TTL_FUNDAMENTALS,
    cached,
    df_to_records,
    get_http_client,
    run_sync,
    safe_serialize,
)

logger = structlog.get_logger(__name__)

KAP_BASE_URL = "https://www.kap.org.tr"
KAP_BIST_COMPANIES_URL = f"{KAP_BASE_URL}/tr/bist-sirketler"


@cached(24 * 60 * 60, "kap_company_urls")
async def _get_kap_financial_urls() -> dict[str, str]:
    """Build ticker -> official KAP financial-summary URL mapping."""
    from bs4 import BeautifulSoup

    response = await get_http_client().get(KAP_BIST_COMPANIES_URL)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    mapping: dict[str, str] = {}
    for anchor in soup.find_all("a", href=True):
        ticker = anchor.get_text(" ", strip=True).upper()
        href = str(anchor.get("href", ""))
        if not re.fullmatch(r"[A-Z0-9]{2,8}", ticker):
            continue
        if "/sirket-bilgileri/ozet/" not in href:
            continue
        financial_path = href.replace("/sirket-bilgileri/ozet/", "/sirket-finansal-bilgileri/")
        mapping.setdefault(ticker, urljoin(KAP_BASE_URL, financial_path))
    return mapping


def _kap_unit_multiplier(unit: str) -> float:
    compact = re.sub(r"\s+", "", unit.upper())
    if compact.startswith("1000000"):
        return 1_000_000.0
    if compact.startswith("1000"):
        return 1_000.0
    return 1.0


def _parse_kap_number(value: str, multiplier: float) -> float | None:
    text = value.strip()
    if not text or text in {"-", "—"}:
        return None
    normalized = text.replace(".", "").replace(",", ".")
    try:
        return float(normalized) * multiplier
    except ValueError:
        return None


def _records_from_kap_rows(
    rows: list[list[str]],
    periods: list[str],
    multiplier: float,
    ignored_labels: set[str],
) -> list[dict]:
    records: list[dict] = []
    for cells in rows:
        if len(cells) != len(periods) + 1:
            continue
        label = cells[0].strip()
        if not label or label in ignored_labels:
            continue
        values = [_parse_kap_number(value, multiplier) for value in cells[1:]]
        if not any(value is not None for value in values):
            continue
        records.append({"Item": label, **dict(zip(periods, values, strict=True))})
    return records


def _parse_kap_financial_summary(html: str) -> dict:
    """Parse KAP's server-rendered summary and scale values to actual TRY."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")
    balance_records: list[dict] = []
    income_records: list[dict] = []
    periods: list[str] = []
    multiplier = 1.0

    all_rows = [
        [cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"])]
        for table in tables
        for row in table.find_all("tr")
    ]

    balance_header_index = next(
        (i for i, row in enumerate(all_rows) if row and row[0] == "FİNANSAL DURUM TABLOSU"),
        None,
    )
    income_header_index = next(
        (
            i
            for i, row in enumerate(all_rows)
            if row and row[0].startswith("KAR VEYA ZARAR VE DİĞER KAPSAMLI GELİR TABLOSU")
        ),
        None,
    )
    if balance_header_index is None or income_header_index is None:
        raise ValueError("KAP finansal tablo başlıkları bulunamadı")

    periods = all_rows[balance_header_index][1:]
    unit_row = next(
        (row for row in all_rows[balance_header_index:income_header_index] if row and row[0] == "Sunum Para Birimi"),
        [],
    )
    multiplier = _kap_unit_multiplier(unit_row[1] if len(unit_row) > 1 else "TL")
    ignored = {"Sunum Para Birimi", "Finansal Tablo Niteliği"}
    balance_records = _records_from_kap_rows(
        all_rows[balance_header_index + 1:income_header_index],
        periods,
        multiplier,
        ignored,
    )
    income_records = _records_from_kap_rows(
        all_rows[income_header_index + 1:],
        periods,
        multiplier,
        ignored,
    )

    if not balance_records or not income_records:
        raise ValueError("KAP finansal özetinde veri bulunamadı")
    return {
        "periods": periods,
        "unit": "TRY",
        "balance_sheet": balance_records,
        "income_statement": income_records,
    }


@cached(TTL_FUNDAMENTALS, "kap_financials")
async def _get_kap_financial_summary(ticker: str) -> dict:
    urls = await _get_kap_financial_urls()
    source_url = urls.get(ticker.upper())
    if not source_url:
        raise LookupError(f"{ticker} için KAP finansal bilgi sayfası bulunamadı")
    response = await get_http_client().get(source_url)
    response.raise_for_status()
    return {**_parse_kap_financial_summary(response.text), "source_url": source_url}


def _filter_kap_periods(records: list[dict], quarterly: bool) -> list[dict]:
    if quarterly:
        return records
    return [
        {
            key: value
            for key, value in record.items()
            if key == "Item" or re.fullmatch(r"\d{4}/12", key)
        }
        for record in records
    ]


async def _get_ticker(ticker: str):
    import borsapy as bp
    return await run_sync(bp.Ticker, ticker)


@cached(TTL_FUNDAMENTALS, "fund")
async def get_company_info(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        info_dict: dict = {}
        fast_dict: dict = {}

        # Try .info first
        try:
            info = await run_sync(lambda: t.info)
            raw = safe_serialize(info) if info else {}
            if isinstance(raw, dict):
                info_dict = raw
        except Exception as e:
            logger.warning("company_info_info_failed", ticker=ticker, error=str(e))

        # Always try fast_info as supplement/fallback
        try:
            fast = await run_sync(lambda: t.fast_info)
            raw = safe_serialize(fast) if fast else {}
            if isinstance(raw, dict):
                fast_dict = raw
        except Exception as e:
            logger.warning("company_info_fast_info_failed", ticker=ticker, error=str(e))

        # Some borsapy info objects serialize only as a repr string. That is
        # transport noise, not a useful company-data field.
        if set(info_dict) == {"value"}:
            info_dict = {}

        # Fill the legal/display name from the BIST-scoped symbol directory.
        try:
            import borsapy as bp

            matches = await run_sync(
                lambda: bp.search(
                    ticker,
                    type="stock",
                    exchange="BIST",
                    limit=10,
                    full_info=True,
                )
            )
            exact = next(
                (
                    item
                    for item in matches
                    if isinstance(item, dict) and str(item.get("symbol", "")).upper() == ticker.upper()
                ),
                None,
            )
            if exact:
                description = exact.get("description")
                if description:
                    info_dict.setdefault("name", description)
                for source_key, target_key in (
                    ("exchange", "exchange"),
                    ("currency_code", "currency"),
                    ("currency", "currency"),
                ):
                    if exact.get(source_key):
                        info_dict.setdefault(target_key, exact[source_key])
        except Exception as e:
            logger.warning("company_info_symbol_search_failed", ticker=ticker, error=str(e))

        # If both empty, try yfinance directly with .IS suffix
        if len(info_dict) < 3 and len(fast_dict) < 3:
            try:
                import yfinance as yf
                yf_ticker = yf.Ticker(f"{ticker}.IS")
                yf_info = await run_sync(lambda: yf_ticker.info)
                if isinstance(yf_info, dict) and len(yf_info) > 3:
                    info_dict = yf_info
            except Exception as e:
                logger.warning("company_info_yfinance_fallback_failed", ticker=ticker, error=str(e))

        # Merge: fast_info as base, info_dict takes precedence
        merged = {**fast_dict, **info_dict} if fast_dict or info_dict else {}

        return {
            "ticker": ticker,
            "source": "Borsa İstanbul/TradingView/İş Yatırım (borsapy)",
            "info": merged,
        }
    except Exception as e:
        logger.error("fundamentals_info_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "info": {}, "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_fast_info(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        info = await run_sync(lambda: t.fast_info)
        return {"ticker": ticker, "fast_info": safe_serialize(info)}
    except Exception as e:
        logger.error("fundamentals_fast_info_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "fast_info": {}, "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_balance_sheet(ticker: str, quarterly: bool = False) -> dict:
    try:
        summary = await _get_kap_financial_summary(ticker)
        data = _filter_kap_periods(summary["balance_sheet"], quarterly)
        periods = [key for key in data[0] if key != "Item"] if data else []
        return {
            "ticker": ticker,
            "quarterly": quarterly,
            "source": "KAP",
            "source_url": summary["source_url"],
            "as_of": periods[-1] if periods else None,
            "unit": "TRY",
            "data": data,
        }
    except Exception as e:
        logger.error("fundamentals_balance_sheet_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "data": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_income_statement(ticker: str, quarterly: bool = False) -> dict:
    try:
        summary = await _get_kap_financial_summary(ticker)
        data = _filter_kap_periods(summary["income_statement"], quarterly)
        periods = [key for key in data[0] if key != "Item"] if data else []
        return {
            "ticker": ticker,
            "quarterly": quarterly,
            "source": "KAP",
            "source_url": summary["source_url"],
            "as_of": periods[-1] if periods else None,
            "unit": "TRY",
            "data": data,
        }
    except Exception as e:
        logger.error("fundamentals_income_stmt_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "data": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_cashflow(ticker: str, quarterly: bool = False) -> dict:
    try:
        t = await _get_ticker(ticker)
        if quarterly:
            df = await run_sync(lambda: t.quarterly_cashflow)
        else:
            df = await run_sync(lambda: t.cashflow)
        records = df_to_records(df)
        periods = [key for key in records[0] if key not in {"Item", "index"}] if records else []
        return {
            "ticker": ticker,
            "quarterly": quarterly,
            "source": "İş Yatırım (borsapy)",
            "as_of": periods[0] if periods else None,
            "unit": "TRY",
            "data": records,
        }
    except Exception as e:
        logger.error("fundamentals_cashflow_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "data": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_dividends(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(lambda: t.dividends)
        data = df_to_records(result) if hasattr(result, "iterrows") else safe_serialize(result)
        return {"ticker": ticker, "source": "İş Yatırım (borsapy)", "dividends": data}
    except Exception as e:
        logger.error("fundamentals_dividends_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "dividends": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_major_holders(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(lambda: t.major_holders)
        data = df_to_records(result) if hasattr(result, "iterrows") else safe_serialize(result)
        return {"ticker": ticker, "source": "İş Yatırım (borsapy)", "holders": data}
    except Exception as e:
        logger.error("fundamentals_holders_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "holders": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_recommendations(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(lambda: t.recommendations)
        data = df_to_records(result) if hasattr(result, "iterrows") else safe_serialize(result)
        return {"ticker": ticker, "source": "İş Yatırım (borsapy)", "recommendations": data}
    except Exception as e:
        logger.error("fundamentals_recommendations_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "recommendations": [], "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_analyst_price_targets(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(lambda: t.analyst_price_targets)
        targets = safe_serialize(result)
        if not isinstance(targets, dict):
            targets = {}
        if not isinstance(targets.get("current"), (int, float)) or float(targets["current"]) <= 0:
            try:
                fast = safe_serialize(await run_sync(lambda: t.fast_info))
                if isinstance(fast, dict) and isinstance(fast.get("last_price"), (int, float)):
                    targets["current"] = fast["last_price"]
            except Exception as e:
                logger.warning("price_target_current_fallback_failed", ticker=ticker, error=str(e))
        return {
            "ticker": ticker,
            "source": "İş Yatırım analist konsensüsü (borsapy)",
            "targets": targets,
        }
    except Exception as e:
        logger.error("fundamentals_targets_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "targets": {}, "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_earnings_dates(ticker: str) -> dict:
    try:
        t = await _get_ticker(ticker)
        result = await run_sync(lambda: t.earnings_dates)
        data = df_to_records(result) if hasattr(result, "iterrows") else safe_serialize(result)
        return {"ticker": ticker, "source": "KAP beklenen bildirim takvimi (borsapy)", "earnings_dates": data}
    except Exception as e:
        logger.error("fundamentals_earnings_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "earnings_dates": [], "error": str(e)}


def _safe_float(val) -> float | None:
    """Convert a value to float, returning None for NaN/Inf/None."""
    if val is None:
        return None
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 4)
    except (TypeError, ValueError):
        return None


@cached(TTL_FUNDAMENTALS, "fund")
async def get_live_financial_ratios(ticker: str) -> dict:
    """Compute key ratios from official KAP statements plus live valuation."""
    try:
        info_dict: dict = {}
        try:
            t = await _get_ticker(ticker)
            fast = await run_sync(lambda: t.fast_info)
            raw_fast = safe_serialize(fast) if fast else {}
            if isinstance(raw_fast, dict):
                info_dict = raw_fast
        except Exception as e:
            logger.warning("live_ratio_market_info_failed", ticker=ticker, error=str(e))

        balance = await get_balance_sheet(ticker, quarterly=False)
        income = await get_income_statement(ticker, quarterly=False)
        balance_rows = balance.get("data", []) if isinstance(balance, dict) else []
        income_rows = income.get("data", []) if isinstance(income, dict) else []
        periods = [key for key in balance_rows[0] if key != "Item"] if balance_rows else []
        period = periods[-1] if periods else None
        previous_period = periods[-2] if len(periods) > 1 else None

        def value(rows: list[dict], labels: tuple[str, ...], selected_period: str | None) -> float | None:
            if selected_period is None:
                return None
            for row in rows:
                if str(row.get("Item", "")).strip() in labels:
                    return _safe_float(row.get(selected_period))
            return None

        revenue = value(income_rows, ("Hasılat", "Satış Gelirleri"), period)
        gross_profit = value(income_rows, ("Brüt Kâr (Zarar)", "BRÜT KAR (ZARAR)"), period)
        net_income = value(
            income_rows,
            ("Net Dönem Kârı (Zararı)", "DÖNEM KARI (ZARARI)"),
            period,
        )
        operating_profit = value(
            income_rows,
            ("Esas Faaliyet Kârı (Zararı)", "ESAS FAALİYET KÂRI (ZARARI)", "Faaliyet Kârı (Zararı)"),
            period,
        )
        current_assets = value(balance_rows, ("Dönen Varlıklar",), period)
        current_liabilities = value(balance_rows, ("Kısa Vadeli Yükümlülükler",), period)
        total_liabilities = value(balance_rows, ("Toplam Yükümlülükler",), period)
        equity = value(balance_rows, ("Toplam Özkaynaklar", "Özkaynaklar"), period)
        assets = value(balance_rows, ("Toplam Varlıklar", "TOPLAM VARLIKLAR"), period)
        previous_equity = value(balance_rows, ("Toplam Özkaynaklar", "Özkaynaklar"), previous_period)
        previous_assets = value(balance_rows, ("Toplam Varlıklar", "TOPLAM VARLIKLAR"), previous_period)

        average_equity = (
            (equity + previous_equity) / 2
            if equity is not None and previous_equity is not None
            else equity
        )
        average_assets = (
            (assets + previous_assets) / 2
            if assets is not None and previous_assets is not None
            else assets
        )

        cash = value(
            balance_rows,
            ("Nakit ve Nakit Benzerleri", "NAKİT VE NAKİT BENZERLERİ"),
            period,
        ) or 0.0
        short_debt = value(
            balance_rows,
            ("Kısa Vadeli Finansal Borçlar", "Finansal Borçlar"),
            period,
        ) or 0.0
        long_debt = value(
            balance_rows,
            ("Uzun Vadeli Finansal Borçlar",),
            period,
        ) or 0.0
        total_financial_debt = short_debt + long_debt
        net_debt = total_financial_debt - cash if (short_debt or long_debt or cash) else None

        ebitda_val = operating_profit  # fallback estimate when depreciation row isn't parsed separately
        market_cap_val = _safe_float(info_dict.get("market_cap") or info_dict.get("marketCap"))

        def percent(numerator: float | None, denominator: float | None) -> float | None:
            if numerator is None or denominator in (None, 0):
                return None
            return round(numerator / denominator * 100, 2)

        def ratio(numerator: float | None, denominator: float | None) -> float | None:
            if numerator is None or denominator in (None, 0):
                return None
            return round(numerator / denominator, 2)

        calculated_ps = ratio(market_cap_val, revenue) if (market_cap_val and revenue) else _safe_float(info_dict.get("priceToSalesTrailing12Months") or info_dict.get("ps_ratio"))
        calculated_pb = ratio(market_cap_val, equity) if (market_cap_val and equity) else _safe_float(info_dict.get("pb_ratio") or info_dict.get("priceToBook"))

        previous_revenue = value(income_rows, ("Hasılat", "Satış Gelirleri"), previous_period)
        previous_net_income = value(income_rows, ("Net Dönem Kârı (Zararı)", "DÖNEM KARI (ZARARI)"), previous_period)

        def growth_pct(current: float | None, prev: float | None) -> float | None:
            if current is None or prev in (None, 0):
                return None
            return round(((current - prev) / abs(prev)) * 100, 2)

        ratios = {
            "gross_margin": percent(gross_profit, revenue),
            "ebitda_margin": percent(ebitda_val, revenue) if ebitda_val else _safe_float(info_dict.get("ebitdaMargins")),
            "net_margin": percent(net_income, revenue),
            "roe": percent(net_income, average_equity),
            "roa": percent(net_income, average_assets),
            "current_ratio": ratio(current_assets, current_liabilities),
            "net_debt_ebitda": ratio(net_debt, ebitda_val) if (net_debt is not None and ebitda_val) else None,
            "debt_to_equity": ratio(total_liabilities, equity),
            "pe_ratio": _safe_float(info_dict.get("pe_ratio") or info_dict.get("trailingPE")),
            "pb_ratio": calculated_pb,
            "ps_ratio": calculated_ps,
            "revenue_growth_yoy": growth_pct(revenue, previous_revenue),
            "net_income_growth_yoy": growth_pct(net_income, previous_net_income),
        }

        # Check if at least one ratio has data
        has_data = any(v is not None for v in ratios.values())
        if not has_data:
            return {"ticker": ticker, "ratios": None}

        return {
            "ticker": ticker,
            "source": "KAP finansal tabloları + TradingView değerleme (borsapy)",
            "as_of": period,
            "ratios": ratios,
        }
    except Exception as e:
        logger.error("live_ratios_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "ratios": None, "error": str(e)}


@cached(TTL_FUNDAMENTALS, "fund")
async def get_live_news(ticker: str, limit: int = 10) -> dict:
    """Fetch news/KAP disclosures for a ticker via borsapy."""
    try:
        t = await _get_ticker(ticker)
        news_df = await run_sync(lambda: t.news)
        records = df_to_records(news_df) if hasattr(news_df, "iterrows") else []
        return {"ticker": ticker, "news": records[:limit]}
    except Exception as e:
        logger.error("live_news_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "news": [], "error": str(e)}
