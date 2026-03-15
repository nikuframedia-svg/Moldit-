from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from src.main import app

ISOP_PATH = Path(__file__).parent.parent / "data" / "ISOP_Nikufra_27_2.xlsx"


@pytest.fixture
def client():
    """FastAPI test client."""
    return TestClient(app)


@pytest.fixture
def isop_path():
    """Path to the real ISOP Excel file."""
    if not ISOP_PATH.exists():
        pytest.skip(f"ISOP file not found at {ISOP_PATH}")
    return ISOP_PATH
