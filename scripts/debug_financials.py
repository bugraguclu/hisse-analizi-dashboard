"""Finansal veri debug araci — DB'deki finansal tablolari ve oran hesaplama hazirligini kontrol eder."""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.db.session import async_session_factory
from src.db.repository import FinancialStatementRepository, CompanyRepository


async def debug_data():
    async with async_session_factory() as session:
        company_repo = CompanyRepository(session)
        fs_repo = FinancialStatementRepository(session)

        companies = await company_repo.get_all()
        if not companies:
            print("No active companies found")
            return

        company = companies[0]
        ticker = company.ticker
        print(f"Debugging financials for: {ticker}")

        statements = await fs_repo.get_for_company(company.id)
        print(f"Total statements for {ticker}: {len(statements)}")

        periods = sorted(list(set(s.period for s in statements)))
        print(f"Periods found: {periods}")

        for period in periods:
            types = [s.statement_type for s in statements if s.period == period]
            print(f"Period {period} has types: {types}")
            if "balance_sheet" in types and "income_stmt" in types:
                print(f"  -> Ready for ratio calculation for {period}")
            else:
                print(f"  -> Missing statements for {period}")

        if statements:
            s = statements[0]
            print(f"\nKeys for {s.statement_type} ({s.period}):")
            print(list(s.data_json.keys())[:20])


if __name__ == "__main__":
    asyncio.run(debug_data())
