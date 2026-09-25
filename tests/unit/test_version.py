"""Single source of truth for the application version."""

import tomllib
from importlib import metadata
from pathlib import Path

from src.core import version as version_module
from src.core.version import get_version

PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"


def test_version_comes_from_pyproject():
    with PYPROJECT.open("rb") as fh:
        expected = tomllib.load(fh)["project"]["version"]
    assert get_version() == expected


def test_falls_back_to_package_metadata(monkeypatch, tmp_path):
    monkeypatch.setattr(version_module, "_PYPROJECT", tmp_path / "missing.toml")
    monkeypatch.setattr(version_module.metadata, "version", lambda name: "9.9.9")
    get_version.cache_clear()
    try:
        assert get_version() == "9.9.9"
    finally:
        get_version.cache_clear()


def test_unknown_when_nothing_is_available(monkeypatch, tmp_path):
    def not_installed(name):
        raise metadata.PackageNotFoundError(name)

    broken = tmp_path / "pyproject.toml"
    broken.write_text("this is [not toml")
    monkeypatch.setattr(version_module, "_PYPROJECT", broken)
    monkeypatch.setattr(version_module.metadata, "version", not_installed)
    get_version.cache_clear()
    try:
        assert get_version() == version_module.UNKNOWN_VERSION
    finally:
        get_version.cache_clear()
