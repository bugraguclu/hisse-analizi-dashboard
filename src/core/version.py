"""Single source of truth for the application version: ``pyproject.toml``.

A source checkout (local dev, the Docker image) reads ``pyproject.toml`` directly so
the version can never go stale; an installed distribution without the file falls
back to the package metadata generated from it.
"""

import tomllib
from functools import lru_cache
from importlib import metadata
from pathlib import Path

DISTRIBUTION_NAME = "hisse-analizi-dashboard"
UNKNOWN_VERSION = "0.0.0+unknown"
_PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"


def _version_from_pyproject(path: Path) -> str | None:
    try:
        with path.open("rb") as fh:
            data = tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError):
        return None
    project = data.get("project")
    version = project.get("version") if isinstance(project, dict) else None
    return version if isinstance(version, str) and version.strip() else None


@lru_cache(maxsize=1)
def get_version() -> str:
    version = _version_from_pyproject(_PYPROJECT)
    if version:
        return version
    try:
        return metadata.version(DISTRIBUTION_NAME)
    except metadata.PackageNotFoundError:
        return UNKNOWN_VERSION
