"""Tests for shared serialization utilities."""

import math

from src.adapters.utils import df_to_records, safe_serialize


class TestDfToRecords:
    def test_none_returns_empty(self):
        assert df_to_records(None) == []

    def test_empty_df(self):
        import pandas as pd
        df = pd.DataFrame()
        assert df_to_records(df) == []

    def test_nan_converted_to_none(self):
        import pandas as pd
        df = pd.DataFrame({"a": [1.0, float("nan"), 3.0]})
        records = df_to_records(df)
        assert records[1]["a"] is None

    def test_inf_converted_to_none(self):
        import pandas as pd
        df = pd.DataFrame({"a": [float("inf"), float("-inf")]})
        records = df_to_records(df)
        assert records[0]["a"] is None
        assert records[1]["a"] is None

    def test_normal_data(self):
        import pandas as pd
        df = pd.DataFrame({"x": [1, 2], "y": ["a", "b"]})
        records = df_to_records(df)
        assert len(records) == 2
        assert records[0]["x"] == 1
        assert records[0]["y"] == "a"


class TestSafeSerialize:
    def test_none(self):
        assert safe_serialize(None) == {}

    def test_dict(self):
        assert safe_serialize({"a": 1}) == {"a": 1}

    def test_list(self):
        assert safe_serialize([1, 2]) == [1, 2]

    def test_fallback_to_str(self):
        result = safe_serialize(42)
        assert result == {"value": "42"}
