"""Tests for content-based financial hashing."""

import pandas as pd
from src.adapters.financial_adapter import FinancialAdapter


class TestFinancialHashing:
    def setup_method(self):
        self.adapter = FinancialAdapter()

    def test_same_content_same_hash(self):
        """Same DataFrame content should produce same hash."""
        df1 = pd.DataFrame({"col1": [1.0, 2.0]}, index=["row1", "row2"])
        df2 = pd.DataFrame({"col1": [1.0, 2.0]}, index=["row1", "row2"])

        raw1 = self.adapter._create_raw_data("THYAO", "balance_sheet", df1)
        raw2 = self.adapter._create_raw_data("THYAO", "balance_sheet", df2)

        assert raw1.content_hash == raw2.content_hash

    def test_different_content_different_hash(self):
        """Different content should produce different hash."""
        df1 = pd.DataFrame({"col1": [1.0, 2.0]}, index=["row1", "row2"])
        df2 = pd.DataFrame({"col1": [3.0, 4.0]}, index=["row1", "row2"])

        raw1 = self.adapter._create_raw_data("THYAO", "balance_sheet", df1)
        raw2 = self.adapter._create_raw_data("THYAO", "balance_sheet", df2)

        assert raw1.content_hash != raw2.content_hash

    def test_different_ticker_different_hash(self):
        """Same content but different ticker should produce different hash."""
        df = pd.DataFrame({"col1": [1.0]}, index=["row1"])

        raw1 = self.adapter._create_raw_data("THYAO", "balance_sheet", df)
        raw2 = self.adapter._create_raw_data("GARAN", "balance_sheet", df)

        assert raw1.content_hash != raw2.content_hash

    def test_nan_cleaned_to_none(self):
        """NaN/Inf values should be cleaned to None in payload."""
        df = pd.DataFrame({"col1": [float("nan"), float("inf")]}, index=["row1", "row2"])
        raw = self.adapter._create_raw_data("THYAO", "balance_sheet", df)
        col_data = raw.raw_payload_json["data"]["col1"]
        assert col_data["row1"] is None
        assert col_data["row2"] is None
