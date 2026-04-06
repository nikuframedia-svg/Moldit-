"""Integration test for the /api/data/load upload flow.

Tests the full pipeline: upload .mpp -> transform -> schedule -> response.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure project root on sys.path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Fixture path — place a real .mpp file here for integration tests
FIXTURE_MPP = ROOT / "data" / "test_fixture.mpp"


@pytest.fixture(autouse=True)
def _reset_state():
    """Reset CopilotState before each test."""
    try:
        from backend.copilot.state import state
        state.engine_data = None
        state.config = None
        state.segments = []
        state.score = None
    except ImportError:
        pass
    yield
    try:
        from backend.copilot.state import state
        state.engine_data = None
        state.config = None
        state.segments = []
        state.score = None
    except ImportError:
        pass


def _get_test_client():
    """Create a FastAPI TestClient for the upload endpoint."""
    from fastapi import FastAPI
    from backend.api.data import router

    app = FastAPI()
    app.include_router(router)

    from fastapi.testclient import TestClient
    return TestClient(app)


class TestUploadValidation:
    """Test upload endpoint input validation."""

    def test_rejects_non_mpp_extension(self):
        client = _get_test_client()
        fake_file = io.BytesIO(b"not an mpp file")
        resp = client.post(
            "/api/data/load",
            files={"file": ("plan.xlsx", fake_file, "application/octet-stream")},
        )
        assert resp.status_code == 400
        assert "invalido" in resp.json()["detail"].lower() or ".mpp" in resp.json()["detail"]

    def test_rejects_empty_file(self):
        client = _get_test_client()
        empty_file = io.BytesIO(b"")
        resp = client.post(
            "/api/data/load",
            files={"file": ("plan.mpp", empty_file, "application/octet-stream")},
        )
        assert resp.status_code == 400
        assert "vazio" in resp.json()["detail"].lower() or "empty" in resp.json()["detail"].lower()


class TestUploadWithMock:
    """Test upload flow with mocked transform + scheduler."""

    def test_upload_success_mocked(self):
        """Upload with mocked transform returns expected response shape."""
        from backend.types import MolditEngineData

        # Build a minimal mock EngineData
        mock_data = MagicMock(spec=MolditEngineData)
        mock_data.operacoes = [MagicMock() for _ in range(5)]
        mock_data.moldes = [MagicMock() for _ in range(2)]
        mock_data.maquinas = [MagicMock() for _ in range(3)]

        mock_result = MagicMock()
        mock_result.segmentos = [MagicMock() for _ in range(10)]
        mock_result.score = {"makespan_total_dias": 42, "weighted_score": 0.8}
        mock_result.warnings = ["test warning"]

        # Import the state singleton directly (avoid broken copilot/__init__.py)
        import importlib
        state_mod = importlib.import_module("backend.copilot.state")

        with (
            patch("backend.config.loader.load_config", return_value=MagicMock()),
            patch("backend.transform.transform.transform", return_value=mock_data),
            patch("backend.scheduler.scheduler.schedule_all", return_value=mock_result),
            patch.object(state_mod.state, "update_schedule"),
        ):

            client = _get_test_client()
            fake_mpp = io.BytesIO(b"\x00\x01\x02\x03MPP_HEADER")
            resp = client.post(
                "/api/data/load",
                files={"file": ("project.mpp", fake_mpp, "application/octet-stream")},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["n_operacoes"] == 5
        assert body["n_moldes"] == 2
        assert body["n_maquinas"] == 3
        assert body["n_segmentos"] == 10
        assert "score" in body
        assert "warnings" in body


@pytest.mark.skipif(
    not FIXTURE_MPP.exists(),
    reason=f"Test fixture not found: {FIXTURE_MPP}. Place a real .mpp file there.",
)
class TestUploadWithRealMPP:
    """Integration test with a real .mpp fixture file."""

    def test_upload_real_mpp(self):
        """Upload a real .mpp file through the full pipeline."""
        client = _get_test_client()

        with open(FIXTURE_MPP, "rb") as f:
            resp = client.post(
                "/api/data/load",
                files={"file": ("test_fixture.mpp", f, "application/octet-stream")},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["n_operacoes"] > 0
        assert body["n_moldes"] > 0
        assert body["n_segmentos"] >= 0
        assert "score" in body
