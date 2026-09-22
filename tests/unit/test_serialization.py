"""Tests for shared serialization utilities."""


from src.adapters.utils import df_to_records, safe_serialize, sanitize_data


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

    def test_nested_provider_sentinel_converted_to_none(self):
        result = safe_serialize({"volume": 1e100, "nested": [{"value": float("inf")}]})
        assert result == {"volume": None, "nested": [{"value": None}]}


def test_sanitize_data_preserves_large_but_valid_financial_value():
    assert sanitize_data(1e15) == 1e15


def test_sanitize_data_converts_numpy_scalars_and_nat():
    import numpy as np
    import pandas as pd

    result = sanitize_data({"i": np.int64(5), "f": np.float32("nan"), "b": np.bool_(True), "t": pd.NaT,
                            "a": np.array([1.0, np.inf])})
    assert result == {"i": 5, "f": None, "b": True, "t": None, "a": [1.0, None]}
    assert type(result["i"]) is int


def test_finite_float():
    from src.adapters.utils import finite_float

    assert finite_float("1.5") == 1.5
    assert finite_float(None) is None
    assert finite_float(True) is None
    assert finite_float(float("nan")) is None
    assert finite_float(1e100) is None
    assert finite_float("abc") is None
