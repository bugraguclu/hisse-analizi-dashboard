import structlog
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from src.db.models import Company, FinancialStatement, PriceData
from src.db.repository import FinancialStatementRepository, PriceDataRepository

logger = structlog.get_logger(__name__)


class AnalysisService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.fs_repo = FinancialStatementRepository(session)
        self.price_repo = PriceDataRepository(session)

    async def calculate_ratios(self, company: Company, period: str) -> Dict[str, Any]:
        """
        Belirli bir donem icin finansal oranlari hesaplar.
        Gerekli tablolar: balance_sheet, income_stmt
        """
        try:
            statements = await self.fs_repo.get_for_company(company.id)

            bs = next((s for s in statements if s.period == period and s.statement_type == "balance_sheet"), None)
            is_stmt = next((s for s in statements if s.period == period and s.statement_type == "income_stmt"), None)

            if not bs or not is_stmt:
                logger.warning("missing_statements_for_ratio_calculation", ticker=company.ticker, period=period)
                return {}

            bs_data = bs.data_json
            is_data = is_stmt.data_json

            logger.debug(
                "calculating_ratios_data_info",
                ticker=company.ticker,
                period=period,
                bs_keys=list(bs_data.keys())[:10],
                is_keys=list(is_data.keys())[:10],
            )

            # Temel kalemleri cikar
            net_profit = self._get_value(is_data, ["Net Dönem Karı", "Dönem Karı (Zararı)", "Net Profit"])
            equity = self._get_value(bs_data, ["Özsermaye", "Toplam Özkaynaklar", "Ana Ortaklığa Ait Özkaynaklar"])
            assets = self._get_value(bs_data, ["Toplam Aktifler", "Toplam Varlıklar"])
            sales = self._get_value(is_data, ["Satış Gelirleri", "Hasılat", "Net Satışlar"])

            ratios: Dict[str, Any] = {}

            # 1. Karlilik Oranlari
            if equity and net_profit:
                ratios["roe"] = (net_profit / equity) * 100

            if assets and net_profit:
                ratios["roa"] = (net_profit / assets) * 100

            if sales and net_profit:
                ratios["net_margin"] = (net_profit / sales) * 100

            # Brut Kar Marji
            gross_profit = self._get_value(is_data, ["Brüt Kar", "Brüt Kâr", "Gross Profit"])
            if gross_profit and sales:
                ratios["gross_margin"] = (gross_profit / sales) * 100

            # FAVOK Marji
            ebitda = self._get_value(is_data, [
                "FAALİYET KARI (ZARARI)", "Faaliyet Karı", "EBITDA", "Operating Profit"
            ])
            if ebitda and sales:
                ratios["ebitda_margin"] = (ebitda / sales) * 100

            # 2. Borc/Ozkaynak
            total_liabilities = self._get_value(bs_data, [
                "Toplam Yükümlülükler", "Toplam Borçlar", "Total Liabilities"
            ])
            if total_liabilities and equity:
                ratios["debt_to_equity"] = total_liabilities / equity

            # Net Borc/FAVOK
            cash = self._get_value(bs_data, ["Nakit", "Nakit ve Nakit Benzerleri", "Cash"])
            financial_debt = self._get_value(bs_data, [
                "Finansal Borçlar", "Banka Kredileri", "Financial Liabilities"
            ])
            if financial_debt and cash and ebitda and ebitda != 0:
                net_debt = financial_debt - (cash or Decimal(0))
                ratios["net_debt_ebitda"] = net_debt / ebitda

            # 3. Likidite
            current_assets = self._get_value(bs_data, ["Dönen Varlıklar", "Current Assets"])
            short_term_liabilities = self._get_value(bs_data, ["Kısa Vadeli Yükümlülükler", "Short Term Liabilities"])

            if current_assets and short_term_liabilities:
                ratios["current_ratio"] = current_assets / short_term_liabilities

            # 4. Degerleme Oranlari
            # TODO: F/K hesabi icin hisse adedi (sirket bazli) gerekli,
            # simdilik CompanyDetail.pe_ratio kullanilabilir.

            logger.info("ratios_calculated", ticker=company.ticker, period=period, ratios=list(ratios.keys()))
            return ratios

        except Exception as e:
            logger.error("ratio_calculation_error", ticker=company.ticker, error=str(e))
            return {}

    def _get_value(self, data: Dict, keys: List[str]) -> Optional[Decimal]:
        """Case-insensitive value lookup in dictionary."""
        for k, val in data.items():
            if any(target.lower() in k.lower() for target in keys):
                if val is not None and str(val).strip() != "" and str(val).lower() != "nan":
                    try:
                        return Decimal(str(val).replace(",", ""))
                    except Exception:
                        continue
        return None
