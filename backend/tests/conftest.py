from pathlib import Path

import pytest
from fastapi import FastAPI

from app.main import create_app


@pytest.fixture
def app(tmp_path: Path) -> FastAPI:
    return create_app(tmp_path, tmp_path / "data")
