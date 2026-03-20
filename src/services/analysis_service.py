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
        Belirli bir dönem için finansal oranları hesaplar.
        Gerekli tablolar: balance_sheet, income_stmt
        """
        try:
            # Finansal tabloları getir
            statements = await self.fs_repo.get_for_company(company.id)
            
            # İlgili dönem verilerini filtrele
            bs = next((s for s in statements if s.period == period and s.statement_type == "balance_sheet"), None)
            is_stmt = next((s for s in statements if s.period == period and s.statement_type == "income_stmt"), None)
            
            if not bs or not is_stmt:
                logger.warning("missing_statements_for_ratio_calculation", ticker=company.ticker, period=period)
                return {}

            bs_data = bs.data_json
            is_data = is_stmt.data_json

            logger.debug("calculating_ratios_data_info", 
                         ticker=company.ticker, 
                         period=period, 
                         bs_keys=list(bs_data.keys())[:10], 
                         is_keys=list(is_data.keys())[:10])

            # Temel Kalemleri Çıkar (borsapy/İş Yatırım formatına göre anahtar isimleri değişebilir)
            # Not: Bu kısım borsapy'nin döndürdüğü DataFrame'in satır isimlerine duyarlıdır.
            
            net_profit = self._get_value(is_data, ["Net Dönem Karı", "Dönem Karı (Zararı)", "Net Profit"])
            equity = self._get_value(bs_data, ["Özsermaye", "Toplam Özkaynaklar", "Ana Ortaklığa Ait Özkaynaklar"])
            assets = self._get_value(bs_data, ["Toplam Aktifler", "Toplam Varlıklar"])
            sales = self._get_value(is_data, ["Satış Gelirleri", "Hasılat", "Net Satışlar"])
            ebitda = self._get_value(is_data, ["FAALİYET KARI (ZARARI)", "Operating Profit"]) # Basitleştirilmiş EBITDA
            
            ratios = {}

            # 1. Karlılık Oranları
            if equity and net_profit:
                ratios["roe"] = (net_profit / equity) * 100
            
            if assets and net_profit:
                ratios["roa"] = (net_profit / assets) * 100
                
            if sales and net_profit:
                ratios["net_profit_margin"] = (net_profit / sales) * 100

            # 2. Değerleme Oranları (Fiyat bilgisi gerekir)
            latest_price = await self.price_repo.get_latest(company.ticker)
            if latest_price and latest_price.close:
                # Hisse Başı Kar (EPS) ve F/K hesaplama basitleştirilmiş:
                # Gerçekte ödenmiş sermaye / hisse adedi gerekir. 
                # Şimdilik placeholder veya piyasa değeri üzerinden gidilebilir.
                pass

            # 3. Likidite
            current_assets = self._get_value(bs_data, ["Dönen Varlıklar", "Current Assets"])
            short_term_liabilities = self._get_value(bs_data, ["Kısa Vadeli Yükümlülükler", "Short Term Liabilities"])
            
            if current_assets and short_term_liabilities:
                ratios["current_ratio"] = current_assets / short_term_liabilities

            logger.info("ratios_calculated", ticker=company.ticker, period=period, ratios=list(ratios.keys()))
            return ratios

        except Exception as e:
            logger.error("ratio_calculation_error", ticker=company.ticker, error=str(e))
            return {}

    def _get_value(self, data: Dict, keys: List[str]) -> Optional[Decimal]:
        """Case-insensitive value lookup in dictionary"""
        # data format: {"Kalem": {"2023/12": val, "2023/09": val}, ...}
        # Actually in FinancialService we pass: period_data = {k: v.get(period) for k, v in data.items()}
        # So data here is: {"Kalem1": val, "Kalem2": val, ...}
        
        for k, val in data.items():
            if any(target.lower() in k.lower() for target in keys):
                if val is not None and str(val).strip() != "" and str(val).lower() != "nan":
                    try:
                        return Decimal(str(val).replace(",", ""))
                    except:
                        continue
        return None
